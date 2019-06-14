import log from 'npmlog';

import KoshareClient from "../src/koshare-client";
import { KoshareRtcSignalTransport } from "../src/koshare-rtc-signal-transport";
import { PingMessage } from "../src/rtc-signal";
import KoshareServer from "./koshare-server";
import { createRtcIceCandidate, randomPort } from "./util";
import { randomString } from "./util";

log.level = 'silent';

describe('koshare rtc signal transportation', () => {
    let koshareServer!: KoshareServer;

    let serverId!: string;
    let clientId!: string;

    let server!: KoshareRtcSignalTransport;
    let client!: KoshareRtcSignalTransport;

    const port = randomPort();

    beforeEach(async () => {
        koshareServer = await KoshareServer.create({ port });

        serverId = randomString();
        clientId = randomString();

        server = new KoshareRtcSignalTransport(
            await KoshareClient.connect('', `ws://localhost:${port}`));
        client = new KoshareRtcSignalTransport(
            await KoshareClient.connect('', `ws://localhost:${port}`));
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

    test('ping pong', async () => {
        const handlePing = jest.fn(async (ping: PingMessage) => {
            await server.sendPong(ping, {
                sourceId: ping.destinationId,
                destinationId: ping.sourceId,
                answer: ping.offer,
            });
        });

        await server.addPingHandler(handlePing);

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        const pong = await client.boardcastPing({ sourceId: clientId, destinationId: serverId, offer });

        expect(handlePing).toBeCalledTimes(1);
        expect(handlePing.mock.calls[0][0].sourceId).toBe(clientId);
        expect(handlePing.mock.calls[0][0].destinationId).toBe(serverId);
        expect(handlePing.mock.calls[0][0].offer).toEqual(offer);

        expect(pong.sourceId).toBe(serverId);
        expect(pong.destinationId).toBe(clientId);
        expect(pong.answer).toEqual(offer);
    });

    test('client ice candidate', async (callback) => {
        await server.addPingHandler(async (ping) => {
            await server.sendPong(ping, {
                sourceId: ping.destinationId,
                destinationId: ping.sourceId,
                answer: ping.offer,
            });
        });

        const candidate = createRtcIceCandidate();

        await server.addIceCandidateHandler((message) => {
            expect(message.sourceId).toBe(clientId);
            expect(message.destinationId).toBe(serverId);
            expect(message.candidate).toEqual(candidate.toJSON());

            callback();
        });

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        await client.boardcastPing({ sourceId: clientId, destinationId: serverId, offer });

        await client.sendIceCandidate({ sourceId: clientId, destinationId: serverId, candidate });
    });

    test('server ice candidate', async (callback) => {
        const candidate = createRtcIceCandidate();

        await server.addPingHandler(async (ping) => {
            await server.sendPong(ping, {
                sourceId: ping.destinationId,
                destinationId: ping.sourceId,
                answer: ping.offer,
            });

            await server.sendIceCandidate({
                sourceId: ping.destinationId,
                destinationId: ping.sourceId,
                candidate,
            });
        });

        await client.addIceCandidateHandler((message) => {
            expect(message.sourceId).toBe(serverId);
            expect(message.destinationId).toBe(clientId);
            expect(message.candidate).toEqual(candidate.toJSON());

            callback();
        });

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        await client.boardcastPing({ sourceId: clientId, destinationId: serverId, offer });
    });
});
