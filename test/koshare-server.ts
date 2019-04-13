import { Server, ServerOptions } from 'ws';

import { PromiseResolver } from '../src/async-operation-manager';
import { PacketType } from '../src/koshare-client';
import MultiMap from '../src/multi-map';

export interface PacketBase {
    type: PacketType;

    topic: string;

    error?: string;
}

export interface SubscribePacket extends PacketBase {
    type: PacketType.Subscribe;

    peers: number[];
}

export interface UnsubscribePacket extends PacketBase {
    type: PacketType.Unsubscribe;
}

export interface BoardcastPacket extends PacketBase {
    type: PacketType.Boardcast;

    src: number;
}

export interface MessagePacket extends PacketBase {
    type: PacketType.Message,

    src: number;

    dst: number;
}

export interface ErrorPacket extends PacketBase {
    type: PacketType.Error;
}

type Packet = SubscribePacket | UnsubscribePacket | BoardcastPacket |
    MessagePacket | ErrorPacket;

export interface KoshareServerHooks {
    connection?(client: WebSocket, id: number): boolean | Promise<boolean>;

    message?(client: WebSocket, id: number, message: string): Promise<Packet>;

    packet?(client: WebSocket, id: number, packet: Packet): Promise<Packet | undefined>;
}

export default class KoshareServer {
    static async create(options?: ServerOptions, hooks: KoshareServerHooks | null = null): Promise<KoshareServer> {
        const resolver = new PromiseResolver<void>();

        const result = new KoshareServer(options, hooks);
        result._server.on('listening', () => {
            resolver.resolve();
        });

        await resolver.promise;
        return result;
    }

    private _server: Server;

    private _id: number = 0;

    private _topicPeers: MultiMap<string, number> = new MultiMap();

    private _connections: Map<number, WebSocket> = new Map();

    private _hook: KoshareServerHooks | null = null;

    private constructor(options?: ServerOptions, hook: KoshareServerHooks | null = null) {
        this._server = new Server(options);
        this._server.on('connection', this.handleClient);

        this._hook = hook;
    }

    private subscribe(id: number, topic: string): boolean {
        if (this._topicPeers.get(topic).includes(id)) {
            return false;
        }

        this._topicPeers.add(topic, id);
        return true;
    }

    private unsubscribe(id: number, topic: string): boolean {
        if (!this._topicPeers.get(topic).includes(id)) {
            return false;
        }

        this._topicPeers.remove(topic, id);
        return true;
    }

    private handleClient = async (client: WebSocket) => {
        const id = this._id++;

        if (this._hook !== null && typeof this._hook.connection === 'function') {
            if (!(await this._hook.connection(client, id))) {
                client.close();
            }
        }

        this._connections.set(id, client);

        client.addEventListener('message', async ({ data: message }: { data: string }) => {
            let packet: Packet;

            if (this._hook !== null && typeof this._hook.message === 'function') {
                packet = await this._hook.message(client, id, message);
            } else {
                if (message.length > 65000) {
                    client.send(JSON.stringify({ error: 'MessageIsTooLong' }));
                    return;
                }

                try {
                    packet = JSON.parse(message);
                } catch (error) {
                    client.send(JSON.stringify({ error: 'InvalidJSON' }));
                    return;
                }
            }

            if (this._hook !== null && typeof this._hook.packet === 'function') {
                const transformed = await this._hook.packet(client, id, packet);

                if (typeof transformed === 'undefined') {
                    return;
                }

                packet = transformed;
            }

            if (typeof packet !== 'object' || packet === null ||
                typeof packet.type !== 'number' || typeof packet.topic !== 'string') {
                packet.error = 'InvalidParams';
                client.send(JSON.stringify(packet));
                return;
            }

            const { topic } = packet;

            if (packet.topic.length > 30) {
                packet.error = 'TopicNameIsTooLong';
                client.send(JSON.stringify(packet));
                return;
            }

            switch (packet.type) {
                case PacketType.Subscribe:
                    if (!this.subscribe(id, topic)) {
                        packet.error = 'AlreadySubscribed';
                        client.send(JSON.stringify(packet));
                        break;
                    }

                    const hello = JSON.stringify({
                        type: PacketType.HELLO,
                        topic,
                        src: id,
                    });

                    const peers: number[] = [];
                    for (const item of this._topicPeers.get(topic)) {
                        if (item !== id) {
                            peers.push(item);
                            this._connections.get(item)!.send(hello);
                        }
                    }

                    packet.peers = peers;
                    client.send(JSON.stringify(packet));
                    break;

                case PacketType.Unsubscribe:
                    if (!this.unsubscribe(id, topic)) {
                        packet.error = 'NotSubscribed';
                        client.send(JSON.stringify(packet));
                    }
                    break;

                case PacketType.Boardcast:
                    packet.src = id;
                    let boardcast = JSON.stringify(packet);
                    for (const item of this._topicPeers.get(topic)) {
                        if (item !== id) {
                            this._connections.get(item)!.send(boardcast);
                        }
                    }
                    break;

                case PacketType.Message:
                    if (typeof packet.dst !== 'number') {
                        packet.error = 'NoDestination';
                        client.send(JSON.stringify(packet));
                        break;
                    }

                    if (!this._topicPeers.get(topic).includes(packet.dst)) {
                        break;
                    }

                    packet.src = id;
                    this._connections.get(packet.dst)!.send(JSON.stringify(packet));
                    break;

                case PacketType.Error:
                    break;

                default:
                    client.send(JSON.stringify({ error: 'UnsupportedMessageType' }));
                    break;
            }
        });

        client.addEventListener('error', () => {
            for (const key of this._topicPeers.keys()) {
                this._topicPeers.remove(key, id);
            }
            this._connections.delete(id);
        });

        client.addEventListener('close', () => {
            for (const key of this._topicPeers.keys()) {
                this._topicPeers.remove(key, id);
            }
            this._connections.delete(id);
        });
    }

    public close() {
        this._server.close();
    }
}
