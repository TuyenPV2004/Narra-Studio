'use strict';

const aws4 = require('aws4');

function assertRuntime(runtime) {
  const required = ['accessKeyId', 'secretAccessKey', 'bucketName', 'endpoint', 'publicBaseUrl'];
  const missing = required.filter(key => !String(runtime?.[key] || '').trim());
  if (missing.length) throw new Error(`Cloudflare R2 thiếu cấu hình: ${missing.join(', ')}.`);
  if (typeof runtime.fetchImpl !== 'function') throw new Error('Cloudflare R2 thiếu fetchImpl.');
}

function safeObjectKey(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/');
}

async function uploadBuffer(runtime, { bytes, objectKey, contentType = 'application/octet-stream' }) {
  assertRuntime(runtime);
  if (!bytes?.length) throw new Error('Cloudflare R2 không nhận được dữ liệu để upload.');

  const endpoint = new URL(runtime.endpoint);
  const encodedKey = safeObjectKey(objectKey);
  const requestPath = `/${encodeURIComponent(runtime.bucketName)}/${encodedKey}`;
  const request = {
    service: 's3',
    region: 'auto',
    method: 'PUT',
    host: endpoint.host,
    path: requestPath,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  };
  aws4.sign(request, {
    accessKeyId: runtime.accessKeyId,
    secretAccessKey: runtime.secretAccessKey,
  });

  // Chromium owns these restricted transport headers. They remain part of the
  // SigV4 canonical request, while net.fetch writes their identical wire values.
  const fetchHeaders = { ...request.headers };
  delete fetchHeaders.Host;
  delete fetchHeaders.host;
  delete fetchHeaders['Content-Length'];
  delete fetchHeaders['content-length'];
  const fetchBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const response = await runtime.fetchImpl(`${endpoint.origin}${requestPath}`, {
    method: 'PUT',
    headers: fetchHeaders,
    body: fetchBody,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Cloudflare R2 upload thất bại (${response.status}): ${detail.slice(0, 300) || response.statusText}`);
  }

  return {
    key: decodeURIComponent(encodedKey),
    url: `${String(runtime.publicBaseUrl).replace(/\/+$/, '')}/${encodedKey}`,
    size: bytes.length,
    mimeType: contentType,
    etag: response.headers.get('etag'),
  };
}

module.exports = { uploadBuffer };
