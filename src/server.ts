import { connect } from 'net';
import { randomBytes } from 'crypto';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient } from './koshare-router';
import { Topic, IceMessage, PingMessage } from './common';
import RtcDataChannelStream from './data-channel-stream';
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

        let controlChannel: RTCDataChannel | undefined;

        connection.ondatachannel = ({ channel: client }) => {
            const label = client.label;
            log.info('wrtc', 'on data channel: %s', label);

            client.onopen = () => {
                log.info('wrtc', 'on channel open: %s', label);

                if (label === 'control') {
                    controlChannel = client;
                    return;
                }

                const clientStream = new RtcDataChannelStream(client, controlChannel!);
                const remote = connect(1083, 'localhost', async () => {
                    log.info('forward', 'connected to %s:%s', 'localhost', 1083);

                    clientStream.pipe(remote);
                    remote.pipe(clientStream);
                });

                remote.on('error', (error) => {
                    log.warn('forward', 'server %s error: %s', label, error.message);
                    log.warn('forward', error.stack!);
                });

                clientStream.on('error', (error) => {
                    log.warn('forward', 'client %s error: %s', label, error.message);
                    log.warn('forward', error.stack!);

                    remote.end();
                });
            };
        };
    });

    log.info('server', 'server id: %s', myId);
})();
