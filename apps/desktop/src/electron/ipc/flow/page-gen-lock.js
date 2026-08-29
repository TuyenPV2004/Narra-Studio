'use strict';

let _pageGenLock = Promise.resolve();
function withPageGenLock(fn) {
  const prev = _pageGenLock;
  let resolve;
  _pageGenLock = new Promise(r => { resolve = r; });
  return prev.then(() => fn().finally(() => resolve()));
}

module.exports = { withPageGenLock };
