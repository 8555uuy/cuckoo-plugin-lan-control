/**
 * 极简 WebSocket 服务端（RFC6455）—— 零依赖，自包含。
 *
 * 只实现本项目需要的子集：
 *   - HTTP Upgrade 握手（Sec-WebSocket-Accept 校验）
 *   - 帧解析：文本/二进制/关闭/ping/pong；支持 7/16/64 位长度；客户端帧解掩码
 *   - 帧构建：服务端不掩码
 *   - 分片消息拼接（continuation 帧）
 *   - 心跳 ping/pong
 *
 * 用法：
 *   const { createWsServer } = require('./lib/ws.js');
 *   const wss = createWsServer(httpServer, { path: '/ws' });
 *   wss.on('connection', (ws, req) => {
 *     ws.on('message', (msg) => { ... });
 *     ws.send('hello');
 *   });
 *   wss.broadcast('to all clients');
 */
const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;

/** 生成握手应答 key */
function acceptKey(secKey) {
  return crypto.createHash('sha1').update(secKey + GUID).digest('base64');
}

/** 构建一个 WS 帧 */
function encodeFrame(opcode, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, buf]);
}

/** 单个 WebSocket 连接 */
class WebSocketConn {
  constructor(socket) {
    this.socket = socket;
    this.closed = false;
    this._listeners = { message: [], close: [], error: [] };
    this._fragOp = 0;
    this._fragBufs = [];
    this._buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._onClose());
    socket.on('error', (e) => this._emit('error', e));
  }

  on(event, fn) { (this._listeners[event] || (this._listeners[event] = [])).push(fn); return this; }
  _emit(event, ...args) { for (const fn of (this._listeners[event] || [])) { try { fn(...args); } catch (_) {} } }

  send(data) {
    if (this.closed) return false;
    try {
      const isBuf = Buffer.isBuffer(data);
      this.socket.write(encodeFrame(isBuf ? OP_BIN : OP_TEXT, data));
      return true;
    } catch (_) { return false; }
  }

  ping() { if (!this.closed) { try { this.socket.write(encodeFrame(OP_PING, '')); } catch (_) {} } }

  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    try {
      const body = Buffer.alloc(2 + (reason ? Buffer.byteLength(reason) : 0));
      body.writeUInt16BE(code || 1000, 0);
      if (reason) body.write(reason, 2, 'utf8');
      this.socket.write(encodeFrame(OP_CLOSE, body));
    } catch (_) {}
    try { this.socket.end(); } catch (_) {}
  }

  _onClose() {
    if (this.closed) { this._emit('close'); return; }
    this.closed = true;
    this._emit('close');
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    // 循环解析尽可能多的帧
    while (true) {
      const frame = this._parseFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  /** 从缓冲区解析一个完整帧；不足返回 null */
  _parseFrame() {
    const b = this._buffer;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const hi = b.readUInt32BE(2);
      const lo = b.readUInt32BE(6);
      len = hi * 4294967296 + lo;
      offset = 10;
    }
    let maskKey = null;
    if (masked) {
      if (b.length < offset + 4) return null;
      maskKey = b.slice(offset, offset + 4);
      offset += 4;
    }
    if (b.length < offset + len) return null;
    let payload = b.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4];
      payload = out;
    }
    this._buffer = b.slice(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === OP_CLOSE) { this.close(1000); return; }
    if (opcode === OP_PING) {
      try { this.socket.write(encodeFrame(OP_PONG, payload)); } catch (_) {}
      return;
    }
    if (opcode === OP_PONG) return;

    // 分片处理
    if (opcode === OP_CONT) {
      this._fragBufs.push(payload);
    } else {
      this._fragOp = opcode;
      this._fragBufs = [payload];
    }
    if (!fin) return;

    const full = Buffer.concat(this._fragBufs);
    this._fragBufs = [];
    if (this._fragOp === OP_TEXT) this._emit('message', full.toString('utf8'), false);
    else if (this._fragOp === OP_BIN) this._emit('message', full, true);
  }
}

/** WebSocket 服务端（挂在现有 http.Server 上） */
function createWsServer(httpServer, options) {
  const path = (options && options.path) || '/ws';
  const clients = new Set();
  const listeners = { connection: [] };

  httpServer.on('upgrade', (req, socket, head) => {
    let url = '/';
    try { url = new URL(req.url, 'http://localhost').pathname; } catch (_) {}
    if (url !== path) { socket.destroy(); return; }
    const secKey = req.headers['sec-websocket-key'];
    if (!secKey || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }

    const accept = acceptKey(secKey);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n' +
      '\r\n'
    );
    if (head && head.length) socket.unshift(head);

    const ws = new WebSocketConn(socket);
    ws.remoteAddress = socket.remoteAddress;
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));

    for (const fn of listeners.connection) {
      try { fn(ws, req); } catch (_) {}
    }
  });

  return {
    clients,
    on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return this; },
    broadcast(data) {
      for (const ws of clients) ws.send(data);
    },
  };
}

module.exports = { createWsServer };
