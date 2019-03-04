import WebSocket from 'ws';
import log from 'npmlog';

log.level = 'silly';

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

type IncomingPacket = IncomingMessage | IncomingBoardcast;

type IncomingPacketHandler<T extends object> = (message: T & IncomingPacket) => void;

interface PromiseResolver<T> {
    resolve<T>(value: T): void;
    reject(error: Error): void;
}

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

export class KoshareRouterClient {
    public static create(endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareRouterClient> {
        log.verbose('koshare', 'connecting to endpoint: %s', endpoint);

        return new Promise((resolve, reject) => {
            const socket = new WebSocket(endpoint);
            socket.on("open", () => {
                log.verbose('koshare', 'connection established');

                resolve(new KoshareRouterClient(socket));
            });
            socket.on("error", (err) => {
                log.error('koshare', 'connection failed');
                log.error('koshare', err.stack!);

                reject(err);
            })
        })
    }

    public socket: WebSocket;

    public alive: boolean;

    private id: number = 0;

    private operations: Map<number, PromiseResolver<unknown>> = new Map();

    private handlers: Map<string, Set<Function>> = new Map();

    private keepAliveTimeout: NodeJS.Timeout | null = null;

    private constructor(socket: WebSocket) {
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

            switch (packet.type) {
                case PacketType.Message:
                case PacketType.Boardcast:
                    if (this.handlers.has(packet.topic)) {
                        const handlers = this.handlers.get(packet.topic)!;
                        for (const handler of handlers) {
                            (handler as Function)(packet);
                        }
                    }
                    break;
                case PacketType.Subscribe:
                    if (this.operations.has(packet.id)) {
                        const resolver = this.operations.get(packet.id)!;
                        if (typeof packet.error === 'string') {
                            resolver.reject(new Error(packet.error));
                        } else {
                            resolver.resolve(packet);
                        }
                        this.operations.delete(packet.id);
                    }
                    break;
            }
        }

        this.resetKeepAlive();
    }

    private resetKeepAlive() {
        if (this.keepAliveTimeout !== null) {
            clearTimeout(this.keepAliveTimeout);
        }

        this.keepAliveTimeout = setTimeout(async () => {
            await this.send(PacketType.Error, 'keep-alive');
        }, 60 * 1000);
    }

    private send(type: PacketType, topic: string, body?: object): Promise<void> {
        if (!this.alive) {
            Promise.reject(new Error('the KoshareRouterClient instance is disconnected'));
        }

        log.verbose('koshare', 'sending: %s %s', PacketType[type] || 'UNKNOWN', topic);
        if (typeof body === 'object') {
            log.silly('koshare', '%j', body);
        }

        return new Promise((resolve, reject) => {
            this.socket.send(JSON.stringify({ type, topic, ...body }), (err) => {
                if (err) {
                    log.error('koshare', 'sending failed');
                    log.error('koshare', err.stack!);

                    reject(err);
                } else {
                    log.verbose('koshare', 'sent');

                    this.resetKeepAlive();
                    resolve();
                }
            })
        })
    }

    private async sendOperation<T>(type: PacketType, topic: string, body?: object): Promise<T> {
        const id = this.id++;
        const promise = new Promise<T>((resolve, reject) => {
            this.operations.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });
        });

        await this.send(type, topic, { id, ...body });
        return await promise;
    }

    public async subscribe<T extends object>(topic: string, handler: IncomingPacketHandler<T>): Promise<void> {
        if (!this.handlers.has(topic)) {
            this.handlers.set(topic, new Set());
        }
        this.handlers.get(topic)!.add(handler);

        await this.sendOperation<SubscribeResponse>(PacketType.Subscribe, topic);
    }

    public unsubscribe(topic: string): Promise<void>;
    public unsubscribe<T extends object>(topic: string, handler: IncomingPacketHandler<T>): Promise<void>;
    public async unsubscribe<T extends object>(topic: string, handler?: IncomingPacketHandler<T>): Promise<void> {
        if (!this.handlers.has(topic)) {
            return;
        }

        if (typeof handler !== 'undefined') {
            const set = this.handlers.get(topic)!;
            set.delete(handler);
            if (set.size !== 0) {
                return;
            }
        }

        this.handlers.delete(topic);
        return await this.send(PacketType.Unsubscribe, topic);
    }

    public boardcast<T extends object>(topic: string, body?: T): Promise<void> {
        return this.send(PacketType.Boardcast, topic, body);
    }

    public message<T extends object>(topic: string, destination: number, body?: T): Promise<void> {
        return this.send(PacketType.Message, topic, { dst: destination, ...body });
    }

    public close() {
        log.verbose('koshare', 'closing');

        this.socket.close();
        clearTimeout(this.keepAliveTimeout!);
    }
}
