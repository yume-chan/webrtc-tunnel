import { Duplex } from 'stream';

class ConditionVariable {
    private static resolvedPromise = Promise.resolve();

    private _queue: Array<() => void> = [];

    private _condition: () => boolean;

    constructor(condition: () => boolean) {
        this._condition = condition;
    }

    public wait(): Promise<void> {
        if (this._condition()) {
            return ConditionVariable.resolvedPromise;
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

    private _variable: ConditionVariable;

    private _remoteFull: boolean = false;
    private _localFull: boolean = false;

    private _buffer: Buffer[] = [];

    public get label(): string { return this._dataChannel.label; }

    public constructor(dataChannel: RTCDataChannel, controlChannel: RTCDataChannel) {
        super({ allowHalfOpen: false });

        this._controlChannel = controlChannel;
        this._controlChannel.addEventListener('message', this.handleControlMessage);

        this._dataChannel = dataChannel;
        this._dataChannel.binaryType = 'arraybuffer';

        this._variable = new ConditionVariable(this.canSend);

        if (useSetTimeoutFallback) {
            const interval = setInterval(() => {
                this._variable.notify();
            }, 250);

            this._dataChannel.addEventListener('close', () => {
                clearInterval(interval);
            });
        } else {
            this._dataChannel.bufferedAmountLowThreshold = 1024 * 1024;

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
        });
    }

    private sendControlMessage(type: 'empty' | 'full') {
        this._controlChannel.send(JSON.stringify({
            type,
            label: this._dataChannel.label,
        }));
    }

    private flushBuffer(): void {
        try {
            while (this._buffer.length) {
                if (!this.push(this._buffer.shift())) {
                    if (!this._localFull) {
                        this.sendControlMessage('full');
                        this._localFull = true;
                    }
                    return;
                }
            }

            if (this._localFull) {
                this.sendControlMessage('empty');
                this._localFull = false;
            }
        } catch (error) {
            process.nextTick(() => {
                this.emit('error', error);
            });
        }
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
        return !this._remoteFull && this._dataChannel.bufferedAmount < 4 * 1024 * 1024;
    }

    public async _write(chunk: Buffer, encoding: string, callback: (err?: Error) => void): Promise<void> {
        await this._variable.wait();

        try {
            this._dataChannel.send(chunk);
            callback();
            this._variable.notify();
        } catch (error) {
            callback(error);
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
