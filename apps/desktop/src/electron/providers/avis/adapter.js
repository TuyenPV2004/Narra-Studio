'use strict';

const manifest = Object.freeze({
  id: 'avis',
  name: 'External AI',
  description: 'API-key provider for image, video, audio and AI workflows',
  credentialMode: 'api-key',
  capabilities: ['text', 'image', 'video', 'audio', 'references', 'kyc'],
});

async function getStatus({ getAvisMediaRuntime, avisProvider } = {}) {
  const runtime = typeof getAvisMediaRuntime === 'function' ? getAvisMediaRuntime() : null;
  const status = {
    id: manifest.id,
    configured: !!runtime?.configured,
    ready: false,
    balance: null,
    error: null,
  };
  if (!runtime?.configured || !avisProvider) return status;
  try {
    const result = await Promise.race([
      avisProvider.getBalance(runtime),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI Provider status check timed out')), 4000)),
    ]);
    status.ready = true;
    status.balance = result.creditBalance;
  } catch (error) {
    status.error = error?.avisMessage || error?.message || String(error);
  }
  return status;
}

module.exports = { manifest, getStatus };
