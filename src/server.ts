import { connect } from 'net';
import { randomBytes } from 'crypto';
import { RTCPeerConnection } from 'wrtc';
import log from 'npmlog';

import { KoshareRouterClient } from './koshare-router';
import { Topic, IceMessage, PingMessage } from './common';
import './proxy';

const connections: Map<number, RTCPeerConnection> = new Map();
const myId = randomBytes(8).toString('base64');

class ConditionalVariable {
    private _queue: Array<() => void> = [];

    private _condition: () => boolean;

    private _resolvedPromise: Promise<void> = Promise.resolve();

    constructor(condition: () => boolean) {
        this._condition = condition;
    }

    public wait(): Promise<void> {
        if (this._condition()) {
            return this._resolvedPromise;
        }

        const promise = new Promise<void>(resolve => {
            this._queue.push(resolve);
        });
        return promise;
    }

    public notify() {
        if (this._queue.length === 0) {
            return;
        }

        if (!this._condition()) {
            return;
        }

        this._queue.shift()!();
    }
}

const protectorSymbol = Symbol('protector');

interface HasProtector {
    [protectorSymbol]?: ConditionalVariable;
}

async function safeSend(channel: RTCDataChannel & HasProtector, data: ArrayBuffer): Promise<void> {
    if (typeof channel[protectorSymbol] === 'undefined') {
        channel.bufferedAmountLowThreshold = 1024 * 1024;
        channel[protectorSymbol] = new ConditionalVariable(() => channel.bufferedAmount < 16 * 1024 * 1024);
        channel.addEventListener('bufferedamountlow', () => channel[protectorSymbol]!.notify());
    }

    const protector = channel[protectorSymbol]!;

    await protector.wait();

    try {
        channel.send(data);
    } finally {
        protector.notify();
    }
}

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

                        remote.on('data', async (data) => {
                            if (client.readyState !== 'open') {
                                remote.end();
                                return;
                            }

                            try {
                                await safeSend(client, data);
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

    log.info('server', 'server id: %s', myId);
})();
