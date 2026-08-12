'use strict';

function assertRuntime(runtime) {
  const missing = ['accountId', 'apiToken'].filter(key => !String(runtime?.[key] || '').trim());
  if (missing.length) {
    throw new Error(`Cloudflare Images chưa cấu hình: thiếu ${missing.join(', ')} trong .secrets/cloudflare.json.`);
  }
  if (typeof runtime.fetchImpl !== 'function') throw new Error('Cloudflare Images: missing fetchImpl.');
}

async function uploadImage(runtime, { bytes, fileName, mimeType } = {}) {
  assertRuntime(runtime);
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!body.length) throw new Error('Cloudflare Images: file rỗng.');
  const contentType = String(mimeType || 'application/octet-stream');
  if (!contentType.startsWith('image/')) {
    throw new Error('Cloudflare Images chỉ nhận file ảnh. Video cần Cloudflare Stream và token có quyền Stream Write.');
  }

  const form = new FormData();
  form.append('file', new Blob([body], { type: contentType }), String(fileName || 'reference-image'));
  form.append('requireSignedURLs', 'false');
  form.append('metadata', JSON.stringify({ source: 'veo3-flow-ai-agent', provider: 'avis' }));

  const response = await runtime.fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtime.accountId)}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.apiToken}` },
      body: form,
    },
  );
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || text.slice(0, 500) || response.statusText;
    throw new Error(`Cloudflare Images upload thất bại (${response.status}): ${message}`);
  }

  const result = payload?.result || {};
  const variants = Array.isArray(result.variants) ? result.variants : [];
  const url = variants.find(value => /\/public(?:\?|$)/i.test(value)) || variants[0] || null;
  if (!url) throw new Error('Cloudflare Images upload thành công nhưng không trả public variant URL.');
  return {
    id: result.id || null,
    url,
    size: body.length,
    mimeType: contentType,
    variants,
  };
}

module.exports = { uploadImage };
