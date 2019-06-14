import { randomBytes } from 'crypto';
import { createServer } from 'net';
import log from 'npmlog';

import { RtcSignalClient } from './rtc-signal';
import { prefix } from './common';
import KoshareReconnectClient from './koshare-reconnect-client';
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
                            await KoshareReconnectClient.connect(prefix, 'wss://chensi.moe/koshare'))),
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

const server = createServer(async (client) => {
    const connection = await connect();

    const label = `${client.remoteAddress}:${client.remotePort}`;
    const remote = await connection.createChannelStream(label);

    remote.pipe(client);
    client.pipe(remote);

    remote.on('error', (error) => {
        log.warn('forward', 'server %s error: %s', label, error.message);
        log.warn('forward', error.stack!);

        client.end();
    });

    client.on('error', (error) => {
        log.warn('forward', 'client %s error: %s', label, error.message);
        log.warn('forward', error.stack!);

        remote.end();
    });
});

server.on('error', (err) => {
    log.error('forward', 'server error: %s', err.message);
    log.error('forward', err.stack!);
});

server.listen(1082, () => {
    log.info('forward', 'listening on port %s', 1082);
});
