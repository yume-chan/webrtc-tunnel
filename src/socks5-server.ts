import * as net from 'net';
import { EventEmitter } from 'events';
import log from 'npmlog';

export enum Socks5ConnectionState {
    Handshake,
    Authentication,
    Ready,
    Connect,
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
}

export default class Socks5ServerConnection {
    private _emitter: EventEmitter = new EventEmitter();

    private _state: Socks5ConnectionState = Socks5ConnectionState.Handshake;

    private _address: string | undefined;

    private _port: number | undefined;

    private _socket: net.Socket | null = null;

    public constructor() {

    }

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
                        this._state = Socks5ConnectionState.Ready;
                        return;
                    }
                }

                response.writeUInt8(0xFF, 1);
                this._emitter.emit('data', response);
                break;
            case Socks5ConnectionState.Ready:
                if (!this.checkVersion(reader)) {
                    return;
                }

                const command: Socks5Command = reader.readUint8();

                // reversed
                reader.readUint8();

                const addressType: Socks5AddressType = reader.readUint8();

                let host: string;
                switch (addressType) {
                    case Socks5AddressType.Ipv4:
                        host = [reader.readUint8(), reader.readUint8(), reader.readUint8(), reader.readUint8()].join('.');
                        break;
                    case Socks5AddressType.DomainName:
                        const length = reader.readUint8();
                        host = reader.readString(length);
                        break;
                    default:
                        this._emitter.emit('close');
                        return;
                }

                const port = reader.readUint16BE();

                switch (command) {
                    case Socks5Command.Connect:
                        this._address = host;
                        this._port = port;

                        log.info('socks5', `connecting to ${host}:${port}`);

                        this._socket = net.connect(port, host);
                        this._socket.on('connect', () => {
                            log.info('socks5', `connected to ${host}:${port}`);

                            const response = Buffer.alloc(data.length);
                            data.copy(response);
                            response.writeUInt8(0x00, 1);
                            this._emitter.emit('data', response);
                            this._state = Socks5ConnectionState.Connect;
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
                        break;
                    default:
                        this._emitter.emit('close');
                        break;
                }
                break;
            case Socks5ConnectionState.Connect:
                // log.verbose('socks5', `fowarding ${data.byteLength} bytes to ${this._address}:${this._port}`);
                this._socket!.write(data);
                break;
        }
    }

    public on(event: 'data', listener: (data: Buffer) => void): void;
    public on(event: 'close', listener: () => void): void;
    public on(event: string, listener: (...args: any[]) => void): void {
        this._emitter.on(event, listener);
    }
}
