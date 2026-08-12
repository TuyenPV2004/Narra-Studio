'use strict';

const KYC_ASSET_TYPES = new Set(['Image', 'Video', 'Audio']);
const KYC_TERMINAL_STATUSES = new Set(['active', 'failed']);
// Avis uses KYC content parts for the Seedance 2.x identity flow. Keep this
// name-based rather than freezing another model list: the live catalog may add
// Pro/Fast/Mini variants without requiring a desktop release first.
function isSeedanceKycVideoModel(model) {
  return /(?:^|[^a-z0-9])seedance[\s._/-]*2[\s._/-]*(?:0|5)(?:$|[^0-9])/i.test(String(model || ''));
}

async function withFullKycError(action, context) {
  try {
    return await action();
  } catch (reason) {
    const output = {
      context,
      name: reason?.name || 'Error',
      message: reason?.message || String(reason),
      ...(reason?.status != null ? { status: reason.status } : {}),
      ...(reason?.avisMessage != null ? { avisMessage: reason.avisMessage } : {}),
      ...(reason?.avisErrors != null ? { avisErrors: reason.avisErrors } : {}),
      ...(reason?.body != null ? { body: reason.body } : {}),
    };
    let serialized;
    try { serialized = JSON.stringify(output, null, 2); }
    catch { serialized = String(reason?.message || reason); }
    const error = new Error(`${reason?.message || String(reason)}\n\nFull Avis KYC output:\n${serialized}`);
    error.status = reason?.status;
    error.body = output;
    throw error;
  }
}

function normalizeKycStatus(data = {}) {
  return {
    isKyc: Boolean(data.isKyc ?? data.kycCompleted ?? data.verified),
    status: String(data.status || (data.isKyc ? 'verified' : 'unverified')).toLowerCase(),
    raw: data,
  };
}

function normalizeKycAsset(data = {}) {
  const rawStatus = String(data.status || data.state || 'processing').toLowerCase();
  return {
    assetId: String(data.assetId || data.id || '').trim() || null,
    assetType: data.assetType || data.type || null,
    name: data.name || null,
    status: ['processing', 'active', 'failed'].includes(rawStatus) ? rawStatus : 'processing',
    errorCode: data.errorCode || data.error?.code || null,
    errorMessage: data.errorMessage || data.error?.message || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    raw: data,
  };
}

function validateAssetCreate(params = {}) {
  const url = String(params.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('Provider KYC asset requires a public HTTPS URL.');
  const assetType = String(params.assetType || 'Image').trim();
  if (!KYC_ASSET_TYPES.has(assetType)) throw new Error(`Provider KYC assetType must be Image, Video, or Audio (received ${assetType || 'empty'}).`);
  const name = String(params.name || '').trim();
  if (name.length > 64) throw new Error('Provider KYC asset name must be at most 64 characters.');
  return { url, assetType, ...(name ? { name } : {}) };
}

async function getKycStatus(runtime, requestJson) {
  return withFullKycError(async () => {
    const data = await requestJson(runtime, { path: '/kyc/user/status', method: 'GET' });
    return normalizeKycStatus(data);
  }, 'GET /api/v1/kyc/user/status');
}

async function createKycAsset(runtime, requestJson, params = {}) {
  return withFullKycError(async () => {
    const body = validateAssetCreate(params);
    const data = await requestJson(runtime, { path: '/kyc/user/assets', body });
    const asset = normalizeKycAsset(data);
    if (!asset.assetId) throw Object.assign(new Error('Provider KYC create asset did not return assetId.'), { body: data });
    return asset;
  }, 'POST /api/v1/kyc/user/assets');
}

async function getKycAsset(runtime, requestJson, assetId) {
  return withFullKycError(async () => {
    const id = String(assetId || '').trim();
    if (!id) throw new Error('Provider KYC assetId is required.');
    const data = await requestJson(runtime, { path: `/kyc/user/assets/${encodeURIComponent(id)}`, method: 'GET' });
    return normalizeKycAsset(data);
  }, 'GET /api/v1/kyc/user/assets/:assetId');
}

function validateVideoInputs(model, inputs = []) {
  if (!Array.isArray(inputs) || !inputs.length) return [];
  if (!isSeedanceKycVideoModel(model)) {
    throw new Error('Provider KYC content parts are accepted only by Seedance 2.0/2.5 models.');
  }
  return inputs.map((input, index) => {
    const assetId = String(input?.assetId || '').trim();
    const assetType = String(input?.assetType || '').trim();
    if (!assetId) throw new Error(`Avis KYC input ${index + 1} is missing assetId.`);
    if (!KYC_ASSET_TYPES.has(assetType)) throw new Error(`Avis KYC input ${index + 1} has invalid assetType.`);
    return { assetId, assetType };
  });
}

module.exports = {
  KYC_ASSET_TYPES,
  KYC_TERMINAL_STATUSES,
  normalizeKycStatus,
  normalizeKycAsset,
  validateAssetCreate,
  getKycStatus,
  createKycAsset,
  getKycAsset,
  isSeedanceKycVideoModel,
  validateVideoInputs,
};
