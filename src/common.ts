export enum Topic {
    Ping = 'yume-chan-tunnel-ping',
    Pong = 'yume-chan-tunnel-pong',
    Ice = 'yume-chan-tunnel-ice',
}

export interface IceMessage {
    candidate: RTCIceCandidate;
}

export interface PingMessage {
    serverId: string;

    offer: RTCSessionDescriptionInit;
}
