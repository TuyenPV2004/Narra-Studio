'use strict';

const registerFlowIpc = require('../../ipc/flow');
const registerGenerationIpc = require('../../ipc/generation');
const adapter = require('./index');

function register({ sharedDependencies, crossDomainDependencies }) {
  registerFlowIpc(sharedDependencies);
  return registerGenerationIpc({
    ...sharedDependencies,
    ...crossDomainDependencies,
  });
}

module.exports = { ...adapter, register };
