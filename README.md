# WebRTC Tunnel

[![travis-ci](https://travis-ci.org/yume-chan/webrtc-tunnel.svg?branch=master)](https://travis-ci.org/yume-chan/webrtc-tunnel)

WebRTC uses ICE to connect to remote peers, which supports NAT traversal pretty well.

WebRTC is a peer-to-peer protocol but this script assigns one peer as server and the other as client, and creates an SOCKS5 proxy on server.

# Install

1. Clone this repository.
2. Run `npm install`

# Run

## server

````shell
npm run server
````

You will see a server ID at end.

## client

````shell
npm run client -- <serverId>
````

Set SOCKS5 proxy to `127.0.0.1:1082`.

# Thanks

This project used to use [gladkikhartem/koshare-router](https://github.com/gladkikhartem/koshare-router) as WebRTC signaling server.

The original server had been shut down, so I created my own implementation at [yume-chan/koshare-router-nodejs](https://github.com/yume-chan/koshare-router-nodejs).

# Note on pnpm

Usually I use [pnpm](https://github.com/pnpm/pnpm) to install npm packages.

But due to it [doesn't support `bundledDependencies`](https://github.com/pnpm/pnpm/issues/844), it can't be used to install the most important dependency of this project, [wrtc](https://github.com/node-webrtc/node-webrtc).

So this project uses `npm` directly.
