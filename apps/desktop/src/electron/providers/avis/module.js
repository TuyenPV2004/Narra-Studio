'use strict';

const provider = require('./index');
const adapter = require('./adapter');

module.exports = {
  ...adapter,
  provider,
};
