// captcha-bridge.js — minimal WebSocket server that the Chrome extension
// connects to. Provides getTokenFromExtension(action) which sends a request
// to the connected extension and awaits the reCAPTCHA token.

const net = require('net');
const crypto = require('crypto');

const PORT = 17773;
const HOST = '127.0.0.1';
const REQ_TIMEOUT_MS = 25000;
const HEARTBEAT_INTERVAL_MS = 20000;

let server = null;
let enabled = false;
let retryTimer = null;
let extensionSock = null;
let extensionAlive = false;
let extensionClientStatus = {
  client: null,
  version: null,
  labsTabOpen: false,
  labsProjectOpen: false,
  labsTabUrl: null,
  reportedAt: null,
  lastTokenAt: null,
  lastTokenError: null,
};
let nextReqId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

function ack(sock, key) {
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
}

function sendFrame(sock, payload) {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  sock.write(Buffer.concat([header, data]));
}

function parseFrames(buf, onText) {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    let mask = null;
    if (masked) {
      if (pos + 4 > buf.length) break;
      mask = buf.subarray(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buf.length) break;
    let payload = buf.subarray(pos, pos + len);
    if (masked) {
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
      payload = un;
    }
    if (opcode === 0x1) onText(payload.toString('utf8'));
    if (opcode === 0x8) return -1; // close frame
    offset = pos + len;
  }
  return offset;
}

function handleClient(sock) {
  let buf = Buffer.alloc(0);
  let upgraded = false;
  let heartbeatTimer = null;

  sock.on('error', () => { try { sock.destroy(); } catch (e) {} });
  sock.on('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (sock === extensionSock) {
      extensionSock = null;
      extensionAlive = false;
      extensionClientStatus = {
        ...extensionClientStatus,
        labsTabOpen: false,
        labsProjectOpen: false,
        labsTabUrl: null,
        reportedAt: Date.now(),
        lastTokenAt: null,
        lastTokenError: null,
      };
      console.log('[CAPTCHA-BRIDGE] Extension disconnected');
    }
  });
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!upgraded) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headerStr = buf.subarray(0, headerEnd).toString('utf8');
      const keyMatch = headerStr.match(/sec-websocket-key:\s*(\S+)/i);
      if (!keyMatch) { sock.destroy(); return; }
      ack(sock, keyMatch[1]);
      buf = buf.subarray(headerEnd + 4);
      upgraded = true;
      if (extensionSock && extensionSock !== sock) {
        try { extensionSock.destroy(); } catch {}
      }
      extensionSock = sock;
      extensionAlive = true;
      sock.setKeepAlive?.(true, HEARTBEAT_INTERVAL_MS);
      heartbeatTimer = setInterval(() => {
        if (sock.destroyed) return;
        try { sendFrame(sock, JSON.stringify({ type: 'ping', t: Date.now() })); } catch {}
      }, HEARTBEAT_INTERVAL_MS);
      console.log('[CAPTCHA-BRIDGE] Extension connected');
    }
    const consumed = parseFrames(buf, (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.type === 'hello') {
        extensionClientStatus = {
          ...extensionClientStatus,
          client: msg.client || null,
          version: msg.version || null,
          reportedAt: Date.now(),
        };
        console.log('[CAPTCHA-BRIDGE] Extension hello:', msg.client, msg.version);
      } else if (msg.type === 'status') {
        const nextLabsTabUrl = typeof msg.labsTabUrl === 'string' ? msg.labsTabUrl : null;
        const nextLabsProjectOpen = !!msg.labsProjectOpen;
        const projectChanged = extensionClientStatus.labsTabUrl !== nextLabsTabUrl;
        const projectClosed = extensionClientStatus.labsProjectOpen && !nextLabsProjectOpen;
        extensionClientStatus = {
          ...extensionClientStatus,
          labsTabOpen: !!msg.labsTabOpen,
          labsProjectOpen: nextLabsProjectOpen,
          labsTabUrl: nextLabsTabUrl,
          reportedAt: Date.now(),
          lastTokenAt: projectChanged || projectClosed ? null : extensionClientStatus.lastTokenAt,
          lastTokenError: projectChanged || projectClosed ? null : extensionClientStatus.lastTokenError,
        };
      } else if (msg.type === 'captcha_response') {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.error) {
          extensionClientStatus = { ...extensionClientStatus, lastTokenError: String(msg.error) };
          p.reject(new Error(msg.error));
        } else {
          extensionClientStatus = {
            ...extensionClientStatus,
            lastTokenAt: Date.now(),
            lastTokenError: null,
          };
          p.resolve(msg.token);
        }
      } else if (msg.type === 'pong') {
        // heartbeat ack
      }
    });
    if (consumed === -1) { sock.destroy(); return; }
    if (consumed > 0) buf = buf.subarray(consumed);
  });
}

function start() {
  enabled = true;
  if (server) return;
  server = net.createServer(handleClient);
  server.on('error', (e) => {
    console.warn('[CAPTCHA-BRIDGE] Server error:', e.message);
    server = null;
    // Retry after delay
    if (enabled) retryTimer = setTimeout(start, 5000);
  });
  server.listen(PORT, HOST, () => {
    console.log('[CAPTCHA-BRIDGE] Listening on ws://' + HOST + ':' + PORT);
  });
}

function stop() {
  enabled = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error('CAPTCHA bridge stopped because VEO3 provider is inactive'));
  }
  pending.clear();
  extensionAlive = false;
  try { extensionSock?.destroy(); } catch { }
  extensionSock = null;
  try { server?.close(); } catch { }
  server = null;
}

function isExtensionConnected() {
  return extensionAlive && extensionSock && !extensionSock.destroyed;
}

function getExtensionStatus() {
  return {
    connected: !!isExtensionConnected(),
    ...extensionClientStatus,
  };
}

function getTokenFromExtension(action) {
  return new Promise((resolve, reject) => {
    if (!isExtensionConnected()) {
      reject(new Error('Captcha extension not connected'));
      return;
    }
    const id = nextReqId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Extension token timeout'));
    }, REQ_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      sendFrame(extensionSock, JSON.stringify({ type: 'captcha_request', id, action: action || 'IMAGE_GENERATION' }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });
}

module.exports = { start, stop, getTokenFromExtension, getExtensionStatus, isExtensionConnected, PORT };
