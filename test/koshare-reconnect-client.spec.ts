import log from 'npmlog';

import KoshareReconnectClient from '../src/koshare-reconnect-client';
import KoshareServer, { KoshareServerHooks } from './koshare-server';
import { delay } from '../src/util';
import { randomPort } from './util';

log.level = 'silent';

type SpiedObject<T> = {
    [key in keyof T]-?: Required<T>[key] extends (...args: infer A) => infer R ? jest.MockContext<R, A> : never;
}

function spyObject<T extends object>(object: T): SpiedObject<T> {
    const result: any = {};
    for (const [key, value] of Object.entries(object)) {
        if (typeof value === 'function') {
            result[key] = jest.spyOn(object, key as any);
        }
    }
    return result;
}

describe('koshare reconnect client', () => {
    let hooks: KoshareServerHooks = {};
    let server!: KoshareServer;
    let client!: KoshareReconnectClient;
    let echo!: KoshareReconnectClient;

    const port = randomPort();

    beforeEach(async () => {
        hooks = {};
        server = await KoshareServer.create({ port }, hooks);
        client = await KoshareReconnectClient.connect('', `ws://localhost:${port}`);
        echo = await KoshareReconnectClient.connect('', `ws://localhost:${port}`);
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

    test('reconnect', async () => {
        await client.subscribe('test', () => { });

        server.close();

        await delay(100);

        server = await KoshareServer.create({ port }, hooks);

        hooks.packet = async (client, id, packet) => {
            return packet;
        };
        const mock = spyObject(hooks);

        await client.boardcast('test');

        expect(client).toHaveProperty('disconnected', false);
        expect(mock.packet).toHaveBeenCalledTimes(1);
    }, 10000);
})
