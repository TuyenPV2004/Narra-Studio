'use strict';

const veo3 = require('./veo3');
const avis = require('./avis/adapter');
const { brand } = require('../runtime/brand');

const adapters = Object.freeze({ veo3, avis });
const DEFAULT_PROVIDER_ID = 'veo3';
const externalProvidersEnabled = brand.features?.externalProviders === true;

function normalizeProviderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (id === 'avis' && !externalProvidersEnabled) return DEFAULT_PROVIDER_ID;
  return Object.prototype.hasOwnProperty.call(adapters, id) ? id : DEFAULT_PROVIDER_ID;
}

function listProviders() {
  return Object.values(adapters)
    .filter(adapter => externalProvidersEnabled || adapter.manifest.id !== 'avis')
    .map(adapter => adapter.manifest);
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
