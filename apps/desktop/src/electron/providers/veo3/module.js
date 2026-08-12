'use strict';

const registerFlowIpc = require('../../ipc/flow');
const registerGenerationIpc = require('../../ipc/generation');
const adapter = require('./index');

/**
 * VEO3 provider composition boundary.
 *
 * The legacy Flow implementation remains split into focused IPC/runtime files,
 * but the Electron composition root registers them only through this module.
 * This keeps Google session, CAPTCHA, account-slot and composer behavior from
 * leaking into API-key provider registration.
 */
function register({ sharedDependencies, crossDomainDependencies }) {
  registerFlowIpc(sharedDependencies);
  return registerGenerationIpc({
    ...sharedDependencies,
    ...crossDomainDependencies,
  });
}

module.exports = { ...adapter, register };
