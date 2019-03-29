import { RTCPeerConnection } from 'wrtc';

const data = new ArrayBuffer(128 * 1024);
let count = 0;

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
    const p1 = new RTCPeerConnection();
    const c1 = p1.createDataChannel('control');
    c1.onmessage = ({ data }) => {
        console.log(`${Date.now()} received ${count++} times`);
    };
    c1.onclose = () => {
        console.log('c1 closed');
    };

    const offer = await p1.createOffer();
    await p1.setLocalDescription(offer);

    const p2 = new RTCPeerConnection();

    await p2.setRemoteDescription(offer);
    const answer = await p2.createAnswer();
    await p2.setLocalDescription(answer);

    await p1.setRemoteDescription(answer);

    p1.onicecandidate = async ({ candidate }) => {
        if (candidate) {
            await p2.addIceCandidate(candidate);
        }
    };

    p2.onicecandidate = async ({ candidate }) => {
        if (candidate) {
            await p1.addIceCandidate(candidate);
        }
    };

    p2.ondatachannel = ({ channel: c2 }) => {
        c2.onclose = () => {
            console.log('c2 closed');
        };

        setInterval(async () => {
            if (c2.readyState === 'open') {
                await safeSend(c2, data);
            }
        }, 1);
    };
})()
