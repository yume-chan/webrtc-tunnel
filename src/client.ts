import { createServer, Socket } from 'net';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient, IncomingMessage } from './koshare-router';
import { IceMessage, Topic, PingMessage } from './common';
import DataChannelSender from './data-channel-sender';

interface PongMessage extends IncomingMessage {
    answer: RTCSessionDescriptionInit;
}

const serverId = process.argv[2];
if (typeof serverId !== 'string') {
    log.error('client', 'USAGE: npm run client -- <serverId>');
    process.exit(-1);
}

let rtcConnection: RTCPeerConnection | undefined;
let connecting: boolean = false;
const pendingConnections: Set<Socket> = new Set();

async function handleConnection(client: Socket) {
    const label = `${client.remoteAddress}:${client.remotePort}`;
    const remote = rtcConnection!.createDataChannel(label);
    remote.binaryType = 'arraybuffer';

    const remoteSender = new DataChannelSender(remote);

    remote.onmessage = ({ data }: { data: ArrayBuffer }) => {
        if (client.destroyed) {
            return;
        }

        client.write(Buffer.from(data));
    };

    remote.onerror = ({ error }) => {
        log.warn('forward', 'server warn: %s', label, error!.message);
        log.warn('forward', error!.stack!);
        client.end();
    };

    try {
        for await (const data of client as AsyncIterable<Buffer>) {
            if (remote.readyState !== 'open') {
                client.end();
                return;
            }

            await remoteSender.send(data);
        }
    } catch (err) {
        log.warn('forward', 'client %s error: %s', label, err.message);
        log.warn('forward', err.stack!);

        client.end();
        remote.close();
    }
}

const server = createServer((client) => {
    if (typeof rtcConnection === 'undefined') {
        pendingConnections.add(client);

        if (!connecting) {
            createRtcConnection(serverId);
        }
        return;
    }

    handleConnection(client);
});

server.on('error', (err) => {
    log.error('forward', 'server error: %s', err.message);
    log.error('forward', err.stack!);
});

server.listen(1082, () => {
    log.info('forward', 'listening on port %s', 1082);
});

async function createRtcConnection(serverId: string) {
    connecting = true;

    function handleConnectionFailed() {
        rtcConnection = undefined;
        connecting = false;

        for (const client of pendingConnections) {
            client.end();
        }
        pendingConnections.clear();
    }

    const timeout = setTimeout(handleConnectionFailed, 10000);

    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.sipgate.net' }] });

    let candidates: RTCIceCandidate[] = [];
    connection.onicecandidate = ({ candidate }) => {
        if (candidate) {
            log.verbose('wrtc', 'on ice candidate: %j', candidate);
            candidates.push(candidate);
        }
    };

    connection.oniceconnectionstatechange = () => {
        switch (connection.iceConnectionState) {
            case 'connected':
                log.verbose('wrtc', 'ice connected');
                break;
            case 'failed':
                log.warn('wrtc', 'ice connection failed');
                break;
        }
    };

    let oldConnectionState: RTCPeerConnectionState = connection.connectionState;
    connection.onconnectionstatechange = () => {
        // WORKAROUND: wrtc will fire multiple onconnectionstatechange with same connectionState
        if (connection.connectionState === oldConnectionState) {
            return;
        }
        oldConnectionState = connection.connectionState;

        switch (connection.connectionState) {
            case 'connected':
                log.info('wrtc', 'connection established');
                koshare.close();
                rtcConnection = connection;
                connecting = false;
                clearTimeout(timeout);

                for (const client of pendingConnections) {
                    handleConnection(client);
                }
                pendingConnections.clear();
                break;
            case 'failed':
                log.error('wrtc', 'connection failed');
                koshare.close();
                handleConnectionFailed();
                break;
        }
    }

    const channel = connection.createDataChannel('control');
    channel.onopen = () => {
        log.verbose('wrtc', 'channel open: control');
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    const koshare = await KoshareRouterClient.create();

    await koshare.subscribe<IceMessage>(Topic.Ice, async ({ candidate }) => {
        await connection.addIceCandidate(candidate);

        log.verbose('wrtc', 'ice candidate added');
        log.silly('wrtc', '%j', candidate);
    });

    await koshare.subscribe<PongMessage>(Topic.Pong, async ({ src, answer }) => {
        log.info('signal', 'pong packet received');

        await connection.setRemoteDescription(answer);
        log.verbose('wrtc', 'remote description set');

        for (const candidate of candidates) {
            await koshare.message<IceMessage>(Topic.Ice, src, { candidate });
        }
        candidates = [];

        connection.onicecandidate = async ({ candidate }) => {
            if (candidate) {
                log.verbose('wrtc', 'on ice candidate: %j', candidate);
                await koshare.message<IceMessage>(Topic.Ice, src, { candidate });
            }
        };
    });

    await koshare.boardcast<PingMessage>(Topic.Ping, { serverId, offer });
}
