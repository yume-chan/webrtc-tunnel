import { Duplex } from 'stream';
import { RtcDataChannelDispatcher } from './rtc-data-channel-dispatcher';

export default class RtcDataChannelStream extends Duplex {
    private _channel: RTCDataChannel;

    private _dispatcher: RtcDataChannelDispatcher;

    private _localFull: boolean = false;

    public get label(): string { return this._channel.label; }

    public constructor(channel: RTCDataChannel, dispatcher: RtcDataChannelDispatcher) {
        super();

        this._channel = channel;
        this._channel.binaryType = 'arraybuffer';
        this._channel.addEventListener('message', ({ data }: { data: ArrayBuffer; }) => {
            const buffer = Buffer.from(data);
            if (!this.push(buffer) && !this._localFull) {
                this._dispatcher.sendControlMessage(this._channel, 'full');
                this._localFull = true;
            }
        });
        this._channel.addEventListener('error', () => {
            // TODO: TypeScript removed RTCErrorEvent
            // Waiting for https://github.com/DefinitelyTyped/DefinitelyTyped/pull/56242
            process.nextTick(() => {
                this.emit('error', new Error('RTCDataChannel error'));
                this.end();
            });
        });
        this._channel.addEventListener('close', () => {
            this.end();
        });

        this._dispatcher = dispatcher;
    }

    public _read(): void {
        if (this._localFull) {
            this._dispatcher.sendControlMessage(this._channel, 'empty');
            this._localFull = false;
        }
    }

    public async _write(chunk: Buffer, encoding: string, callback: (err?: Error) => void): Promise<void> {
        try {
            await this._dispatcher.send(this._channel, chunk);
            callback();
        } catch (e) {
            if (e instanceof Error) {
                callback(e);
            } else {
                callback(new Error(String(e)));
            }
        }
    }

    public _final(callback: (err: Error | null) => void): void {
        if (this._channel.readyState === 'closed') {
            callback(null);
            this.destroy();
        } else {
            this._channel.addEventListener('close', () => {
                callback(null);
                this.destroy();
            });
            this._channel.close();
        }
    }

    public _destroy(err: Error | null, callback: (err: Error | null) => void) {
        callback(err);
    }
}
