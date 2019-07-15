import { randomBytes } from 'crypto';

import log from 'npmlog';

import { KoshareReconnectClient } from '@yume-chan/koshare-router';

import { prefix } from './common';
import { KoshareRtcSignalTransport } from './koshare-rtc-signal-transport';
import RtcDataConnection from './rtc-data-connection';
import { RtcSignalServer } from './rtc-signal';
import Socks5ServerConnection from '@yume-chan/socks5-server';

log.level = 'silly';

const serverId = randomBytes(8).toString('base64');
// const serverId = 'local';

(async () => {
    await RtcDataConnection.listen(new RtcSignalServer(
        serverId,
        new KoshareRtcSignalTransport(
            await KoshareReconnectClient.connect('wss://chensi.moe/koshare', prefix))),
        (connection) => {
            connection.on('data-channel-stream', (client) => {
                const remote = new Socks5ServerConnection();
                remote.pipe(client);
                remote.on('error', () => {
                    client.end();
                });
                remote.on('close', () => {
                    client.end();
                });

                client.pipe(remote);
                client.on('error', () => {
                    remote.end();
                });
                client.on('close', () => {
                    remote.end();
                });
            });
        }
    );

    log.info('server', 'server id: %s', serverId);
})();
