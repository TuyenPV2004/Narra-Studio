import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {CodexBridge} from '../src/electron/codex-bridge.js';
import type {CodexBridgeError} from '../src/electron/codex-bridge.js';

type Request = {id?: number; method: string; params?: Record<string, unknown>};

const createFakeAppServer = (overrides: Record<string, (request: Request) => unknown> = {}) => {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: () => boolean;
  };
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.killed = false;
  process.kill = () => {
    process.killed = true;
    process.emit('exit', 0, null);
    return true;
  };

  let buffer = '';
  const requests: Request[] = [];
  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const request = JSON.parse(line) as Request;
      requests.push(request);
      if (request.id === undefined) continue;
      try {
        const handler = overrides[request.method];
        const result = handler ? handler(request) : responses[request.method]?.(request);
        if (!handler && !responses[request.method]) {
          process.stdout.write(`${JSON.stringify({id: request.id, error: {code: -32601, message: 'not found'}})}\n`);
        } else {
          process.stdout.write(`${JSON.stringify({id: request.id, result})}\n`);
        }
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          id: request.id,
          error: {code: -32000, message: error instanceof Error ? error.message : String(error)},
        })}\n`);
      }
    }
  });

  const responses: Record<string, (request: Request) => unknown> = {
    initialize: () => ({userAgent: 'fake'}),
    'account/read': () => ({account: {type: 'chatgpt', planType: 'plus', email: 'must-not-leak@example.test'}}),
    'account/login/start': (request) => request.params?.type === 'chatgptDeviceCode'
      ? {loginId: 'login-device', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH'}
      : {loginId: 'login-browser', authUrl: 'https://chatgpt.com/auth'},
    'model/list': () => ({data: [{
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      description: 'Coding model',
      supportedReasoningEfforts: [{reasoningEffort: 'medium', description: 'Balanced'}],
      defaultReasoningEffort: 'medium',
    }]}),
    'thread/start': () => ({thread: {id: 'thread-1'}}),
    'thread/resume': (request) => ({thread: {id: request.params?.threadId}}),
    'turn/start': () => {
      process.stdout.write(`${JSON.stringify({
        method: 'item/agentMessage/delta',
        params: {threadId: 'thread-1', turnId: 'turn-1', delta: 'Hello'},
      })}\n`);
      return {turn: {id: 'turn-1'}};
    },
    'turn/interrupt': () => ({}),
    'account/rateLimits/read': () => ({rateLimits: {primary: {usedPercent: 12}}}),
  };

  return {process: process as unknown as ChildProcessWithoutNullStreams, requests};
};

describe('CodexBridge', () => {
  it('handshakes, correlates requests, streams notifications, and exposes sanitized account data', async () => {
    const fake = createFakeAppServer();
    const bridge = new CodexBridge({spawnProcess: () => fake.process, requestTimeoutMs: 500});
    const notifications: Array<{method: string; params: unknown}> = [];
    bridge.on('notification', (notification) => notifications.push(notification));

    await bridge.start();
    expect(fake.requests.slice(0, 2).map(({method}) => method)).toEqual(['initialize', 'initialized']);
    await expect(bridge.readAccount()).resolves.toEqual({signedIn: true, accountType: 'chatgpt', planType: 'plus'});
    await expect(bridge.startBrowserLogin()).resolves.toMatchObject({loginId: 'login-browser'});
    await expect(bridge.startDeviceLogin()).resolves.toMatchObject({loginId: 'login-device', userCode: 'ABCD-EFGH'});
    await expect(bridge.assertModelAvailable()).resolves.toBeUndefined();
    await expect(bridge.startThread({cwd: 'D:/Narra/project'})).resolves.toEqual({threadId: 'thread-1'});
    await expect(bridge.resumeThread('thread-1')).resolves.toEqual({threadId: 'thread-1'});
    await expect(bridge.startTurn({threadId: 'thread-1', text: 'Say hello', cwd: 'D:/Narra/project'}))
      .resolves.toEqual({turnId: 'turn-1'});
    await expect(bridge.readRateLimits()).resolves.toMatchObject({rateLimits: {primary: {usedPercent: 12}}});
    await expect(bridge.interruptTurn('thread-1', 'turn-1')).resolves.toBeUndefined();
    expect(notifications).toContainEqual({
      method: 'item/agentMessage/delta',
      params: {threadId: 'thread-1', turnId: 'turn-1', delta: 'Hello'},
    });

    bridge.close();
    expect(fake.process.killed).toBe(true);
  });

  it('does not silently fall back when the desired model is missing', async () => {
    const fake = createFakeAppServer({
      'model/list': () => ({data: [{id: 'gpt-other', supportedReasoningEfforts: [{reasoningEffort: 'low'}]}]}),
    });
    const bridge = new CodexBridge({spawnProcess: () => fake.process, requestTimeoutMs: 500});

    await expect(bridge.assertModelAvailable('gpt-5.6-sol', 'medium')).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
    expect(fake.requests.some(({method}) => method === 'thread/start')).toBe(false);
    bridge.close();
  });

  it('maps App Server errors and rejects pending work when the process exits', async () => {
    const fake = createFakeAppServer({'account/read': () => { throw new Error('sign in required'); }});
    const bridge = new CodexBridge({spawnProcess: () => fake.process, requestTimeoutMs: 500});

    await expect(bridge.readAccount()).rejects.toEqual(expect.objectContaining<Partial<CodexBridgeError>>({
      code: 'SIGNED_OUT',
      message: 'sign in required',
    }));
    bridge.close();
  });
});
