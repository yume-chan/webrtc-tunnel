import { createServer, Server } from 'net';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient, PacketType, IncomingMessage } from './koshare-router';
import { IceMessage, Topic } from './common';

interface PongMessage extends IncomingMessage {
    answer: RTCSessionDescriptionInit;
}

(async function main() {
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

    let server: Server;
    connection.onconnectionstatechange = () => {
        console.log('------------------', 'connectionState', connection.connectionState);

        switch (connection.connectionState) {
            case 'connected':
                log.info('wrtc', 'connection established');
                koshare.close();

                if (server === undefined) {
                    server = createServer((client) => {
                        const label = `${client.remoteAddress}:${client.remotePort}`;
                        const remote = connection.createDataChannel(label);
                        remote.binaryType = 'arraybuffer';

                        client.on('data', (data) => {
                            if (remote.readyState !== 'open') {
                                client.end();
                                return;
                            }

                            try {
                                remote.send(data);
                            } catch (e) {
                                client.end();
                            }
                        }).on('error', (err) => {
                            log.error('forward', 'client %s error: %s', label, err.message);
                            log.error('forward', err.stack!);
                            remote.close();
                        });

                        remote.onmessage = ({ data }: { data: ArrayBuffer }) => {
                            client.write(Buffer.from(data));
                        };
                        remote.onerror = ({ error }) => {
                            log.error('forward', 'server error: %s', label, error!.message);
                            log.error('forward', error!.stack!);
                            client.end();
                        };
                    });
                    server.on('error', (err) => {
                        log.error('forward', 'server error: %s', err.message);
                        log.error('forward', err.stack!);
                        process.exit(-1);
                    });
                    server.listen(1082, () => {
                        log.info('forward', 'listening on port %s', 1082);
                    });
                }
                break;
            case 'failed':
                log.error('wrtc', 'connection failed');
                koshare.close();
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

    await koshare.subscribe(Topic.Ice, async ({ candidate }: IceMessage) => {
        await connection.addIceCandidate(candidate);

        log.verbose('wrtc', 'ice candidate added');
        log.silly('wrtc', '%j', candidate);
    });

    await koshare.subscribe(Topic.Pong, async ({ src, answer }: PongMessage) => {
        log.info('signal', 'pong packet received');

        await connection.setRemoteDescription(answer);
        log.verbose('wrtc', 'remote description set');

        for (const candidate of candidates) {
            await koshare.message(Topic.Ice, src, { candidate });
        }
        candidates = [];

        connection.onicecandidate = async ({ candidate }) => {
            if (candidate) {
                log.verbose('wrtc', 'on ice candidate: %j', candidate);
                await koshare.message(Topic.Ice, src, { candidate });
            }
        };
    });

    await koshare.boardcast(Topic.Ping, { offer });
})();
