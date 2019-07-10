import log from 'npmlog';

import { KoshareClient, KoshareServer } from "@yume-chan/koshare-router";
import { PromiseResolver } from "@yume-chan/async-operation-manager";

import { KoshareRtcSignalTransport } from "../src/koshare-rtc-signal-transport";
import RtcDataConnection from "../src/rtc-data-connection";
import { RtcSignalClient, RtcSignalServer } from "../src/rtc-signal";
import RtcDataChannelStream from "../src/rtc-data-channel-stream";
import { delay } from "../src/util";

import { randomPort, randomString } from "./util";

log.level = 'silent';

describe('rtc data connection', () => {
    let koshareServer!: KoshareServer;

    let serverId!: string;
    let clientId!: string;

    let server!: RtcDataConnection;
    let client!: RtcDataConnection;

    const port = randomPort();

    beforeEach(async (done) => {
        koshareServer = await KoshareServer.listen({ port });

        serverId = randomString();
        clientId = randomString();

        await RtcDataConnection.listen(
            new RtcSignalServer(
                serverId,
                new KoshareRtcSignalTransport(
                    await KoshareClient.connect(`ws://localhost:${port}`))),
            (connection) => {
                server = connection;
                done();
            });

        client = await RtcDataConnection.connect(
            serverId,
            new RtcSignalClient(
                clientId,
                new KoshareRtcSignalTransport(
                    await KoshareClient.connect(`ws://localhost:${port}`))));
    });

    afterEach(async () => {
        if (typeof client !== 'undefined') {
            client.close();
        }

        if (typeof server !== 'undefined') {
            server.close();
        }

        if (typeof koshareServer !== 'undefined') {
            koshareServer.close();
        }
    });

    test('create data channel stream', async (done) => {
        let label = Date.now().toString();

        server.on('data-channel-stream', (remote) => {
            expect(remote.label).toBe(label);

            done();
        });

        await client.createChannelStream(label);
    });

    test('send once', async (done) => {
        let content = randomString();

        server.on('data-channel-stream', (remote) => {
            remote.setEncoding('utf8');

            remote.on('data', (data) => {
                expect(data).toBe(content);
                done();
            });
        });

        const local = await client.createChannelStream(randomString());
        local.write(content, 'utf8');
    });

    test('send multiple', async () => {
        const label = Date.now().toString();
        const data = randomString();

        const handleData = jest.fn((received: string) => {
            expect(received).toBe(data);
        });

        let resolver = new PromiseResolver<RtcDataChannelStream>();
        server.on('data-channel-stream', (connection) => {
            expect(connection).toHaveProperty('label', label);

            connection.setEncoding('utf8');
            resolver.resolve(connection);
        });

        const local = await client.createChannelStream(label);
        const remote = await resolver.promise;

        const count = 10000;
        for (let i = 0; i < count; i++) {
            local.write(data, 'utf8');
        }

        await delay(100);

        remote.on('data', handleData);

        await delay(1000);

        expect(handleData).toBeCalledTimes(count);
    });
});
