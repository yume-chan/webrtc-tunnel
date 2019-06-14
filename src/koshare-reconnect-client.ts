import log from 'npmlog';
import WebSocket from 'ws';

import KoshareClient, { PacketType, connectWebSocket, SubscribeResponse } from "./koshare-client";
import { delay } from './util';

export default class KoshareReconnectClient extends KoshareClient {
    public static async connect(prefix: string = '', endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareReconnectClient> {
        return new KoshareReconnectClient(prefix, endpoint, await connectWebSocket(endpoint));
    }

    private _endpoint: string;

    private _reconnectPromise: Promise<void> | null = null;

    private _closed = false;

    protected constructor(prefix: string, endpoint: string, socket: WebSocket, keepAliveInterval = 60 * 1000) {
        super(prefix, socket, keepAliveInterval);

        this._endpoint = endpoint;
    }

    private async reconnect(): Promise<void> {
        while (true) {
            try {
                log.warn('koshare', 'disconnected, reconnect after 5s');
                await delay(5000);

                const socket = await connectWebSocket(this._endpoint);
                this.prepareSocket(socket);

                this._socket = socket;
                this._disconnected = false;

                for (const topic of this._handlers.keys()) {
                    await this.sendOperation<SubscribeResponse>(PacketType.Subscribe, topic);
                }

                log.info('koshare', 'reconnected');
                return;
            } catch (e) {
                // do nothing
            }
        }
    }

    protected prepareSocket(socket: WebSocket) {
        super.prepareSocket(socket);

        socket.on('close', () => {
            if (!this._closed) {
                this._reconnectPromise = this.reconnect();
            }
        });
    }

    protected async send(type: PacketType, topic: string, extra?: object): Promise<void> {
        if (this._disconnected) {
            await this._reconnectPromise;
        }

        return super.send(type, topic, extra);
    }

    public close() {
        this._closed = true;

        super.close();
    }
}
