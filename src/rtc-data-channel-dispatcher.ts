import { PromiseResolver } from "@yume-chan/async-operation-manager";

interface RtcDataChannelMessage {
    resolver: PromiseResolver<void>;

    data: string | ArrayBuffer;
}

const resolvedPromise = Promise.resolve();

function waitDataChannelBufferAmountLow(channel: RTCDataChannel): Promise<void> {
    const bufferLowAmount = 1024 * 1024;

    if (channel.bufferedAmount < bufferLowAmount) {
        return resolvedPromise;
    }

    const resolver = new PromiseResolver<void>();
    const intervalId = setInterval(() => {
        if (channel.readyState !== 'open') {
            resolver.reject(new Error(`readyState is not 'open'`));
        }

        if (channel.bufferedAmount < bufferLowAmount) {
            resolver.resolve();
            clearInterval(intervalId);
        }
    }, 500);
    return resolver.promise;
}

interface RtcDataChannelControlMessageBase {
    type: string;

    label: string;
}

interface RtcDataChannelEmptyControlMessage extends RtcDataChannelControlMessageBase {
    type: 'empty';
}

interface RtcDataChannelFullControlMessage extends RtcDataChannelControlMessageBase {
    type: 'full';
}

type RtcDataChannelControlMessage = RtcDataChannelEmptyControlMessage | RtcDataChannelFullControlMessage;

class RtcDataChannelMessageQueue {
    private _channel: RTCDataChannel;
    public get channel(): RTCDataChannel { return this._channel; }

    private _queue: RtcDataChannelMessage[] = [];
    public get length() { return this._queue.length; }

    public remoteFull: boolean = false;

    constructor(channel: RTCDataChannel) {
        this._channel = channel;
    }

    public enqueue(data: string | ArrayBuffer): Promise<void> {
        const resolver = new PromiseResolver<void>();
        this._queue.push({ resolver, data });
        return resolver.promise;
    }

    public dequeue(): RtcDataChannelMessage | undefined {
        return this._queue.shift();
    }
}

export class RtcDataChannelDispatcher {
    private _connection: RTCPeerConnection;

    private _control: RTCDataChannel;

    private _controlQueue: RtcDataChannelMessageQueue;

    private _queues: Map<string, RtcDataChannelMessageQueue> = new Map();

    constructor(connection: RTCPeerConnection, control: RTCDataChannel) {
        this._connection = connection;

        this._control = control;
        this._controlQueue = new RtcDataChannelMessageQueue(this._control);
        this._control.addEventListener('message', ({ data }: { data: string }) => {
            const message: RtcDataChannelControlMessage = JSON.parse(data);

            const queue = this._queues.get(message.label);
            if (typeof queue === 'undefined') {
                return;
            }

            switch (message.type) {
                case 'full':
                    queue.remoteFull = true;
                    break;
                case 'empty':
                    queue.remoteFull = false;
                    this.processQueues();
                    break;
            }
        });
    }

    public addDataChannel(channel: RTCDataChannel): void {
        this._queues.set(channel.label, new RtcDataChannelMessageQueue(channel));

        channel.addEventListener('close', () => {
            this._queues.delete(channel.label);
        });
    }

    private _processingControlQueue = false;

    private async processControlQueue() {
        if (this._processingControlQueue) {
            return;
        }

        this._processingControlQueue = true;

        while (this._controlQueue.length) {
            await waitDataChannelBufferAmountLow(this._control);
            const message = this._controlQueue.dequeue()!;
            this._control.send(message.data as any)
        }

        this._processingControlQueue = false;

        this.processQueues();
    }

    public sendControlMessage(channel: RTCDataChannel, type: 'full' | 'empty') {
        this._controlQueue.enqueue(JSON.stringify({ label: channel.label, type }));
        this.processControlQueue();
    }

    private _processingQueues = false;

    private async processQueues() {
        if (this._processingQueues) {
            return;
        }

        this._processingQueues = true;

        while (true) {
            if (this._processingControlQueue) {
                break;
            }

            const queues = Array.from(this._queues.values());
            const pending = queues.filter(x => !x.remoteFull && x.length);

            if (pending.length === 0) {
                break;
            }

            pending.sort((a, b) => a.channel.bufferedAmount - b.channel.bufferedAmount);
            const candidate = pending[0];

            const message = candidate.dequeue()!;
            try {
                await waitDataChannelBufferAmountLow(candidate.channel);
                candidate.channel.send(message.data as any);
                message.resolver.resolve();
            } catch (e) {
                message.resolver.reject(e);
            }
        }

        this._processingQueues = false;
    }

    public async send(channel: RTCDataChannel, data: ArrayBuffer): Promise<void> {
        const result = this._queues.get(channel.label)!.enqueue(data);
        this.processQueues();
        return result;
    }
}
