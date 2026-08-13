'use strict';

(function exposeNarraCaptchaProtocol(globalObject) {
  const VERSION = '1.3.1';
  const ALLOWED_ACTIONS = Object.freeze(['IMAGE_GENERATION', 'VIDEO_GENERATION', 'TEST']);
  const SAFE_ERRORS = new Set([
    'Google Flow project is not open',
    'reCAPTCHA runtime unavailable',
    'reCAPTCHA site key unavailable',
    'reCAPTCHA token unavailable',
    'Token request timed out',
  ]);

  function parseBridgeMessage(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function validateCaptchaRequest(message) {
    if (!message || message.type !== 'captcha_request') {
      throw new Error('Invalid CAPTCHA request type');
    }
    if (!Number.isSafeInteger(message.id) || message.id <= 0) {
      throw new Error('Invalid CAPTCHA request id');
    }
    if (!ALLOWED_ACTIONS.includes(message.action)) {
      throw new Error('Unsupported CAPTCHA action');
    }
    return {id: message.id, action: message.action};
  }

  function toSafeError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return SAFE_ERRORS.has(message) ? message : 'Token request failed';
  }

  globalObject.NarraCaptchaProtocol = Object.freeze({
    VERSION,
    ALLOWED_ACTIONS,
    parseBridgeMessage,
    validateCaptchaRequest,
    toSafeError,
  });
})(globalThis);
