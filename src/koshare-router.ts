import WebSocket from 'ws';
import log from 'npmlog';

log.level = 'verbose';

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

type IncomingPacketHandler<T extends IncomingPacket> = (message: T) => void;

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

export class KoshareRouterClient {
    public static create(endpoint: string = "ws://104.196.187.4:8888"): Promise<KoshareRouterClient> {
        log.info('koshare', 'connecting to endpoint: %s', endpoint);

        return new Promise((resolve, reject) => {
            const socket = new WebSocket(endpoint);
            socket.on("open", () => {
                log.info('koshare', 'connection established');

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

        this.socket.onmessage = ({ data }) => {
            const packet = JSON.parse(data as string) as Packet;

            log.info('koshare', 'packet received: %s', PacketType[packet.type] || 'UNKNOWN');
            log.verbose('koshare', 'full object: %j', packet);

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

        log.info('koshare', 'packet sending: %s', PacketType[type] || 'UNKNOWN');
        log.verbose('koshare', 'full object: %j', body);

        return new Promise((resolve, reject) => {
            this.socket.send(JSON.stringify({ type, topic, ...body }), (err) => {
                if (err) {
                    log.error('koshare', 'packet sending failed');
                    log.error('koshare', err.stack!);

                    reject(err);
                } else {
                    log.info('koshare', 'packet sent');

                    this.resetKeepAlive();
                    resolve();
                }
            })
        })
    }

    private addOperation<T>(): { id: number, promise: Promise<T> } {
        const id = this.id++;
        const promise = new Promise<T>((resolve, reject) => {
            this.operations.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });
        });

        return {
            id,
            promise,
        };
    }

    public async subscribe<T extends IncomingPacket>(topic: string, handler: IncomingPacketHandler<T>): Promise<void> {
        if (!this.handlers.has(topic)) {
            this.handlers.set(topic, new Set());
        }

        this.handlers.get(topic)!.add(handler);

        const { id, promise } = this.addOperation();
        await this.send(PacketType.Subscribe, topic, { id });
        await promise;
    }

    public unsubscribe(topic: string): Promise<void>;
    public unsubscribe<T extends IncomingPacket>(topic: string, handler: IncomingPacketHandler<T>): Promise<void>;
    public async unsubscribe<T extends IncomingPacket>(topic: string, handler?: IncomingPacketHandler<T>): Promise<void> {
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

    public boardcast(topic: string, body?: object): Promise<void> {
        return this.send(PacketType.Boardcast, topic, body);
    }

    public message(topic: string, destination: number, body?: object): Promise<void> {
        return this.send(PacketType.Message, topic, { dst: destination, ...body });
    }
}
