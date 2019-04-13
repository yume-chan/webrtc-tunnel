export function delay(time: number): Promise<void> {
    return new Promise<void>(resolve => {
        setTimeout(resolve, time);
    });
}

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
