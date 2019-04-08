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

const useSetTimeoutFallback = true;

export default class DataChannelSender {
    private _variable: ConditionalVariable;

    private _channel: RTCDataChannel;

    constructor(channel: RTCDataChannel) {
        this._channel = channel;
        this._channel.bufferedAmountLowThreshold = 1024 * 1024;

        this._variable = new ConditionalVariable(() => channel.bufferedAmount < 16 * 1024 * 1024);

        if (useSetTimeoutFallback) {
            const interval = setInterval(() => {
                this._variable.notify();
            }, 250);

            channel.addEventListener('close', () => {
                clearInterval(interval);
            });
        } else {
            channel.addEventListener('bufferedamountlow', () => {
                this._variable.notify();
            });
        }
    }

    public async send(data: ArrayBuffer): Promise<void> {
        await this._variable.wait();

        try {
            this._channel.send(data);
        } finally {
            this._variable.notify();
        }
    }
}
