import { AsyncOperationManager } from "@yume-chan/async";
import { KoshareClient, PacketType, ForwardPacket } from "@yume-chan/koshare-router";

import Lazy from "./lazy";
import { IceCandidateMessage, PingMessage, PongMessage, RtcSignalTransport } from "./rtc-signal";

export enum KoshareRtcSignalTransportTopics {
    Ping = 'ping',
    Pong = 'pong',
    IceCandidate = 'ice-candidate',
}

type OperationMessage<T> = T & { id: number; };

export class KoshareRtcSignalTransport implements RtcSignalTransport {
    private _koshareClient: KoshareClient;

    private _pingHandlers: Set<(message: PingMessage) => void> = new Set();
    private _iceCandidateHandlers: Set<(message: IceCandidateMessage) => void> = new Set();

    private _subscribePing: Lazy<Promise<void>> = new Lazy(() =>
        this._koshareClient.subscribe<OperationMessage<PingMessage>>(
            KoshareRtcSignalTransportTopics.Ping,
            this.handlePingMessage)
    );

    private _subscribePong: Lazy<Promise<void>> = new Lazy(() =>
        this._koshareClient.subscribe<OperationMessage<PongMessage>>(
            KoshareRtcSignalTransportTopics.Pong,
            this.handlePongMessage)
    );

    private _subscribeIceCandidate: Lazy<Promise<void>> = new Lazy(() =>
        this._koshareClient.subscribe<IceCandidateMessage>(
            KoshareRtcSignalTransportTopics.IceCandidate,
            this.handleIceCandidateMessage)
    );

    private _operationManager: AsyncOperationManager = new AsyncOperationManager();

    private _koshareIdToSignalId: Map<number, string> = new Map();
    private _signalIdToKoshareId: Map<string, number> = new Map();

    public constructor(koshareClient: KoshareClient) {
        this._koshareClient = koshareClient;
    }

    private addIdMapping(koshareId: number, signalId: string) {
        this._koshareIdToSignalId.set(koshareId, signalId);
        this._signalIdToKoshareId.set(signalId, koshareId);
    }

    private handlePingMessage = (packet: ForwardPacket<OperationMessage<PingMessage>>): void => {
        if (packet.type !== PacketType.Broadcast) {
            return;
        }

        this.addIdMapping(packet.src, packet.sourceId);
        for (const handler of this._pingHandlers) {
            handler(packet);
        }
    };

    private handlePongMessage = (packet: ForwardPacket<OperationMessage<PongMessage>>): void => {
        const {
            src,
            sourceId,
            id,
        } = packet;

        this.addIdMapping(src, sourceId);
        this._operationManager.resolve(id, packet);
    };

    private handleIceCandidateMessage = (packet: ForwardPacket<IceCandidateMessage>): void => {
        const remoteId = this._koshareIdToSignalId.get(packet.src);
        if (remoteId === undefined) {
            return;
        }

        for (const handler of this._iceCandidateHandlers) {
            handler(packet);
        }
    };

    public async broadcastPing(message: PingMessage): Promise<PongMessage> {
        await Promise.all([this._subscribePong.get(), this._subscribeIceCandidate.get()]);

        const [id, promise] = this._operationManager.add<PongMessage>();
        await this._koshareClient.broadcast(KoshareRtcSignalTransportTopics.Ping, { id, ...message });
        return await promise;
    }

    public async addPingHandler(handler: (message: PingMessage) => void): Promise<void> {
        await this._subscribePing.get();

        this._pingHandlers.add(handler);
    }

    public async sendPong(
        ping: PingMessage,
        message: PongMessage
    ): Promise<void> {
        await this._subscribeIceCandidate.get();

        const { sourceId } = ping;
        const koshareId = this._signalIdToKoshareId.get(sourceId);
        if (typeof koshareId === 'undefined') {
            return;
        }

        return await this._koshareClient.message(
            KoshareRtcSignalTransportTopics.Pong,
            koshareId,
            {
                ...message,
                id: (ping as OperationMessage<PingMessage>).id,
            });
    }

    public async sendIceCandidate(message: IceCandidateMessage): Promise<void> {
        const { destinationId } = message;
        const koshareId = this._signalIdToKoshareId.get(destinationId);
        if (typeof koshareId === 'undefined') {
            return;
        }

        return await this._koshareClient.message(
            KoshareRtcSignalTransportTopics.IceCandidate,
            koshareId,
            message);
    }

    public async addIceCandidateHandler(handler: (message: IceCandidateMessage) => void): Promise<void> {
        this._iceCandidateHandlers.add(handler);
    }

    public close(): void {
        this._koshareClient.close();
    }
}
