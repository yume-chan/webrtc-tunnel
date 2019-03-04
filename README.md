# WebRTC Tunnel

A HTTP proxy which allows the server to run in a NAT network.

# How it works

WebRTC uses varies NAT-traversal technologies to connect to remote peers.

So why reinvent another wheel?

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

Set HTTP proxy to `127.0.0.1:1082`.

# Thanks

This project uses [gladkikhartem/koshare-router](https://github.com/gladkikhartem/koshare-router) as WebRTC signaling server.
