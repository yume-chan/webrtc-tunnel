import { RTCPeerConnection } from 'wrtc';

(async () => {
    const p1 = new RTCPeerConnection();
    const p2 = new RTCPeerConnection();

    const c1 = p1.createDataChannel('data');
    c1.onopen = () => {
        console.log('onopen');
    }

    p1.onicecandidate = ({ candidate }) => {
        console.log('candidate', candidate);
    }

    p1.onconnectionstatechange = () => {
        console.log('connectionState', p1.connectionState);
    }

    const offer = await p1.createOffer();
    await p1.setLocalDescription(offer);
    console.log('offer', offer);

    await p2.setRemoteDescription(offer);

    const answer = await p2.createAnswer();
    await p2.setLocalDescription(answer);
    console.log('answer', answer);

    await p1.setRemoteDescription(answer);
})();
