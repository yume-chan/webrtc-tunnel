import WebSocket from 'ws';

import KoshareClient, { PacketType, connectWebSocket, SubscribeResponse } from "./koshare-client";

export default class KoshareReconnectClient extends KoshareClient {
    public static async connect(prefix: string = '', endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareReconnectClient> {
        return new KoshareReconnectClient(prefix, endpoint, await connectWebSocket(endpoint));
    }

    private _endpoint: string;

    private _reconnectPromise: Promise<void> | null = null;

    protected constructor(prefix: string, endpoint: string, socket: WebSocket, keepAliveInterval = 60 * 1000) {
        super(prefix, socket, keepAliveInterval);

        this._endpoint = endpoint;
    }

    private async reconnect(): Promise<void> {
        const socket = await connectWebSocket(this._endpoint);
        this.initializeSocket(socket);

        for (const topic of this._handlers.keys()) {
            await this.sendOperation<SubscribeResponse>(PacketType.Subscribe, topic);
        }

        this._socket = socket;
        this._disconnected = false;
    }

    protected async send(type: PacketType, topic: string, extra?: object): Promise<void> {
        if (this._disconnected) {
            if (this._reconnectPromise === null) {
                this._reconnectPromise = this.reconnect();
            }

            await this._reconnectPromise;
        }

        return super.send(type, topic, extra);
    }
}
