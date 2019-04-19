import log from 'npmlog';
import WebSocket from 'ws';

import AsyncOperationManager from './async-operation-manager';
import MultiMap from './multi-map';

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

export default class KoshareClient {
    public static connect(prefix: string = '', endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareClient> {
        log.verbose('koshare', 'connecting to endpoint: %s', endpoint);

        return new Promise((resolve, reject) => {
            const socket = new WebSocket(endpoint);

            socket.on("open", () => {
                log.verbose('koshare', 'connection established');

                resolve(new KoshareClient(prefix, socket));
            });

            socket.on("error", (err) => {
                log.error('koshare', 'connection failed');
                log.error('koshare', err.stack!);

                reject(err);
            });
        })
    }

    private _prefix: string;
    public get prefix(): string { return this._prefix; }

    public socket: WebSocket;

    public alive: boolean;

    private _operationManager: AsyncOperationManager = new AsyncOperationManager();

    private _handlers: MultiMap<string, Function> = new MultiMap();

    private _keepAliveInterval: number;

    private _keepAliveTimeoutId: NodeJS.Timeout | null = null;

    private constructor(prefix: string, socket: WebSocket, keepAliveInterval = 60 * 1000) {
        this._prefix = prefix;

        this.socket = socket;
        this.alive = true;

        this.socket.onerror = (err) => {
            this.alive = false;
        };
        this.socket.onclose = () => {
            this.alive = false;
        };

        this.socket.onmessage = ({ data }) => {
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

        this._keepAliveInterval = keepAliveInterval;
        this.resetKeepAlive();
    }

    private resetKeepAlive() {
        if (this._keepAliveTimeoutId !== null) {
            clearTimeout(this._keepAliveTimeoutId);
        }

        this._keepAliveTimeoutId = setTimeout(async () => {
            await this.send(PacketType.Error, 'keep-alive');
        }, 60 * 1000);
    }

    private send(type: PacketType, topic: string, extra?: object): Promise<void> {
        if (!this.alive) {
            Promise.reject(new Error('the KoshareRouterClient instance is disconnected'));
        }

        log.verbose('koshare', 'sending: %s %s', PacketType[type] || 'UNKNOWN', topic);
        if (typeof extra === 'object') {
            log.silly('koshare', '%j', extra);
        }

        topic = this._prefix + topic;

        return new Promise((resolve, reject) => {
            this.socket.send(JSON.stringify({ type, topic, ...extra }), (error) => {
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
            })
        });
    }

    private async sendOperation<T>(type: PacketType, topic: string, body?: object): Promise<T> {
        const { id, promise } = this._operationManager.add<T>();
        await this.send(type, topic, { id, body });
        return await promise;
    }

    public async subscribe<T extends object>(topic: string, handler: IncomingPacketHandler<T>): Promise<void> {
        await this.sendOperation<SubscribeResponse>(PacketType.Subscribe, topic);
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

        this.socket.close();
        clearTimeout(this._keepAliveTimeoutId!);
    }
}
