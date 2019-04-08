import { request, createServer, IncomingMessage } from 'http';
import { connect, Socket } from 'net';
import * as url from 'url';
// @ts-ignore
import { promises as dns } from 'dns';
import log from 'npmlog';

import hosts from './hosts';


async function lookup(hostname: string): Promise<string> {
    if (hosts[hostname]) {
        return hosts[hostname];
    }

    return await dns.lookup(hostname);
}

const server = createServer(async (incoming, client) => {
    log.info('proxy', 'incoming request: %s %s', incoming.method, incoming.url);

    const parsed = url.parse(incoming.url!);
    const { hostname } = parsed;

    let address: string;
    try {
        address = await lookup(hostname!);
    } catch (err) {
        log.error('proxy', 'host resolving error: %s', err.message);
        log.error('proxy', err.stack!);
        client.end();
        return;
    }

    const outgoing = request({
        ...parsed,
        hostname: address,
        method: incoming.method,
        headers: incoming.headers,
        setHost: false,
    }, (response) => {
        log.info('proxy', 'got response for: %s %s', incoming.method, incoming.url);

        client.writeHead(response.statusCode!, response.statusMessage, response.headers);
        response.pipe(client);

        response.on('error', err => {
            log.error('proxy', 'response error: %s', err.message);
            log.error('proxy', err.stack!);

            client.end();
        }).on('close', () => {
            client.end();
        });
    });

    outgoing.on('error', (err) => {
        log.error('proxy', 'remote error: %s', err.message);
        log.error('proxy', err.stack!);

        client.end();
    });

    incoming.pipe(outgoing);

    incoming.on("error", err => {
        log.error('proxy', 'client error: %s', err.message);
        log.error('proxy', err.stack!);

        outgoing.abort();
    }).on('close', () => {
        outgoing.abort();
    });
});
server.on('connect', async (request: IncomingMessage, client: Socket, head: Buffer) => {
    log.info('proxy', 'incoming request: %s %s', 'CONNECT', request.url);

    const [hostname, port = "80"] = request.url!.split(":");

    let address: string;
    try {
        address = await lookup(hostname);
    } catch (err) {
        log.error('proxy', 'host resolving error: %s', err.message);
        log.error('proxy', err.stack!);
        client.end();
        return;
    }

    const remote = connect(parseInt(port, 10), address, () => {
        client.write(`HTTP/${request.httpVersion} 200 OK\r\n\r\n`);
        remote.write(head);

        client.pipe(remote);
        remote.pipe(client);
    }).on("error", (err) => {
        log.error('proxy', 'response error: %s', err.message);
        log.error('proxy', err.stack!);

        client.write(`HTTP/${request.httpVersion} 502 Bad Gateway\r\n\r\n`);
        client.end();
    }).on("end", () => {
        client.end();
    });

    client.on("error", err => {
        log.error('proxy', 'client error: %s', err.message);
        log.error('proxy', err.stack!);

        remote.end();
    }).on('close', () => {
        remote.end();
    });
});
server.listen(1083, () => {
    log.info('proxy', 'listening on port %s', 1083);
});
