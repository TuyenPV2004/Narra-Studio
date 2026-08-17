'use strict';

const veo3 = require('./veo3');

const adapters = Object.freeze({ veo3 });
const DEFAULT_PROVIDER_ID = 'veo3';

function normalizeProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(adapters, id) ? id : DEFAULT_PROVIDER_ID;
}

function listProviders() {
  return Object.values(adapters).map(adapter => adapter.manifest);
}

function getProviderAdapter(id) {
  return adapters[normalizeProviderId(id)];
}

module.exports = {
  DEFAULT_PROVIDER_ID,
  normalizeProviderId,
  listProviders,
  getProviderAdapter,
};
