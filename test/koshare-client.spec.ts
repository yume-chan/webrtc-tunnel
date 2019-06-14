import log from 'npmlog';

import { PromiseResolver } from '../src/async-operation-manager';
import KoshareClient, { PacketType } from '../src/koshare-client';
import KoshareServer, { KoshareServerHooks } from './koshare-server';
import { delay } from '../src/util';
import { randomString, randomPort } from './util';

log.level = 'silent';

const noop = () => { };

type SpiedObject<T> = {
    [key in keyof T]-?: Required<T>[key] extends (...args: infer A) => infer R ? jest.MockContext<R, A> : never;
}

function spyObject<T extends object>(object: T): SpiedObject<T> {
    const result: any = {};
    for (const [key, value] of Object.entries(object)) {
        if (typeof value === 'function') {
            result[key] = jest.spyOn(object, key as any).mock;
        }
    }
    return result;
}

interface Data {
    data: string;
}

describe('koshare client', () => {
    let hooks: KoshareServerHooks = {};
    let server!: KoshareServer;
    let client!: KoshareClient;
    let echo!: KoshareClient;

    const port = randomPort();

    beforeEach(async () => {
        hooks = {};
        server = await KoshareServer.create({ port }, hooks);
        client = await KoshareClient.connect('', `ws://localhost:${port}`);
        echo = await KoshareClient.connect('', `ws://localhost:${port}`);
    });

    afterEach(() => {
        if (typeof echo !== 'undefined') {
            echo.close();
        }

        if (typeof client !== 'undefined') {
            client.close();
        }

        if (typeof server !== 'undefined') {
            server.close();
        }
    });

    describe('connect', () => {
        it('should success', async () => {
            const prefix = randomString();
            const client = await KoshareClient.connect(prefix, `ws://localhost:${port}`);

            expect(client.prefix).toBe(prefix);
            expect(client.socket).toBeTruthy();
        })

        it('should throw when error', () => {
            return expect(KoshareClient.connect('', 'ws://localhost:7999')).rejects.toThrow();
        });
    });

    describe('subscribe', () => {
        it('should success', async () => {
            hooks.packet = async (client, id, packet) => {
                return packet;
            };
            const mock = spyObject(hooks);

            const topic = Date.now().toString();
            await client.subscribe(topic, noop);

            expect(mock.packet.calls.length).toBe(1);
            expect(mock.packet.calls[0][2].type).toBe(PacketType.Subscribe);
            expect(mock.packet.calls[0][2].topic).toBe(topic);
        });

        it('should throw when disconnected', async () => {
            client.close();

            const topic = Date.now().toString();
            return expect(client.subscribe(topic, noop)).rejects.toThrow();
        })
    });

    describe('boardcast', () => {
        it('should success', async () => {
            const topic = Date.now().toString();
            const data = randomString();

            let resolver = new PromiseResolver<void>();
            await echo.subscribe<Data>(topic, () => {
                resolver.resolve();
            });

            hooks.packet = async (client, id, packet) => {
                return packet;
            };
            const mock = spyObject(hooks);

            await client.boardcast<Data>(topic, { data });

            await resolver.promise;

            expect(mock.packet.calls.length).toBe(1);
            expect(mock.packet.calls[0][2].type).toBe(PacketType.Boardcast);
            expect(mock.packet.calls[0][2].topic).toBe(topic);
            expect((mock.packet.calls[0][2] as any).data).toEqual(data);
        });

        it('should throw if containing invalid body', () => {
            const topic = Date.now().toString();
            return expect(client.boardcast(topic, { topic })).rejects.toThrow();
        });
    });

    test('message', async () => {
        const topic = Date.now().toString();
        const data = randomString();

        let mock!: SpiedObject<KoshareServerHooks>;
        let resolver = new PromiseResolver<void>();

        await echo.subscribe<Data>(topic, async (packet) => {
            hooks.packet = async (client, id, packet) => {
                return packet;
            };
            mock = spyObject(hooks);

            await echo!.message<Data>(topic, packet.src, { data: packet.data });
        });

        await client.subscribe(topic, () => {
            resolver.resolve();
        });

        await client.boardcast<Data>(topic, { data });

        await resolver.promise;

        expect(mock).toBeDefined();
        expect(mock.packet.calls.length).toBe(1);
        expect(mock.packet.calls[0][2].type).toBe(PacketType.Message);
        expect(mock.packet.calls[0][2].topic).toBe(topic);
        expect((mock.packet.calls[0][2] as any).data).toEqual(data);
    });

    test('unsubscribe handler', async () => {
        const topic = Date.now().toString();
        const handler = jest.fn(() => { });

        await echo.subscribe(topic, handler);
        await client.boardcast(topic);

        await delay(100);

        await echo.unsubscribe(topic, handler);
        await client.boardcast(topic);

        await delay(100);

        expect(handler).toBeCalledTimes(1);
    });

    test('unsubscribe topic', async () => {
        const topic = Date.now().toString();
        const handler = jest.fn(() => { });

        await echo.subscribe(topic, handler);
        await client.boardcast(topic);

        await delay(100);

        await echo.unsubscribe(topic);
        await client.boardcast(topic);

        await delay(100);

        expect(handler).toBeCalledTimes(1);
    });
})
