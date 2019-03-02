import { request, createServer, IncomingMessage } from 'http';
import { connect, Socket } from 'net';
import log from 'npmlog';

const server = createServer((incoming, client) => {
    log.info('proxy', 'incoming request: %s %s', incoming.method, incoming.url);

    const outgoing = request(incoming.url!, {
        method: incoming.method,
        headers: incoming.headers,
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

    incoming.pipe(outgoing);

    incoming.on("error", err => {
        log.error('proxy', 'client error: %s', err.message);
        log.error('proxy', err.stack!);

        outgoing.abort();
    }).on('close', () => {
        outgoing.abort();
    });
});
server.on('connect', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    log.info('proxy', 'incoming request: %s %s', 'CONNECT', request.url);

    const [host, port = "80"] = request.url!.split(":");
    const remote = connect(parseInt(port, 10), host, () => {
        socket.write(`HTTP/${request.httpVersion} 200 OK\r\n\r\n`);
        remote.write(head);

        socket.pipe(remote);
        remote.pipe(socket);
    }).on("error", (err) => {
        log.error('proxy', 'response error: %s', err.message);
        log.error('proxy', err.stack!);

        socket.write(`HTTP/${request.httpVersion} 502 Bad Gateway\r\n\r\n`);
        socket.end();
    }).on("end", () => {
        socket.end();
    });

    socket.on("error", err => {
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
