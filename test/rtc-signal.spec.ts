import { randomBytes } from "crypto";

import KoshareClient from "../src/koshare-client";
import { KoshareRtcSignalTransport } from "../src/koshare-rtc-signal-transport";
import KoshareServer from "./koshare-server";
import { RtcSignalServer, RtcSignalClient, PingMessage } from "../src/rtc-signal";
import { createRtcIceCandidate, delay } from "./util";

describe('rtc signal', () => {
    let koshareServer!: KoshareServer;

    let serverId!: string;
    let clientId!: string;

    let server!: RtcSignalServer;
    let client!: RtcSignalClient;

    beforeEach(async () => {
        koshareServer = await KoshareServer.create({ port: 8002 });

        serverId = randomBytes(8).toString('base64');
        clientId = randomBytes(8).toString('base64');

        server = new RtcSignalServer(
            serverId,
            new KoshareRtcSignalTransport(
                await KoshareClient.connect('', 'ws://localhost:8002')));
        client = new RtcSignalClient(
            clientId,
            new KoshareRtcSignalTransport(
                await KoshareClient.connect('', 'ws://localhost:8002')));
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

    test('.id', () => {
        expect(client.id).toBe(clientId);
        expect(server.id).toBe(serverId);
    });

    test('ping pong', async () => {
        const handlePing = jest.fn(async (ping: PingMessage) => {
            await server.pong(ping, ping.offer);
        });

        await server.listen(handlePing);

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        const pong = await client.ping(serverId, offer);

        expect(handlePing).toBeCalledTimes(1);
        expect(handlePing.mock.calls[0][0].sourceId).toBe(clientId);
        expect(handlePing.mock.calls[0][0].destinationId).toBe(serverId);
        expect(handlePing.mock.calls[0][0].offer).toEqual(offer);

        expect(pong.sourceId).toBe(serverId);
        expect(pong.destinationId).toBe(clientId);
        expect(pong.answer).toEqual(offer);
    });

    test('client ice candidate', async (done) => {
        await server.listen(async (ping) => {
            await server.pong(ping, ping.offer);
        });

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        await client.ping(serverId, offer);

        const candidate = createRtcIceCandidate();

        await server.addIceCandidateListener(clientId, (message) => {
            expect(message).toEqual(candidate.toJSON());

            done();
        });

        await client.sendIceCandidate(serverId, candidate);
    });

    test('server ice candidate', async (done) => {
        await server.listen(async (ping) => {
            await server.pong(ping, ping.offer);
        });

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        await client.ping(serverId, offer);

        const candidate = createRtcIceCandidate();

        await client.addIceCandidateListener(serverId, (message) => {
            expect(message).toEqual(candidate.toJSON());

            done();
        });

        await server.sendIceCandidate(clientId, candidate);
    });

    test('remove ice candidate listener', async () => {
        await server.listen(async (ping) => {
            await server.pong(ping, ping.offer);
        });

        const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: Date.now().toString() };
        await client.ping(serverId, offer);

        const candidate = createRtcIceCandidate();

        const handleIceCandidate = jest.fn();
        await client.addIceCandidateListener(serverId, handleIceCandidate);
        await server.sendIceCandidate(clientId, candidate);

        await delay(100);

        client.removeIceCandidateListener(serverId, handleIceCandidate);
        await server.sendIceCandidate(clientId, candidate);

        await delay(100);

        expect(handleIceCandidate).toBeCalledTimes(1);
    });
});
