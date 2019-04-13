import { randomBytes } from 'crypto';
import { connect } from 'net';
import log from 'npmlog';

import { prefix } from './common';
import KoshareClient from './koshare-client';
import { KoshareRtcSignalTransport } from './koshare-rtc-signal-transport';
import RtcDataConnection from './rtc-data-connection';
import { RtcSignalServer } from './rtc-signal';

import './proxy';

log.level = 'silly';

const serverId = randomBytes(8).toString('base64');

(async () => {
    await RtcDataConnection.listen(new RtcSignalServer(
        serverId,
        new KoshareRtcSignalTransport(
            await KoshareClient.connect(prefix))),
        (connection) => {
            connection.on('data-channel-stream', (client) => {
                const label = client.label;

                const remote = connect(1083, 'localhost', async () => {
                    log.info('forward', 'connected to %s:%s', 'localhost', 1083);

                    client.pipe(remote);
                    remote.pipe(client);
                });

                remote.on('error', (error) => {
                    log.warn('forward', 'server %s error: %s', label, error.message);
                    log.warn('forward', error.stack!);
                });

                client.on('error', (error) => {
                    log.warn('forward', 'client %s error: %s', label, error.message);
                    log.warn('forward', error.stack!);

                    remote.end();
                });
            });
        });

    log.info('server', 'server id: %s', serverId);
})();
