import { EventEmitter } from 'events';

import log from 'npmlog';
import { RTCPeerConnection } from 'wrtc';

import { PromiseResolver } from '@yume-chan/async';

import RtcDataChannelStream from './rtc-data-channel-stream';
import { RtcSignalClient, RtcSignalServer } from "./rtc-signal";
import { RtcDataChannelDispatcher } from './rtc-data-channel-dispatcher';

class RtcIceCandidateQueue {
    private _queue: RTCIceCandidate[] = [];

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

            this._queue.push(candidate);
        });
    }

    public setHandler(handler: (candidate: RTCIceCandidate) => void): void {
        for (const candidate of this._queue) {
            handler(candidate);
        }
        this._queue = [];

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

        log.verbose('wrtc', `connectionState changed to ${_connectionState}`);
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
        remoteId: string,
        signal: RtcSignalClient,
        configuration?: RTCConfiguration
    ): Promise<RtcDataConnection> {
        const raw: RTCPeerConnection = new RTCPeerConnection(configuration);
        const candidates = new RtcIceCandidateQueue(raw);
        const control = raw.createDataChannel('control');

        const resolver = new PromiseResolver<void>();

        raw.onconnectionstatechange =
            transfromConnectionStateChangeHandler(
                raw,
                (connectionState) => {
                    switch (connectionState) {
                        case 'connected':
                            signal.close();
                            resolver.resolve();
                            break;
                        case 'failed':
                            signal.close();
                            resolver.reject(new Error('connection failed'));
                            break;
                    }
                });

        signal.addIceCandidateListener(remoteId, async (candidate) => {
            await raw.addIceCandidate(candidate);

            log.info('wrtc', 'ice candidate added');
            log.verbose('wrtc', '%j', candidate);
        });

        const offer = await raw.createOffer();
        await raw.setLocalDescription(offer);

        const { answer } = await signal.ping(remoteId, offer);

        candidates.setHandler(async (candidate) => {
            await signal.sendIceCandidate(remoteId, candidate);
        });

        await raw.setRemoteDescription(answer);
        log.verbose('wrtc', 'remote description set');

        await resolver.promise;

        return new RtcDataConnection(raw, control);
    }

    public static async listen(
        signal: RtcSignalServer,
        handler: (connection: RtcDataConnection) => void,
        configuration?: RTCConfiguration
    ): Promise<RtcDataConnectionListener> {
        await signal.listen(async (ping) => {
            const { sourceId, offer } = ping;

            const raw = new RTCPeerConnection(configuration);
            let connection: RtcDataConnection;
            const candidates = new RtcIceCandidateQueue(raw);

            candidates.setHandler(async (candidate) => {
                await signal.sendIceCandidate(sourceId, candidate);
            });

            signal.addIceCandidateListener(sourceId, async (candidate) => {
                await raw.addIceCandidate(candidate);

                log.info('wrtc', 'ice candidate added');
                log.verbose('wrtc', '%j', candidate);
            });

            raw.ondatachannel = ({ channel }) => {
                const label = channel.label;
                channel.onopen = () => {
                    if (label === 'control') {
                        connection = new RtcDataConnection(raw, channel);
                        handler(connection);
                    } else {
                        connection._dispatcher.addDataChannel(channel);
                        connection.emit('data-channel-stream', new RtcDataChannelStream(channel, connection._dispatcher));
                    }
                };
            };

            await raw.setRemoteDescription(offer);
            log.info('wrtc', 'remote description set');

            const answer = await raw.createAnswer();
            await raw.setLocalDescription(answer);

            await signal.pong(ping, answer);
        });

        return new RtcDataConnectionListener(signal);
    }

    private _raw: RTCPeerConnection;
    public get raw(): RTCPeerConnection { return this._raw; }

    private _control: RTCDataChannel;
    public get control(): RTCDataChannel { return this._control; }

    private _dispatcher: RtcDataChannelDispatcher;

    constructor(connection: RTCPeerConnection, control: RTCDataChannel) {
        super();

        this._raw = connection;

        this._control = control;
        this._control.addEventListener('error', () => {
            // TODO: TypeScript removed RTCErrorEvent
            // Waiting for https://github.com/DefinitelyTyped/DefinitelyTyped/pull/56242
            process.nextTick(() => {
                this.emit('error', new Error('control channel error'));
            });
        });

        this._dispatcher = new RtcDataChannelDispatcher(this._control);

        this._raw.onconnectionstatechange =
            transfromConnectionStateChangeHandler(
                this._raw,
                (connectionState) => {
                    switch (connectionState) {
                        case 'failed':
                        case 'closed':
                            process.nextTick(() => {
                                this.emit('close');
                            });
                            break;
                    }
                });
    }

    public async createChannelStream(label: string): Promise<RtcDataChannelStream> {
        const channel = this._raw.createDataChannel(label);
        if (channel.readyState !== 'open') {
            const waitOpen = new PromiseResolver<void>();
            const cleanUp = () => {
                channel.removeEventListener('open', handleOpen);
                channel.removeEventListener('error', handleError);
            };
            const handleOpen = () => {
                waitOpen.resolve();
                cleanUp();
            };
            const handleError = () => {
                // TODO: TypeScript removed RTCErrorEvent
                // Waiting for https://github.com/DefinitelyTyped/DefinitelyTyped/pull/56242
                waitOpen.reject(new Error('data channel open failed'));
                cleanUp();
            };
            channel.addEventListener('open', handleOpen);
            channel.addEventListener('error', handleError);
            await waitOpen.promise;
        }
        this._dispatcher.addDataChannel(channel);
        return new RtcDataChannelStream(channel, this._dispatcher);
    }

    public on(event: 'error', listener: (e: Error) => void): this;
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
        this._raw.close();
    }
}
