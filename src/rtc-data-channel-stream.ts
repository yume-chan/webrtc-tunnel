import { Duplex } from 'stream';
import { RtcDataChannelDispatcher } from './rtc-data-channel-dispatcher';

const useSetTimeoutFallback = true;

export default class RtcDataChannelStream extends Duplex {
    private _dataChannel: RTCDataChannel;

    private _dispatcher: RtcDataChannelDispatcher;

    private _localFull: boolean = false;

    private _buffer: Buffer[] = [];

    public get label(): string { return this._dataChannel.label; }

    public constructor(dataChannel: RTCDataChannel, dispatcher: RtcDataChannelDispatcher) {
        super({ allowHalfOpen: false });

        this._dataChannel = dataChannel;
        this._dataChannel.binaryType = 'arraybuffer';
        this._dataChannel.addEventListener('message', ({ data }: { data: ArrayBuffer }) => {
            const buffer = Buffer.from(data);
            this._buffer.push(buffer);

            if (!this._localFull) {
                this.flushBuffer();
            }
        });
        this._dataChannel.addEventListener('close', () => {
            process.nextTick(() => {
                this.emit('end');
            });
        });
        this._dataChannel.addEventListener('error', ({ error }) => {
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
                        this._dispatcher.sendControlMessage(this._dataChannel, 'full');
                        this._localFull = true;
                    }
                    return;
                }
            }

            if (this._localFull) {
                this._dispatcher.sendControlMessage(this._dataChannel, 'empty');
                this._localFull = false;
            }
        } catch (error) {
            process.nextTick(() => {
                this.emit('error', error);
            });
        }
    }

    public async _write(chunk: Buffer, encoding: string, callback: (err?: Error) => void): Promise<void> {
        await this._dispatcher.send(this._dataChannel, chunk);
        callback();
    }

    public _final(callback: (err: Error | null) => void): void {
        this._dataChannel.close();
        callback(null);
    }

    public _read(size: number): void {
        this._localFull = false;
        this.flushBuffer();
    }
}
