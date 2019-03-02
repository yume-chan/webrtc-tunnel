import { IncomingBoardcast, IncomingMessage } from "./koshare-router";

export enum Topic {
    Ping = 'yume-chan-tunnel-ping',
    Pong = 'yume-chan-tunnel-pong',
    Ice = 'yume-chan-tunnel-ice',
}

export interface IceMessage extends IncomingMessage {
    candidate: RTCIceCandidate;
}

export interface PingMessage extends IncomingBoardcast {
    offer: RTCSessionDescriptionInit;
}
