import { randomBytes } from "crypto";
import log from 'npmlog';

import KoshareClient from "../src/koshare-client";
import { KoshareRtcSignalTransport } from "../src/koshare-rtc-signal-transport";
import RtcDataConnection from "../src/rtc-data-connection";
import { RtcSignalClient, RtcSignalServer } from "../src/rtc-signal";
import KoshareServer from "./koshare-server";
import { delay } from "./util";
import RtcDataChannelStream from "../src/rtc-data-channel-stream";
import { PromiseResolver } from "../src/async-operation-manager";

log.level = 'silent';

describe('rtc data connection', () => {
    let koshareServer!: KoshareServer;

    let serverId!: string;
    let clientId!: string;

    let server!: RtcDataConnection;
    let client!: RtcDataConnection;

    beforeEach(async (done) => {
        koshareServer = await KoshareServer.create({ port: 8003 });

        serverId = randomBytes(8).toString('base64');
        clientId = randomBytes(8).toString('base64');

        await RtcDataConnection.listen(
            new RtcSignalServer(
                serverId,
                new KoshareRtcSignalTransport(
                    await KoshareClient.connect('', 'ws://localhost:8003'))),
            (connection) => {
                server = connection;

                done();
            });
        client = await RtcDataConnection.connect(
            serverId,
            new RtcSignalClient(
                clientId,
                new KoshareRtcSignalTransport(
                    await KoshareClient.connect('', 'ws://localhost:8003'))));
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
        let label = Date.now().toString();

        server.on('data-channel-stream', (remote) => {
            remote.setEncoding('utf8');

            remote.on('data', (data) => {
                expect(data).toBe(label);

                done();
            });
        });

        const local = await client.createChannelStream(label);
        local.write(label, 'utf8');
    });

    test('send multiple', async () => {
        let label = Date.now().toString();

        const handleData = jest.fn((data: string) => {
            expect(data).toBe(label);
        });

        let resolver = new PromiseResolver<RtcDataChannelStream>();
        server.on('data-channel-stream', (connection) => {
            connection.setEncoding('utf8');
            resolver.resolve(connection);
        });

        const local = await client.createChannelStream(label);
        const remote = await resolver.promise;

        const count = 10000;
        for (let i = 0; i < count; i++) {
            local.write(label, 'utf8');
        }

        await delay(100);

        remote.on('data', handleData);

        await delay(1000);

        expect(handleData).toBeCalledTimes(count);
    });
});
