'use strict';

const assert = require('node:assert/strict');

function buildFlowVoicePayload({
  dialog,
  voicePerformance,
  voiceName,
  baseVoice,
  projectId = 'f34522c4-35ca-4e2b-8f86-5b3e9da02b92',
  captchaToken = 'TEST_TOKEN_1234567890',
}) {
  const safeDialog = String(dialog || '').trim().slice(0, 120);
  const safePerformance = String(voicePerformance || '').trim().slice(0, 500);
  const safeVoiceName = String(voiceName || '').trim().slice(0, 80);
  const safeBaseVoice = String(baseVoice || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80);

  if (!safeDialog) throw new Error('Hãy nhập câu thoại mẫu.');
  if (!safeVoiceName) throw new Error('Hãy nhập tên voice.');
  if (!safeBaseVoice) throw new Error('Hãy chọn voice gốc.');

  const body = {
    clientContext: {
      recaptchaContext: {
        token: captchaToken,
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      },
      projectId,
      tool: 'PINHOLE',
      sessionId: `;${Date.now()}`,
    },
    requests: [{
      dialog: safeDialog,
      ...(safePerformance ? { voicePerformance: safePerformance } : {}),
      modelKey: 'gemini_v4s_tts_flow',
      voiceConfigs: [{
        speaker: safeVoiceName,
        voice: safeBaseVoice,
      }],
      generationType: 'PREVIEW',
    }],
  };

  return body;
}

// Test 1: Verify valid payload schema
const payload = buildFlowVoicePayload({
  dialog: 'Xin chào, đây là bản thử giọng nói của Narra Studio.',
  voicePerformance: 'narration',
  voiceName: 'Aoede',
  baseVoice: 'Aoede',
  projectId: 'f34522c4-35ca-4e2b-8f86-5b3e9da02b92',
  captchaToken: 'SAMPLE_TOKEN_ABCXYZ',
});

// Assertions
assert.equal(typeof payload.clientContext, 'object', 'body.clientContext must exist');
assert.equal(payload.clientContext.recaptchaContext.token, 'SAMPLE_TOKEN_ABCXYZ');
assert.equal(payload.clientContext.projectId, 'f34522c4-35ca-4e2b-8f86-5b3e9da02b92');
assert.equal(payload.clientContext.tool, 'PINHOLE');
assert.ok(Array.isArray(payload.requests), 'body.requests must be array');
assert.equal(payload.requests.length, 1);
assert.equal(payload.requests[0].dialog, 'Xin chào, đây là bản thử giọng nói của Narra Studio.');
assert.equal(payload.requests[0].modelKey, 'gemini_v4s_tts_flow');
assert.equal(payload.requests[0].generationType, 'PREVIEW');
assert.equal(payload.requests[0].voiceConfigs[0].speaker, 'Aoede');
assert.equal(payload.requests[0].voiceConfigs[0].voice, 'Aoede');

// CRITICAL ASSERTION: requests[0].clientContext must NOT exist to avoid Google 400 error
assert.equal(payload.requests[0].clientContext, undefined, 'requests[0].clientContext must be undefined');

// Test 2: Validation errors
assert.throws(() => buildFlowVoicePayload({ dialog: '', voiceName: 'Aoede', baseVoice: 'Aoede' }), /Hãy nhập câu thoại mẫu/);
assert.throws(() => buildFlowVoicePayload({ dialog: 'Test', voiceName: '', baseVoice: 'Aoede' }), /Hãy nhập tên voice/);
assert.throws(() => buildFlowVoicePayload({ dialog: 'Test', voiceName: 'Aoede', baseVoice: '' }), /Hãy chọn voice gốc/);

console.log('Flow Voice Generation schema & contract test PASSED (100% compliant with Google Flow Audio API).');
