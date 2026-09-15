'use strict';

// کلاینت وب‌سوکت کمینه، فقط با ماژول‌های خود Node — تا برنامه هیچ
// وابستگی‌ای برای نصب نداشته باشد. همین کافی است برای حرف زدن با
// پروتکل DevTools کروم.

const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class WebSocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => { this.closed = true; this.emit('close'); });
    socket.on('error', (err) => this.emit('error', err));
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': key,
          'sec-websocket-version': '13',
        },
      });
      req.on('upgrade', (res, socket) => {
        socket.setNoDelay(true);
        resolve(new WebSocketClient(socket));
      });
      req.on('response', () => reject(new Error('سرور درخواست ارتقا به وب‌سوکت را نپذیرفت.')));
      req.on('error', reject);
      req.end();
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.readFrame();
      if (!frame) return;
      if (frame.opcode === 0x8) return this.close();
      if (frame.opcode === 0x9) { this.sendFrame(0xa, frame.payload); continue; }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x1 || frame.opcode === 0x0) {
        this.emit('message', frame.payload.toString('utf8'));
      }
    }
  }

  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) === 0x80;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('فریم وب‌سوکت بیش از حد بزرگ است.');
      length = Number(big);
      offset += 8;
    }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];

    this.buffer = buf.subarray(offset + length);
    return { opcode, payload };
  }

  sendFrame(opcode, payload) {
    if (this.closed) return;
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];

    let header;
    if (masked.length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | masked.length;
    } else if (masked.length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(masked.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(masked.length), 2);
    }
    header[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.sendFrame(0x8, Buffer.alloc(0)); } catch { /* سوکت از قبل بسته شده */ }
    this.socket.end();
    this.emit('close');
  }
}

module.exports = { WebSocketClient };
