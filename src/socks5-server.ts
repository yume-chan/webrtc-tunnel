import net from 'net';
import { EventEmitter } from 'events';

import * as ipaddr from 'ipaddr.js';

import log from 'npmlog';

export enum Socks5ConnectionState {
    Handshake,
    Authentication,
    WaitCommand,
    Relay,
}

export enum Socks5AuthenticateMethod {
    None = 0x00,
    Gssapi = 0x01,
    UsernamePassword = 0x02
}

export enum Socks5Command {
    Connect = 0x01,
    Bind = 0x02,
    UdpAssociate = 0x03,
}

export enum Socks5AddressType {
    Ipv4 = 0x01,
    DomainName = 0x03,
    Ipv6 = 0x04,
}

class BufferReader {
    private _buffer: Buffer;

    private _offset: number = 0;

    constructor(buffer: Buffer) {
        this._buffer = buffer;
    }

    public readUint8(): number {
        const result = this._buffer.readUInt8(this._offset);
        this._offset += 1;
        return result;
    }

    public readUint16BE(): number {
        const result = this._buffer.readUInt16BE(this._offset);
        this._offset += 2;
        return result;
    }

    public readString(length: number): string {
        const end = this._offset + length;
        const result = this._buffer.toString('utf8', this._offset, end);
        this._offset = end;
        return result;
    }

    public readBuffer(length: number): Buffer {
        const end = this._offset + length;
        const result = this._buffer.slice(this._offset, end);
        this._offset = end;
        return result;
    }
}

export interface Socks5CommandHandler {
    process(data: Buffer): void;

    close(): void;
}

export interface Socks5CommandHandlerConstructor {
    constructor(emitter: EventEmitter, address: string, port: number): Socks5CommandHandler;
}

export class Socks5ConnectCommandHandler implements Socks5CommandHandler {
    private _emitter: EventEmitter;

    private _socket: net.Socket;

    constructor(emitter: EventEmitter, address: string, port: number) {
        this._emitter = emitter;

        this._socket = net.connect(port, address);
        this._socket.on('connect', () => {
            log.info('socks5', `connected to ${address}:${port}`);

            const localAddress = ipaddr.process(this._socket.localAddress).toByteArray();
            const localPort = this._socket.localPort;

            const response = Buffer.alloc(6 + localAddress.length);
            response.writeUInt8(0x05, 0);
            response.writeUInt8(0x00, 1);
            response.writeUInt8(localAddress.length === 4 ? 0x01 : 0x04, 3);
            response.set(localAddress, 4);
            response.writeUInt16BE(localPort, 4 + localAddress.length);
            this._emitter.emit('data', response);
        });
        this._socket.on('data', (data) => {
            // log.verbose('socks5', `received ${data.byteLength} bytes from ${this._address}:${this._port}`);

            this._emitter.emit('data', data);
        });
        this._socket.on('error', () => {
            this._emitter.emit('close');
        });
        this._socket.on('close', () => {
            this._emitter.emit('close');
        });
    }

    process(data: Buffer): void {
        // log.verbose('socks5', `fowarding ${data.byteLength} bytes to ${this._address}:${this._port}`);

        this._socket.write(data);
    }

    close(): void {
        this._socket.end();
    }
}

/**
 * @see https://tools.ietf.org/html/rfc1928
 */
export default class Socks5ServerConnection {
    private _emitter: EventEmitter = new EventEmitter();

    private _state: Socks5ConnectionState = Socks5ConnectionState.Handshake;

    private _handler: Socks5CommandHandler | undefined;

    private checkVersion(data: BufferReader): boolean {
        if (data.readUint8() !== 0x05) {
            this._emitter.emit('close');
            return false;
        }

        return true;
    }

    public process(data: Buffer): void {
        const reader = new BufferReader(data);

        switch (this._state) {
            case Socks5ConnectionState.Handshake:
                if (!this.checkVersion(reader)) {
                    return;
                }

                const response = Buffer.alloc(2);
                response.writeUInt8(0x5, 0);

                const length = reader.readUint8();
                for (let i = 0; i < length; i++) {
                    const method: Socks5AuthenticateMethod = reader.readUint8();
                    if (method === Socks5AuthenticateMethod.None) {
                        response.writeUInt8(method, 1);
                        this._emitter.emit('data', response);
                        this._state = Socks5ConnectionState.WaitCommand;
                        return;
                    }
                }

                response.writeUInt8(0xFF, 1);
                this._emitter.emit('data', response);
                break;
            case Socks5ConnectionState.WaitCommand:
                if (!this.checkVersion(reader)) {
                    return;
                }

                const command: Socks5Command = reader.readUint8();

                // reserved
                reader.readUint8();

                const addressType: Socks5AddressType = reader.readUint8();

                let address: string;
                switch (addressType) {
                    case Socks5AddressType.Ipv4:
                        address = ipaddr.fromByteArray(Array.from(reader.readBuffer(4))).toString();
                        break;
                    case Socks5AddressType.DomainName:
                        const length = reader.readUint8();
                        address = reader.readString(length);
                        break;
                    case Socks5AddressType.Ipv6:
                        address = ipaddr.fromByteArray(Array.from(reader.readBuffer(16))).toString();
                        break;
                    default:
                        this._emitter.emit('close');
                        return;
                }

                const port = reader.readUint16BE();

                switch (command) {
                    case Socks5Command.Connect:
                        this._handler = new Socks5ConnectCommandHandler(this._emitter, address, port);
                        break;
                    default:
                        this._emitter.emit('close');
                        break;
                }
                break;
            case Socks5ConnectionState.Relay:
                this._handler!.process(data);
                break;
        }
    }

    public close(): void {
        if (this._handler) {
            this._handler.close();
        }
    }

    public on(event: 'data', listener: (data: Buffer) => void): void;
    public on(event: 'close', listener: () => void): void;
    public on(event: string, listener: (...args: any[]) => void): void {
        this._emitter.on(event, listener);
    }
}
