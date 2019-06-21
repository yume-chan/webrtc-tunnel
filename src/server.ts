import { randomBytes } from 'crypto';
import log from 'npmlog';

import { prefix } from './common';
import { KoshareReconnectClient } from '@yume-chan/koshare-router';
import { KoshareRtcSignalTransport } from './koshare-rtc-signal-transport';
import RtcDataConnection from './rtc-data-connection';
import { RtcSignalServer } from './rtc-signal';
import Socks5ServerConnection from './socks5-server';

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
                const label = client.label;

                const remote = new Socks5ServerConnection();
                remote.on('data', (data) => {
                    client.write(data);
                });
                remote.on('close', () => {
                    client.end();
                });

                client.on('data', (data: Buffer) => {
                    remote.process(data);
                });
            });
        });

    log.info('server', 'server id: %s', serverId);
})();
