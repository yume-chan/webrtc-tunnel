import { connect } from 'net';
import { randomBytes } from 'crypto';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient } from './koshare-router';
import { Topic, IceMessage, PingMessage } from './common';
import DataChannelSender from './data-channel-sender';
import './proxy';

const connections: Map<number, RTCPeerConnection> = new Map();
const myId = randomBytes(8).toString('base64');

(async () => {
    const koshare = await KoshareRouterClient.create();

    await koshare.subscribe<IceMessage>(Topic.Ice, async ({ candidate, src }) => {
        if (!connections.has(src)) {
            return;
        }

        await connections.get(src)!.addIceCandidate(candidate);

        log.info('wrtc', 'ice candidate added');
        log.verbose('wrtc', '%j', candidate);
    });

    await koshare.subscribe<PingMessage>(Topic.Ping, async ({ serverId, offer, src }) => {
        if (serverId !== myId) {
            return;
        }

        log.info('signal', 'received packet: ping');
        log.info('signal', 'offer: %j', offer);

        const connection = new RTCPeerConnection();
        connections.set(src, connection);

        connection.onicecandidate = async ({ candidate }) => {
            if (candidate) {
                log.info('wrtc', 'on ice candidate');
                log.verbose('wrtc', '%j', candidate);

                await koshare.message(Topic.Ice, src, { candidate });
            }
        }

        await connection.setRemoteDescription(offer);
        log.info('wrtc', 'remote description set');

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);

        await koshare.message(Topic.Pong, src, { answer });

        connection.ondatachannel = ({ channel: client }) => {
            log.info('wrtc', 'on data channel: %s', client.label);

            client.binaryType = 'arraybuffer';
            client.onopen = () => {
                log.info('wrtc', 'on channel open: %s', client.label);
                const clientSender = new DataChannelSender(client);

                if (client.label !== 'control') {
                    let pending: ArrayBuffer[] = [];
                    client.onmessage = ({ data }: { data: ArrayBuffer }) => {
                        log.info('forward', 'head received: %s', data.byteLength);
                        pending.push(data);
                    };

                    const remote = connect(1083, 'localhost', async () => {
                        log.info('forward', 'connected to %s:%s', 'localhost', 1083);

                        for (const data of pending) {
                            remote.write(Buffer.from(data));
                        }
                        pending = [];

                        client.onmessage = ({ data }: { data: ArrayBuffer }) => {
                            remote.write(Buffer.from(data));
                        };

                        for await (const data of remote) {
                            if (client.readyState !== 'open') {
                                remote.end();
                                return;
                            }

                            try {
                                await clientSender.send(data);
                            } catch (e) {
                                log.warn('forward', 'send error %s', e.message);
                                remote.end();
                            }
                        }
                    });
                    remote.on('error', () => {
                        client.close();
                    });

                    client.onclose = () => {
                        log.info('forward', 'remote closed');
                        remote.end();
                    };
                }
            }
        };
    });

    log.info('server', 'server id: %s', myId);
})();
