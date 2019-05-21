import { EventEmitter } from 'events';
import log from 'npmlog';
import { RTCPeerConnection } from 'wrtc';

import { PromiseResolver } from './async-operation-manager';
import RtcDataChannelStream from './rtc-data-channel-stream';
import { RtcSignalClient, RtcSignalServer } from "./rtc-signal";

class RtcIceCandidateBuffer {
    private _buffer: RTCIceCandidate[] = [];

    private _connection: RTCPeerConnection;

    private _handler: ((candidate: RTCIceCandidate) => void) | null = null;

    constructor(connection: RTCPeerConnection) {
        this._connection = connection;
        this._connection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate === null) {
                return;
            }

            log.info('wrtc', 'on ice candidate');
            log.verbose('wrtc', '%j', candidate);

            if (this._handler !== null) {
                this._handler(candidate);
                return;
            }

            this._buffer.push(candidate);
        });
    }

    public setHandler(handler: (candidate: RTCIceCandidate) => void): void {
        for (const candidate of this._buffer) {
            handler(candidate);
        }
        this._buffer = [];

        this._handler = handler;
    }
}

function transfromConnectionStateChangeHandler(
    connection: RTCPeerConnection,
    handler: (connectionState: RTCPeerConnectionState) => void
): () => void {
    let _connectionState: RTCPeerConnectionState = connection.connectionState;

    return () => {
        if (connection.connectionState === _connectionState) {
            log.verbose('wrtc', 'onconnectionstatechange fired without connectionState changing');
            return;
        }
        _connectionState = connection.connectionState;

        handler(_connectionState);
    };
}

export class RtcDataConnectionListener {
    private _signal: RtcSignalServer;

    public constructor(signal: RtcSignalServer) {
        this._signal = signal;
    }

    close() {
        this._signal.close();
    }
}

export default class RtcDataConnection extends EventEmitter {
    public static async connect(
        serverId: string,
        signal: RtcSignalClient,
        configuration?: RTCConfiguration
    ): Promise<RtcDataConnection> {
        const connection: RTCPeerConnection = new RTCPeerConnection(configuration);
        const candidates = new RtcIceCandidateBuffer(connection);
        const channel = connection.createDataChannel('control');

        const resolver = new PromiseResolver<void>();

        connection.onconnectionstatechange =
            transfromConnectionStateChangeHandler(
                connection,
                (connectionState) => {
                    switch (connectionState) {
                        case 'connected':
                            resolver.resolve();
                            break;
                        case 'failed':
                            resolver.reject(new Error('connection failed'));
                            break;
                    }
                });

        signal.addIceCandidateListener(serverId, async (candidate) => {
            await connection.addIceCandidate(candidate);

            log.info('wrtc', 'ice candidate added');
            log.verbose('wrtc', '%j', candidate);
        });

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        const { answer } = await signal.ping(serverId, offer);

        candidates.setHandler(async (candidate) => {
            await signal.sendIceCandidate(serverId, candidate);
        });

        await connection.setRemoteDescription(answer);
        log.verbose('wrtc', 'remote description set');

        await resolver.promise;

        signal.close();
        return new RtcDataConnection(connection, channel);
    }

    public static async listen(
        signal: RtcSignalServer,
        handler: (connection: RtcDataConnection) => void
    ): Promise<RtcDataConnectionListener> {
        await signal.listen(async (ping) => {
            const { sourceId, offer } = ping;

            const connection = new RTCPeerConnection();
            let result: RtcDataConnection;
            const candidates = new RtcIceCandidateBuffer(connection);

            candidates.setHandler(async (candidate) => {
                await signal.sendIceCandidate(sourceId, candidate);
            });

            signal.addIceCandidateListener(sourceId, async (candidate) => {
                await connection.addIceCandidate(candidate);

                log.info('wrtc', 'ice candidate added');
                log.verbose('wrtc', '%j', candidate);
            });

            connection.ondatachannel = ({ channel: client }) => {
                const label = client.label;
                log.info('wrtc', 'on data channel: %s', label);

                client.onopen = () => {
                    log.info('wrtc', 'on channel open: %s', label);

                    if (label === 'control') {
                        result = new RtcDataConnection(connection, client);
                        handler(result);
                        return;
                    }

                    result.emit('data-channel-stream', new RtcDataChannelStream(client, result._channel));
                };
            };

            await connection.setRemoteDescription(offer);
            log.info('wrtc', 'remote description set');

            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);

            await signal.pong(ping, answer);
        });

        return new RtcDataConnectionListener(signal);
    }

    private _connection: RTCPeerConnection;
    public get connection(): RTCPeerConnection { return this._connection; }

    private _channel: RTCDataChannel;
    public get channel(): RTCDataChannel { return this._channel; }

    constructor(connection: RTCPeerConnection, channel: RTCDataChannel) {
        super();

        this._connection = connection;

        this._channel = channel;
        this._channel.addEventListener('error', (error) => {
            process.nextTick(() => {
                this.emit('error', error);
            });
        });

        this._connection.onconnectionstatechange =
            transfromConnectionStateChangeHandler(
                this._connection,
                (connectionState) => {
                    switch (connectionState) {
                        case 'failed':
                            process.nextTick(() => {
                                this.emit('close');
                            })
                            break;
                    }
                });
    }

    public async createChannelStream(label: string): Promise<RtcDataChannelStream> {
        const channel = this._connection.createDataChannel(label);
        return new RtcDataChannelStream(channel, this._channel);
    }

    public on(event: 'close', listener: () => void): this;
    public on(event: 'data-channel-stream', listener: (stream: RtcDataChannelStream) => void): this;
    public on(event: string, listener: (...args: any) => any): this {
        return super.on(event, listener);
    }

    public off(event: 'close', listener: () => void): this;
    public off(event: 'data-channel-stream', listener: (stream: RtcDataChannelStream) => void): this;
    public off(event: string, listener: (...args: any) => any): this {
        return super.off(event, listener);
    }

    public once(event: 'close', listener: () => void): this;
    public once(event: 'data-channel-stream', listener: (stream: RtcDataChannelStream) => void): this;
    public once(event: string, listener: (...args: any) => any): this {
        return super.once(event, listener);
    }

    public close() {
        this._connection.close();
    }
}
