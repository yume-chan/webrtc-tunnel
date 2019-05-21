import log from 'npmlog';
import WebSocket from 'ws';

import AsyncOperationManager from './async-operation-manager';
import MultiMap, { ReadonlyMultiMap } from './multi-map';

export enum PacketType {
    Error,
    ECHO,
    Subscribe,
    Unsubscribe,
    Message,
    INFO,
    Boardcast,
    HELLO,
}

export interface IncomingBoardcast {
    type: PacketType.Boardcast;
    topic: string;
    src: number;
}

export interface IncomingMessage {
    type: PacketType.Message;
    topic: string;
    dst: number;
    src: number;
}

export type IncomingPacket<T> = { body: T } & (IncomingMessage | IncomingBoardcast);

type IncomingPacketHandler<T> = (message: IncomingPacket<T>) => void;

export interface SubscribeResponse {
    type: PacketType.Subscribe;
    topic: string;
    id: number;
    peers: number[];
    error?: string;
}

export type Packet = IncomingMessage | IncomingBoardcast | SubscribeResponse;

export type ExcludeCommon<T> = T extends { topic: string }
    ? Pick<T, Exclude<keyof T, 'topic' | 'dst'>>
    : T;

export function connectWebSocket(endpoint: string): Promise<WebSocket> {
    log.info('websocket', `connecting to ${endpoint}`);

    return new Promise((resolve, reject) => {
        function handleOpen() {
            log.verbose('websocket', `connection to ${endpoint} established`);

            socket.off('open', handleOpen);
            socket.off('error', handleError);

            resolve(socket);
        }

        function handleError(error: Error) {
            log.error('websocket', `connection to ${endpoint} failed`);
            log.error('websocket', error.stack!);

            socket.off('open', handleOpen);
            socket.off('error', handleError);

            reject(error);
        }

        const socket = new WebSocket(endpoint);

        socket.on("open", handleOpen);
        socket.on("error", handleError);
    });
}

export default class KoshareClient {
    public static async connect(prefix: string = '', endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareClient> {
        return new KoshareClient(prefix, await connectWebSocket(endpoint));
    }

    private _prefix: string;
    public get prefix(): string { return this._prefix; }

    protected _socket: WebSocket;
    public get socket(): WebSocket { return this._socket; }

    protected _disconnected: boolean;
    public get disconnected(): boolean { return this._disconnected; }

    private _operationManager: AsyncOperationManager = new AsyncOperationManager();

    protected _handlers: MultiMap<string, Function> = new MultiMap();
    public get handlers(): ReadonlyMultiMap<string, Function> { return this._handlers; }

    private _keepAliveInterval: number;

    private _keepAliveTimeoutId: NodeJS.Timeout | null = null;

    protected constructor(prefix: string, socket: WebSocket, keepAliveInterval = 60 * 1000) {
        this._prefix = prefix;

        this.initializeSocket(socket);
        this._socket = socket;
        this._disconnected = false;

        this._keepAliveInterval = keepAliveInterval;
        this.resetKeepAlive();
    }

    protected initializeSocket(socket: WebSocket) {
        socket.onerror = (err) => {
            log.error('koshare', 'connection error:');
            log.error('koshare', err.error.stack);

            this._disconnected = true;
        };
        socket.onclose = () => {
            log.info('koshare', 'connection closed');

            this._disconnected = true;
        };

        socket.onmessage = ({ data }) => {
            const packet = JSON.parse(data as string) as Packet;

            log.verbose('koshare', 'received: %s', PacketType[packet.type] || 'UNKNOWN');
            log.silly('koshare', '%j', packet);

            const topic = packet.topic.substring(this._prefix.length);

            switch (packet.type) {
                case PacketType.Message:
                case PacketType.Boardcast:
                    for (const handler of this._handlers.get(topic)) {
                        handler(packet);
                    }
                    break;
                case PacketType.Subscribe:
                    if (typeof packet.error === 'string') {
                        this._operationManager.reject(packet.id, new Error(packet.error));
                    } else {
                        this._operationManager.resolve(packet.id, packet);
                    }
                    break;
            }
        }

    }

    private resetKeepAlive() {
        if (this._keepAliveTimeoutId !== null) {
            clearTimeout(this._keepAliveTimeoutId);
        }

        this._keepAliveTimeoutId = setTimeout(async () => {
            try {
                await this.send(PacketType.Error, 'keep-alive');
            } catch (e) {
                // do nothing
            }
        }, this._keepAliveInterval);
    }

    protected send(type: PacketType, topic: string, extra?: object): Promise<void> {
        if (this._disconnected) {
            return Promise.reject(new Error('the KoshareRouterClient instance is disconnected'));
        }

        log.verbose('koshare', 'sending: %s %s', PacketType[type] || 'UNKNOWN', topic);
        if (typeof extra === 'object') {
            log.silly('koshare', '%j', extra);
        }

        topic = this._prefix + topic;

        return new Promise((resolve, reject) => {
            this._socket.send(JSON.stringify({ type, topic, ...extra }), (error) => {
                /* istanbul ignore if */
                if (error) {
                    log.error('koshare', 'sending failed');
                    log.error('koshare', error.stack!);

                    reject(error);
                    return;
                }

                log.verbose('koshare', 'sent');

                this.resetKeepAlive();
                resolve();
            });
        });
    }

    protected async sendOperation<T>(type: PacketType, topic: string, body?: object): Promise<T> {
        const { id, promise } = this._operationManager.add<T>();
        await this.send(type, topic, { id, body });
        return await promise;
    }

    public async subscribe<T extends object>(topic: string, handler: IncomingPacketHandler<T>): Promise<void> {
        if (this._handlers.get(topic).length === 0) {
            await this.sendOperation<SubscribeResponse>(PacketType.Subscribe, topic);
        }

        this._handlers.add(topic, handler);
    }

    public unsubscribe(topic: string): Promise<void>;
    public unsubscribe<T extends object>(topic: string, handler: IncomingPacketHandler<T>): Promise<void>;
    public async unsubscribe<T extends object>(topic: string, handler?: IncomingPacketHandler<T>): Promise<void> {
        if (typeof handler === 'undefined') {
            this._handlers.clear(topic);
        } else {
            this._handlers.remove(topic, handler);
        }

        if (this._handlers.get(topic).length === 0) {
            await this.send(PacketType.Unsubscribe, topic);
        }
    }

    public boardcast<T extends object>(topic: string, body?: T): Promise<void> {
        return this.send(PacketType.Boardcast, topic, { body });
    }

    public message<T extends object>(topic: string, destination: number, body?: T): Promise<void> {
        return this.send(PacketType.Message, topic, { dst: destination, body });
    }

    public close() {
        log.verbose('koshare', 'closing');

        this._socket.close();
        clearTimeout(this._keepAliveTimeoutId!);
    }
}
