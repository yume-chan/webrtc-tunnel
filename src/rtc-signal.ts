import MultiMap from '@yume-chan/multi-map';

import Lazy from './lazy';

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export interface RtcSignalTransport {
    broadcastPing(message: PingMessage): Promise<PongMessage>;

    addPingHandler(handler: (message: PingMessage) => void): Promise<void>;

    sendPong(ping: PingMessage, message: PongMessage): Promise<void>;

    sendIceCandidate(message: IceCandidateMessage): Promise<void>;

    addIceCandidateHandler(handler: (message: IceCandidateMessage) => void): Promise<void>;

    close(): void;
}

interface SignalMessage {
    sourceId: string;

    destinationId: string;
}

export interface PingMessage extends SignalMessage {
    offer: RTCSessionDescriptionInit;
}

export interface PongMessage extends SignalMessage {
    answer: RTCSessionDescriptionInit;
}

export interface IceCandidateMessage extends SignalMessage {
    candidate: RTCIceCandidate;
}

type IceCandidateHandler = (candidate: RTCIceCandidate) => void;

abstract class RtcSignalBase {
    protected _id: string;
    public get id(): string { return this._id; }

    protected _transportation: RtcSignalTransport;

    protected _iceCandidateHandlers: MultiMap<string, IceCandidateHandler> = new MultiMap();

    protected _addIceCandidateHandler: Lazy<Promise<void>> = new Lazy(() =>
        this._transportation.addIceCandidateHandler(this.handleIceCandidateMessage)
    )

    protected constructor(localId: string, transportation: RtcSignalTransport) {
        this._id = localId;
        this._transportation = transportation;
    }

    private handleIceCandidateMessage = (message: IceCandidateMessage): void => {
        for (const handler of this._iceCandidateHandlers.get(message.sourceId)) {
            handler(message.candidate);
        }
    }

    public addIceCandidateListener(remoteId: string, handler: IceCandidateHandler): void {
        this._iceCandidateHandlers.add(remoteId, handler);
    }

    public removeIceCandidateListener(remoteId: string, handler: IceCandidateHandler): void {
        this._iceCandidateHandlers.delete(remoteId, handler);
    }

    public async sendIceCandidate(remoteId: string, candidate: RTCIceCandidate): Promise<void> {
        return this._transportation.sendIceCandidate({ sourceId: this._id, destinationId: remoteId, candidate });
    }

    public close() {
        this._transportation.close();
    }
}

export class RtcSignalClient extends RtcSignalBase {
    public constructor(id: string, transportation: RtcSignalTransport) {
        super(id, transportation);
    }

    public async ping(remoteId: string, offer: RTCSessionDescriptionInit): Promise<PongMessage> {
        await this._addIceCandidateHandler.get();
        return await this._transportation.broadcastPing({ sourceId: this._id, destinationId: remoteId, offer });
    }
}

export class RtcSignalServer extends RtcSignalBase {
    private _pingHandlers: Set<(message: PingMessage) => void> = new Set();

    private _addPingHandler: Lazy<Promise<void>> = new Lazy(() =>
        this._transportation.addPingHandler(this.handlePingMessage)
    );

    public constructor(id: string, transportation: RtcSignalTransport) {
        super(id, transportation);
    }

    private handlePingMessage = (message: PingMessage): void => {
        if (message.destinationId === this._id) {
            for (const handler of this._pingHandlers) {
                handler(message);
            }
        }
    }

    public async listen(handler: (message: PingMessage) => void): Promise<void> {
        await this._addIceCandidateHandler.get();
        await this._addPingHandler.get();

        this._pingHandlers.add(handler);
    }

    public pong(ping: PingMessage, answer: RTCSessionDescriptionInit): Promise<void> {
        return this._transportation.sendPong(ping, {
            destinationId: ping.sourceId,
            sourceId: ping.destinationId,
            answer,
        });
    }
}
