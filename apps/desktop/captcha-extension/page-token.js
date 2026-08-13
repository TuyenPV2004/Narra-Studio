'use strict';

(function exposeNarraCaptchaPageToken(globalObject) {
  const TOKEN_TIMEOUT_MS = 20000;

  function findSiteKey() {
    const scripts = globalObject.document?.querySelectorAll?.(
      'script[src*="recaptcha/enterprise"]',
    ) || [];
    for (const script of scripts) {
      try {
        const siteKey = new URL(script.src).searchParams.get('render');
        if (siteKey && siteKey !== 'explicit') return siteKey;
      } catch {
        // Ignore malformed script URLs and keep looking for the loaded runtime.
      }
    }
    throw new Error('reCAPTCHA site key unavailable');
  }

  async function requestToken(action) {
    const siteKey = findSiteKey();
    const enterprise = globalObject.grecaptcha?.enterprise;
    if (typeof enterprise?.ready !== 'function' || typeof enterprise?.execute !== 'function') {
      throw new Error('reCAPTCHA runtime unavailable');
    }

    const token = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('Token request timed out')),
        TOKEN_TIMEOUT_MS,
      );
      try {
        enterprise.ready(async () => {
          try {
            finish(resolve, await enterprise.execute(siteKey, {action}));
          } catch {
            finish(reject, new Error('Token request failed'));
          }
        });
      } catch {
        finish(reject, new Error('Token request failed'));
      }
    });

    if (typeof token !== 'string' || token.length <= 20) {
      throw new Error('reCAPTCHA token unavailable');
    }
    return token;
  }

  globalObject.NarraCaptchaPageToken = Object.freeze({requestToken});
})(globalThis);
