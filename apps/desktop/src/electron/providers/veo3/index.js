'use strict';

const manifest = Object.freeze({
  id: 'veo3',
  name: 'Google VEO3',
  description: 'Google Flow session provider',
  credentialMode: 'browser-session',
  capabilities: ['image', 'video', 'references', 'upscale'],
});

function getStatus({ accountSlots = [] } = {}) {
  const connected = accountSlots.filter(slot => !!slot?.bearerToken);
  const active = connected[0] || null;
  return {
    id: manifest.id,
    configured: connected.length > 0,
    ready: connected.some(slot => !!slot.projectId),
    accountCount: connected.length,
    account: active ? {
      email: active.email || null,
      displayName: active.displayName || null,
      projectId: active.projectId || null,
    } : null,
  };
}

module.exports = { manifest, getStatus };
