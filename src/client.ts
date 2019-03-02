import { createServer, Server } from 'net';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient, PacketType, IncomingMessage } from './koshare-router';
import { IceMessage, Topic } from './common';

interface PongMessage extends IncomingMessage {
    answer: RTCSessionDescriptionInit;
}

(async function main() {
    const connection = new RTCPeerConnection();
    let id = 0;

    const koshare = await KoshareRouterClient.create();

    await koshare.subscribe(Topic.Ice, async ({ candidate }: IceMessage) => {
        await connection.addIceCandidate(candidate);
        log.info('wrtc', 'ice candidate added');
    });

    const pending: RTCIceCandidate[] = [];
    connection.onicecandidate = ({ candidate }) => {
        if (candidate) {
            log.info('wrtc', 'on ice candidate before: %j', candidate);
            pending.push(candidate);
        }
    };

    await koshare.subscribe(Topic.Pong, async ({ src, answer }: PongMessage) => {
        log.info('signal', 'pong packet received');

        await connection.setRemoteDescription(answer);
        log.info('wrtc', 'remote description set');

        for (const candidate of pending) {
            await koshare.message(Topic.Ice, src, { candidate });
        }

        connection.onicecandidate = async ({ candidate }) => {
            if (candidate) {
                log.info('wrtc', 'on ice candidate: %j', candidate);
                await koshare.message(Topic.Ice, src, { candidate });
            }
        };
    });

    let server: Server;
    connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected' && server === undefined) {
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
            server.listen(1082, () => {
                log.info('forward', 'listening on port %s', 1082);
            });
            server.on('error', (err) => {
                log.error('forward', 'server error: %s', err.message);
                log.error('forward', err.stack!);
                process.exit(-1);
            })
        }
    }

    const channel = connection.createDataChannel('control');
    channel.onopen = () => {
        log.info('wrtc', 'channel open: control');
    };

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await koshare.boardcast(Topic.Ping, { offer });
})();
