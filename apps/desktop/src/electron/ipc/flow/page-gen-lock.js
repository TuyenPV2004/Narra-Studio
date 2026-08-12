'use strict';

/**
 * Mutex serializing every webview UI interaction — a generation and a model/
 * aspect click must never drive the same page at once.
 *
 * Module-level on purpose: `require` caching makes this one lock per process,
 * shared by page-generation.js and selectors.js.
 */
let _pageGenLock = Promise.resolve();
function withPageGenLock(fn) {
  const prev = _pageGenLock;
  let resolve;
  _pageGenLock = new Promise(r => { resolve = r; });
  return prev.then(() => fn().finally(() => resolve()));
}

module.exports = { withPageGenLock };
