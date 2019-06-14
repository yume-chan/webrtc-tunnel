import { randomBytes } from "crypto";

export function createRtcIceCandidate(): RTCIceCandidate {
    const candidate = Date.now().toString();

    return {
        candidate,
        component: null,
        foundation: null,
        ip: null,
        port: null,
        priority: null,
        protocol: null,
        relatedAddress: null,
        relatedPort: null,
        sdpMLineIndex: null,
        sdpMid: null,
        tcpType: null,
        type: null,
        usernameFragment: null,
        toJSON() {
            return {
                candidate,
            };
        },
    };
}

export function randomString() {
    return randomBytes(20).toString('hex');
}

export function randomPort() {
    return 9000 + Math.floor(Math.random() * 1000);
}
