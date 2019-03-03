import { connect } from 'net';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient, PacketType } from './koshare-router';
import { Topic, IceMessage, PingMessage } from './common';
import './proxy';

const connections: Map<number, RTCPeerConnection> = new Map();

(async () => {
    const koshare = await KoshareRouterClient.create();

    await koshare.subscribe(Topic.Ice, async ({ candidate, src }: IceMessage) => {
        if (!connections.has(src)) {
            return;
        }

        await connections.get(src)!.addIceCandidate(candidate);

        log.info('wrtc', 'ice candidate added');
        log.verbose('wrtc', '%j', candidate);
    });

    await koshare.subscribe(Topic.Ping, async ({ offer, src }: PingMessage) => {
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

                if (client.label !== 'control') {
                    let pending: ArrayBuffer[] = [];
                    client.onmessage = ({ data }: { data: ArrayBuffer }) => {
                        log.info('forward', 'head received: %s', data.byteLength);
                        pending.push(data);
                    };

                    const remote = connect(1083, 'localhost', () => {
                        log.info('forward', 'connected to %s:%s', 'localhost', 1083);

                        for (const data of pending) {
                            remote.write(Buffer.from(data));
                        }
                        pending = [];

                        client.onmessage = ({ data }: { data: ArrayBuffer }) => {
                            remote.write(Buffer.from(data));
                        };

                        remote.on('data', (data) => {
                            if (client.readyState !== 'open') {
                                remote.end();
                                return;
                            }

                            try {
                                client.send(data);
                            } catch (e) {
                                remote.end();
                            }
                        });
                    });
                    remote.on('error', () => {
                        client.close();
                    });
                    remote.on('close', () => {
                        client.close();
                    });

                    client.onclose = () => {
                        remote.end();
                    }
                }
            }
        };
    });
})();
