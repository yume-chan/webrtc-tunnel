import log from 'npmlog';

import { PromiseResolver } from '../src/async-operation-manager';
import { PacketType } from '../src/koshare-client';
import KoshareReconnectClient from '../src/koshare-reconnect-client';
import KoshareServer, { KoshareServerHooks } from './koshare-server';
import { delay } from './util';

log.level = 'silent';

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

describe('koshare reconnect client', () => {
    let hooks: KoshareServerHooks = {};
    let server!: KoshareServer;
    let client!: KoshareReconnectClient;
    let echo!: KoshareReconnectClient;

    beforeEach(async () => {
        hooks = {};
        server = await KoshareServer.create({ port: 8001 }, hooks);
        client = await KoshareReconnectClient.connect('', 'ws://localhost:8001');
        echo = await KoshareReconnectClient.connect('', 'ws://localhost:8001');
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

    test('subscribe', async () => {
        hooks.packet = async (client, id, packet) => {
            return packet;
        };
        const mock = spyObject(hooks);

        const topic = Date.now().toString();
        await client.subscribe(topic, () => { });

        expect(mock.packet.calls.length).toBe(1);
        expect(mock.packet.calls[0][2].type).toBe(PacketType.Subscribe);
        expect(mock.packet.calls[0][2].topic).toBe(topic);
    });

    test('boardcast', async () => {
        const topic = Date.now().toString();

        let resolver = new PromiseResolver<void>();
        await echo.subscribe(topic, () => {
            resolver.resolve();
        });

        hooks.packet = async (client, id, packet) => {
            return packet;
        };
        const mock = spyObject(hooks);

        await client.boardcast(topic, { topic });

        await resolver.promise;

        expect(mock.packet.calls.length).toBe(1);
        expect(mock.packet.calls[0][2].type).toBe(PacketType.Boardcast);
        expect(mock.packet.calls[0][2].topic).toBe(topic);
        expect((mock.packet.calls[0][2] as any).body).toEqual({ topic });
    });

    test('message', async () => {
        const topic = Date.now().toString();

        let mock!: SpiedObject<KoshareServerHooks>;
        let resolver = new PromiseResolver<void>();

        await echo.subscribe(topic, async (packet) => {
            hooks.packet = async (client, id, packet) => {
                return packet;
            };
            mock = spyObject(hooks);

            await echo!.message(topic, packet.src, packet.body);
        });

        await client.subscribe(topic, () => {
            resolver.resolve();
        });

        await client.boardcast(topic, { topic });

        await resolver.promise;

        expect(mock).toBeDefined();
        expect(mock.packet.calls.length).toBe(1);
        expect(mock.packet.calls[0][2].type).toBe(PacketType.Message);
        expect(mock.packet.calls[0][2].topic).toBe(topic);
        expect((mock.packet.calls[0][2] as any).body).toEqual({ topic });
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
