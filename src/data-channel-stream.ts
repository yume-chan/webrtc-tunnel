import { Duplex } from 'stream';
const resolvedPromise = Promise.resolve();

class ConditionalVariable {
    private _queue: Array<() => void> = [];

    private _condition: () => boolean;

    constructor(condition: () => boolean) {
        this._condition = condition;
    }

    public wait(): Promise<void> {
        if (this._condition()) {
            return resolvedPromise;
        }

        const promise = new Promise<void>(resolve => {
            this._queue.push(resolve);
        });
        return promise;
    }

    public notify() {
        if (this._queue.length === 0) {
            return;
        }

        if (!this._condition()) {
            return;
        }

        this._queue.shift()!();
    }
}

interface ControlMessage {
    type: string;

    label: string;
}

interface EmptyControlMessage extends ControlMessage {
    type: 'empty';
}

interface FullControlMessage extends ControlMessage {
    type: 'full';
}

type ControlMessages = EmptyControlMessage | FullControlMessage;

const useSetTimeoutFallback = true;

export default class RtcDataChannelStream extends Duplex {
    private _dataChannel: RTCDataChannel;

    private _controlChannel: RTCDataChannel;

    private _variable: ConditionalVariable;

    private _remoteFull: boolean = false;
    private _localFull: boolean = false;

    private _buffer: Buffer[] = [];

    public constructor(dataChannel: RTCDataChannel, controlChannel: RTCDataChannel) {
        super({ allowHalfOpen: false });

        this._controlChannel = controlChannel;
        this._controlChannel.binaryType = 'string';
        this._controlChannel.addEventListener('message', this.handleControlMessage);

        this._dataChannel = dataChannel;
        this._dataChannel.binaryType = 'arraybuffer';
        this._dataChannel.bufferedAmountLowThreshold = 1024 * 1024;

        this._variable = new ConditionalVariable(this.canSend);

        if (useSetTimeoutFallback) {
            const interval = setInterval(() => {
                this._variable.notify();
            }, 250);

            this._dataChannel.addEventListener('close', () => {
                clearInterval(interval);
            });
        } else {
            this._dataChannel.addEventListener('bufferedamountlow', () => {
                this._variable.notify();
            });
        }

        this._dataChannel.addEventListener('message', ({ data }: { data: ArrayBuffer }) => {
            const buffer = Buffer.from(data);
            this._buffer.push(buffer);

            if (!this._localFull) {
                this.flushBuffer();
            }
        });

        this._dataChannel.addEventListener('close', () => {
            this._controlChannel.removeEventListener('message', this.handleControlMessage);

            process.nextTick(() => {
                this.emit('end');
            });
        });

        this._dataChannel.addEventListener('error', ({ error }) => {
            process.nextTick(() => {
                this.emit('error', error);
            });
        })
    }

    private flushBuffer(): void {
        while (this._buffer.length) {
            if (!this.push(this._buffer.unshift())) {
                this._localFull = true;
                this._controlChannel.send(JSON.stringify({ type: 'full', label: this._dataChannel.label }));
                return;
            }
        }

        this._controlChannel.send(JSON.stringify({ type: 'empty', label: this._dataChannel.label }));
    }

    private handleControlMessage = ({ data }: { data: string }) => {
        const message: ControlMessages = JSON.parse(data);
        if (message.label === this._dataChannel.label) {
            switch (message.type) {
                case 'empty':
                    this._remoteFull = false;
                    this._variable.notify();
                    break;
                case 'full':
                    this._remoteFull = true;
                    break;
            }
        }
    }

    private canSend = () => {
        return !this._remoteFull && this._dataChannel.bufferedAmount < 16 * 1024 * 1024;
    }

    public async _write(chunk: Buffer, encoding: string, callback: (err?: Error) => void): Promise<void> {
        await this._variable.wait();

        try {
            this._dataChannel.send(chunk);
            callback();
        } catch (err) {
            callback(err);
        } finally {
            this._variable.notify();
        }
    }

    public _destroy(error: Error, callback: (err: Error | null) => void): void {
        this._dataChannel.close();
        callback(null);
    }

    public _read(size: number): void {
        this._localFull = false;
        this.flushBuffer();
    }
}
