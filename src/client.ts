import { randomBytes } from 'crypto';
import { createServer } from 'net';
import { Transform } from 'stream';

import log from 'npmlog';
import * as ipaddr from 'ipaddr.js';

import { KoshareReconnectClient } from '@yume-chan/koshare-router';

import { RtcSignalClient } from './rtc-signal';
import { prefix } from './common';
import { KoshareRtcSignalTransport } from './koshare-rtc-signal-transport';
import RtcDataConnection from './rtc-data-connection';
import { delay } from './util';

log.level = 'silly';

const clientId = randomBytes(8).toString('base64');

const serverId = process.argv[2];
if (typeof serverId !== 'string') {
    log.error('client', 'USAGE: npm run client -- <serverId>');
    process.exit(-1);
}

let _connect: Promise<RtcDataConnection> | null = null;
function connect(): Promise<RtcDataConnection> {
    async function core() {
        while (true) {
            try {
                const connection = await RtcDataConnection.connect(
                    serverId,
                    new RtcSignalClient(
                        clientId,
                        new KoshareRtcSignalTransport(
                            await KoshareReconnectClient.connect('wss://chensi.moe/koshare', prefix))),
                    { iceServers: [{ urls: 'stun:stun.sipgate.net' }] });

                connection.once('close', () => {
                    _connect = null;
                });

                return connection;
            } catch (error) {
                await delay(1000);
            }
        }
    }

    if (_connect === null) {
        _connect = core();
    }

    return _connect;
}

class LogStream extends Transform {
    private _name: string;

    public constructor(name: string) {
        super();

        this._name = name;
    }

    public _transform(chunk: Buffer, encoding: string, callback: () => void): void {
        log.verbose('stream', `stream ${this._name} reviced ${chunk.length} bytes`);
        this.push(chunk, encoding);
        callback();
    }
}

const server = createServer(async (client) => {
    const connection = await connect();

    try {
        const label = `${ipaddr.process(client.remoteAddress!).toString()}:${client.remotePort}`;
        const remote = await connection.createChannelStream(label);

        log.info('forward', `data channel ${label} created`);

        client.pipe(remote);
        remote.pipe(client);

        client.on('error', (error) => {
            log.warn('forward', 'data channel %s client error: %s', label, error.message);
            log.warn('forward', error.stack!);

            remote.end();
        });
        remote.on('error', (error) => {
            log.warn('forward', 'data channel %s remote error: %s', label, error.message);
            log.warn('forward', error.stack!);

            client.end();
        });

        client.on('close', () => {
            log.info('forward', `data channel ${label} closed by client`);

            remote.end();
        });
        remote.on('close', () => {
            log.info('forward', `data channel ${label} closed by remote`);

            client.end();
        });
    } catch (error) {
        log.warn('forward', 'main loop error: %s', error.message);
        log.warn('forward', error.stack!);

        connection.close();
        _connect = null;

        client.end();
    }
});

server.on('error', (err) => {
    log.error('forward', 'server error: %s', err.message);
    log.error('forward', err.stack!);
});

server.listen(1082, () => {
    log.info('forward', 'listening on port %s', 1082);
});
