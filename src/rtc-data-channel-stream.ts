import { Duplex } from 'stream';
import { RtcDataChannelDispatcher } from './rtc-data-channel-dispatcher';

const useSetTimeoutFallback = true;

export default class RtcDataChannelStream extends Duplex {
    private _channel: RTCDataChannel;

    private _dispatcher: RtcDataChannelDispatcher;

    private _localFull: boolean = false;

    private _buffer: Buffer[] = [];

    public get label(): string { return this._channel.label; }

    public constructor(channel: RTCDataChannel, dispatcher: RtcDataChannelDispatcher) {
        super({ allowHalfOpen: false });

        this._channel = channel;
        this._channel.binaryType = 'arraybuffer';
        this._channel.addEventListener('message', ({ data }: { data: ArrayBuffer }) => {
            const buffer = Buffer.from(data);
            this._buffer.push(buffer);

            if (!this._localFull) {
                this.flushBuffer();
            }
        });
        this._channel.addEventListener('close', () => {
            process.nextTick(() => {
                this.emit('end');
            });
        });
        this._channel.addEventListener('error', ({ error }) => {
            process.nextTick(() => {
                this.emit('error', error);
            });
        });

        this._dispatcher = dispatcher;
    }

    private flushBuffer(): void {
        try {
            while (this._buffer.length) {
                if (!this.push(this._buffer.shift())) {
                    if (!this._localFull) {
                        this._dispatcher.sendControlMessage(this._channel, 'full');
                        this._localFull = true;
                    }
                    return;
                }
            }

            if (this._localFull) {
                this._dispatcher.sendControlMessage(this._channel, 'empty');
                this._localFull = false;
            }
        } catch (error) {
            process.nextTick(() => {
                this.emit('error', error);
            });
        }
    }

    public async _write(chunk: Buffer, encoding: string, callback: (err?: Error) => void): Promise<void> {
        try {
            await this._dispatcher.send(this._channel, chunk);
            callback();
        } catch (e) {
            callback(e);
        }
    }

    public _final(callback: (err: Error | null) => void): void {
        this._channel.close();
        callback(null);
    }

    public _read(size: number): void {
        this._localFull = false;
        this.flushBuffer();
    }
}
