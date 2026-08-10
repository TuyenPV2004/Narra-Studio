import {
  ProjectStore,
  LocalJobRunner,
  type AssetStatusInput,
  type CreateAssetTaskInput,
  type CreateProjectInput,
  type ApprovalGate,
  type EditorialDocument,
  type SelectTopicInput,
  type SaveOutlineInput,
  type PrepareFlowTaskInput,
  type RenderTarget,
  type GenerateNarrationInput,
  type GenerateNarrationBatchInput,
  type UpdateCaptionCueInput,
  type UpdateShotAudioInput,
  type SystemDiagnostics,
  KokoroOnnxProvider,
} from '@narra/project-store';
import {getAiStageJsonSchema, type AiReasoningEffort, type AiStage} from '@narra/contracts';
import {app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, shell, type MenuItemConstructorOptions} from 'electron';
import {accessSync, constants, existsSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {IPC_CHANNELS} from './ipc-channels.js';
import {
  CodexBridge,
  CodexBridgeError,
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  type CodexBridgeNotification,
  type JsonRpcId,
} from './codex-bridge.js';
import {
  buildProjectQuestionPrompt,
  buildProjectQuestionTranslationPrompt,
  finalizeProjectQuestionResult,
  normalizeSourceUrl,
  parseProjectQuestionTranslation,
  parseProjectQuestionResult,
  PROJECT_QUESTION_EFFORT,
  PROJECT_QUESTION_MODEL,
  PROJECT_QUESTION_OUTPUT_SCHEMA,
  PROJECT_QUESTION_TRANSLATION_OUTPUT_SCHEMA,
  shouldRecordOpenedSource,
  type OpenedProjectQuestionSource,
  type ProjectQuestionGenerationResult,
} from './project-question-generation.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let projectStore: ProjectStore | null = null;
let jobRunner: LocalJobRunner | null = null;
let codexBridge: CodexBridge | null = null;
const activeAiRuns = new Map<string, {projectId: string; runId: string; structuredStage?: AiStage}>();
const pendingCodexRequests = new Map<JsonRpcId, string>();
const pendingTurnCompletions = new Map<string, CodexBridgeNotification>();
const completedAgentMessages = new Map<string, string>();
type PendingProjectQuestionGeneration = {
  requestId: string;
  threadId: string;
  turnId: string | null;
  openedSources: Map<string, OpenedProjectQuestionSource>;
  cancelRequested: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: ProjectQuestionGenerationResult) => void;
  reject: (error: Error) => void;
};
const projectQuestionGenerationsByRequest = new Map<string, PendingProjectQuestionGeneration>();
const projectQuestionGenerationsByThread = new Map<string, PendingProjectQuestionGeneration>();
const projectQuestionGenerationsByTurn = new Map<string, PendingProjectQuestionGeneration>();
type PendingProjectQuestionTranslation = {
  requestId: string;
  threadId: string;
  turnId: string | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
};
const projectQuestionTranslationsByRequest = new Map<string, PendingProjectQuestionTranslation>();
const projectQuestionTranslationsByThread = new Map<string, PendingProjectQuestionTranslation>();
const projectQuestionTranslationsByTurn = new Map<string, PendingProjectQuestionTranslation>();

const getRepositoryRoot = (): string => app.isPackaged
  ? path.join(process.resourcesPath, 'narra-runtime')
  : path.resolve(currentDirectory, '../../..');

const findLocalRepositoryRoot = (startPath: string): string | null => {
  let candidate = path.resolve(startPath);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(candidate, 'package.json'))
      && existsSync(path.join(candidate, 'apps', 'desktop'))
      && existsSync(path.join(candidate, 'packages', 'project-store'))
    ) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
};

const getLocalStorageRoot = (): string => {
  if (process.env.NARRA_STORAGE_ROOT) return path.resolve(process.env.NARRA_STORAGE_ROOT);
  for (const startPath of [process.cwd(), path.dirname(process.execPath), currentDirectory]) {
    const repositoryRoot = findLocalRepositoryRoot(startPath);
    if (repositoryRoot) return repositoryRoot;
  }
  return app.getPath('userData');
};

const runVersionCheck = (file: string, args: string[], cwd: string): Promise<{ok: boolean; detail: string}> =>
  new Promise((resolve) => {
    const child = spawn(file, args, {cwd, windowsHide: true, shell: false, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve({ok: false, detail: 'Timed out after 10 seconds.'}); }, 10_000);
    child.stdout.on('data', (data: Buffer) => { output += data.toString('utf8'); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString('utf8'); });
    child.once('error', (error) => { clearTimeout(timer); resolve({ok: false, detail: error.message}); });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ok: code === 0, detail: output.trim().split(/\r?\n/)[0] ?? `Exited with code ${code}`});
    });
  });

protocol.registerSchemesAsPrivileged([
  {scheme: 'narra-media', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}},
]);

const getProjectStore = (): ProjectStore => {
  if (!projectStore) throw new Error('Project workspace is not ready.');
  return projectStore;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const codexRunError = (error: unknown) => ({
  code: error instanceof CodexBridgeError && [
    'CODEX_NOT_FOUND', 'SIGNED_OUT', 'MODEL_UNAVAILABLE', 'RATE_LIMITED', 'APP_SERVER_ERROR',
  ].includes(error.code) ? error.code as 'CODEX_NOT_FOUND' | 'SIGNED_OUT' | 'MODEL_UNAVAILABLE' | 'RATE_LIMITED' | 'APP_SERVER_ERROR' : 'UNKNOWN' as const,
  message: error instanceof Error ? error.message : 'Codex run failed.',
  retryable: !(error instanceof CodexBridgeError && error.code === 'MODEL_UNAVAILABLE'),
});

const shouldForwardCodexNotification = ({method, params}: CodexBridgeNotification): boolean => {
  if (method.startsWith('item/reasoning/')) return false;
  if (method === 'item/started' || method === 'item/completed') {
    return asRecord(asRecord(params).item).type !== 'reasoning';
  }
  return true;
};

const broadcastCodexEvent = (payload: Record<string, unknown>): void => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.codexEvent, payload);
};

const broadcastProjectQuestionProgress = (
  pending: Pick<PendingProjectQuestionGeneration, 'requestId'>,
  phase: 'CONNECTING' | 'RESEARCHING' | 'DRAFTING' | 'COMPLETED' | 'CANCELLED' | 'FAILED',
  detail: Record<string, unknown> = {},
): void => broadcastCodexEvent({type: 'projectQuestionGeneration', requestId: pending.requestId, phase, ...detail});

const cleanupProjectQuestionGeneration = (pending: PendingProjectQuestionGeneration): void => {
  clearTimeout(pending.timer);
  projectQuestionGenerationsByRequest.delete(pending.requestId);
  projectQuestionGenerationsByThread.delete(pending.threadId);
  if (pending.turnId) {
    projectQuestionGenerationsByTurn.delete(pending.turnId);
    pendingTurnCompletions.delete(pending.turnId);
    completedAgentMessages.delete(pending.turnId);
  }
};

const findProjectQuestionGeneration = (notification: CodexBridgeNotification): PendingProjectQuestionGeneration | undefined => {
  const params = asRecord(notification.params);
  const turn = asRecord(params.turn);
  const item = asRecord(params.item);
  const turnId = typeof params.turnId === 'string' ? params.turnId : typeof turn.id === 'string' ? turn.id : null;
  const threadId = typeof params.threadId === 'string'
    ? params.threadId
    : typeof turn.threadId === 'string'
      ? turn.threadId
      : typeof item.threadId === 'string' ? item.threadId : null;
  return (turnId ? projectQuestionGenerationsByTurn.get(turnId) : undefined)
    ?? (threadId ? projectQuestionGenerationsByThread.get(threadId) : undefined);
};

const trackProjectQuestionActivity = (notification: CodexBridgeNotification): void => {
  const pending = findProjectQuestionGeneration(notification);
  if (!pending) return;
  const params = asRecord(notification.params);
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const item = asRecord(params.item);
    if (item.type === 'webSearch') {
      const action = asRecord(item.action);
      const url = typeof action.url === 'string' ? action.url : null;
      if (shouldRecordOpenedSource(notification.method, action.type, url)) {
        try {
          const accessedAt = new Date().toISOString();
          const normalizedUrl = normalizeSourceUrl(url);
          if (!pending.openedSources.has(normalizedUrl)) {
            pending.openedSources.set(normalizedUrl, {url, accessedAt});
            broadcastProjectQuestionProgress(pending, 'RESEARCHING', {source: {url, accessedAt}});
          }
        } catch {
          // Ignore malformed tool metadata; the final provenance check remains authoritative.
        }
      } else {
        broadcastProjectQuestionProgress(pending, 'RESEARCHING');
      }
    }
  }
  if (notification.method === 'item/agentMessage/delta') {
    broadcastProjectQuestionProgress(pending, 'DRAFTING');
  }
  if (notification.method !== 'turn/completed') return;
  const turn = asRecord(params.turn);
  const turnId = typeof turn.id === 'string' ? turn.id : pending.turnId;
  if (!turnId) return;
  if (turn.status === 'interrupted' || pending.cancelRequested) {
    broadcastProjectQuestionProgress(pending, 'CANCELLED');
    cleanupProjectQuestionGeneration(pending);
    pending.reject(new Error('Đã dừng tạo câu hỏi dẫn dắt.'));
    return;
  }
  if (turn.status !== 'completed') {
    const error = asRecord(turn.error);
    const message = typeof error.message === 'string' ? error.message : 'Codex không thể hoàn tất câu hỏi dẫn dắt.';
    broadcastProjectQuestionProgress(pending, 'FAILED', {message});
    cleanupProjectQuestionGeneration(pending);
    pending.reject(new Error(message));
    return;
  }
  try {
    const message = completedAgentMessages.get(turnId);
    if (!message) throw new Error('Codex hoàn tất nhưng không trả về kết quả có cấu trúc.');
    const draft = parseProjectQuestionResult(JSON.parse(message));
    const result = finalizeProjectQuestionResult(draft, pending.openedSources.values());
    broadcastProjectQuestionProgress(pending, 'COMPLETED', {sources: result.sources});
    cleanupProjectQuestionGeneration(pending);
    pending.resolve(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Kết quả tạo câu hỏi không hợp lệ.';
    broadcastProjectQuestionProgress(pending, 'FAILED', {message});
    cleanupProjectQuestionGeneration(pending);
    pending.reject(new Error(message));
  }
};

const cleanupProjectQuestionTranslation = (pending: PendingProjectQuestionTranslation): void => {
  clearTimeout(pending.timer);
  projectQuestionTranslationsByRequest.delete(pending.requestId);
  projectQuestionTranslationsByThread.delete(pending.threadId);
  if (pending.turnId) {
    projectQuestionTranslationsByTurn.delete(pending.turnId);
    pendingTurnCompletions.delete(pending.turnId);
    completedAgentMessages.delete(pending.turnId);
  }
};

const findProjectQuestionTranslation = (
  notification: CodexBridgeNotification,
): PendingProjectQuestionTranslation | undefined => {
  const params = asRecord(notification.params);
  const turn = asRecord(params.turn);
  const item = asRecord(params.item);
  const turnId = typeof params.turnId === 'string' ? params.turnId : typeof turn.id === 'string' ? turn.id : null;
  const threadId = typeof params.threadId === 'string'
    ? params.threadId
    : typeof turn.threadId === 'string'
      ? turn.threadId
      : typeof item.threadId === 'string' ? item.threadId : null;
  return (turnId ? projectQuestionTranslationsByTurn.get(turnId) : undefined)
    ?? (threadId ? projectQuestionTranslationsByThread.get(threadId) : undefined);
};

const trackProjectQuestionTranslation = (notification: CodexBridgeNotification): void => {
  if (notification.method !== 'turn/completed') return;
  const pending = findProjectQuestionTranslation(notification);
  if (!pending) return;
  const turn = asRecord(asRecord(notification.params).turn);
  const turnId = typeof turn.id === 'string' ? turn.id : pending.turnId;
  if (!turnId) return;
  if (turn.status !== 'completed') {
    const error = asRecord(turn.error);
    const message = typeof error.message === 'string' ? error.message : 'Codex không thể hoàn tất bản dịch.';
    cleanupProjectQuestionTranslation(pending);
    pending.reject(new Error(message));
    return;
  }
  try {
    const message = completedAgentMessages.get(turnId);
    if (!message) throw new Error('Codex hoàn tất nhưng không trả về bản dịch có cấu trúc.');
    const translation = parseProjectQuestionTranslation(JSON.parse(message));
    cleanupProjectQuestionTranslation(pending);
    pending.resolve(translation);
  } catch (error) {
    cleanupProjectQuestionTranslation(pending);
    pending.reject(new Error(error instanceof Error ? error.message : 'Bản dịch không hợp lệ.'));
  }
};

const captureCompletedAgentMessage = (notification: CodexBridgeNotification): void => {
  if (notification.method !== 'item/completed') return;
  const params = asRecord(notification.params);
  const item = asRecord(params.item);
  const turnId = typeof params.turnId === 'string' ? params.turnId : null;
  if (turnId && item.type === 'agentMessage' && typeof item.text === 'string') {
    completedAgentMessages.set(turnId, item.text);
  }
};

const completeTrackedAiRun = (notification: CodexBridgeNotification): void => {
  if (notification.method !== 'turn/completed') return;
  const turn = asRecord(asRecord(notification.params).turn);
  const turnId = typeof turn.id === 'string' ? turn.id : null;
  if (!turnId) return;
  const tracked = activeAiRuns.get(turnId);
  if (!tracked) {
    pendingTurnCompletions.set(turnId, notification);
    return;
  }
  activeAiRuns.delete(turnId);
  const status = turn.status;
  const completedAt = new Date().toISOString();
  if (status === 'completed') {
    try {
      if (tracked.structuredStage) {
        const message = completedAgentMessages.get(turnId);
        if (!message) throw new Error('Codex completed without a structured agent message.');
        getProjectStore().applyEditorialStageOutput(tracked.projectId, tracked.structuredStage, tracked.runId, JSON.parse(message));
        broadcastCodexEvent({type: 'editorialStageCompleted', projectId: tracked.projectId, stage: tracked.structuredStage, runId: tracked.runId});
      }
      getProjectStore().updateAiRun(tracked.projectId, tracked.runId, {status: 'COMPLETED', completedAt});
    } catch (error) {
      getProjectStore().updateAiRun(tracked.projectId, tracked.runId, {
        status: 'FAILED', completedAt,
        error: {code: 'SCHEMA_INVALID', message: error instanceof Error ? error.message : 'Structured output is invalid.', retryable: true},
      });
      broadcastCodexEvent({
        type: 'editorialStageFailed', projectId: tracked.projectId, stage: tracked.structuredStage,
        runId: tracked.runId, message: error instanceof Error ? error.message : 'Structured output is invalid.',
      });
    }
  } else if (status === 'interrupted') {
    getProjectStore().updateAiRun(tracked.projectId, tracked.runId, {status: 'CANCELLED', completedAt});
  } else {
    const error = asRecord(turn.error);
    getProjectStore().updateAiRun(tracked.projectId, tracked.runId, {
      status: 'FAILED',
      completedAt,
      error: {code: 'APP_SERVER_ERROR', message: typeof error.message === 'string' ? error.message : 'Codex turn failed.', retryable: true},
    });
  }
  completedAgentMessages.delete(turnId);
};

const getCodexBridge = (): CodexBridge => {
  if (!codexBridge) {
    codexBridge = new CodexBridge({executable: process.env.NARRA_CODEX_EXECUTABLE || 'codex'});
    codexBridge.on('notification', (notification: CodexBridgeNotification) => {
      captureCompletedAgentMessage(notification);
      completeTrackedAiRun(notification);
      trackProjectQuestionActivity(notification);
      trackProjectQuestionTranslation(notification);
      if (!shouldForwardCodexNotification(notification)) return;
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.codexEvent, {type: 'notification', ...notification});
      }
    });
    codexBridge.on('serverRequest', (request: CodexBridgeNotification & {id: JsonRpcId}) => {
      pendingCodexRequests.set(request.id, request.method);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.codexEvent, {type: 'serverRequest', ...request});
      }
    });
    codexBridge.on('status', (status: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.codexEvent, {type: 'status', ...status as object});
      }
    });
    codexBridge.on('protocolError', (error: Error) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.codexEvent, {
          type: 'error',
          code: 'APP_SERVER_ERROR',
          message: error.message,
        });
      }
    });
  }
  return codexBridge;
};

const openCodexLoginUrl = async (urlValue: string | undefined): Promise<void> => {
  if (!urlValue) return;
  const url = new URL(urlValue);
  if (url.protocol !== 'https:') throw new Error('Codex returned an unsupported login URL.');
  await shell.openExternal(url.toString());
};

const registerCodexHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.codexGetWorkspace, (_event, projectId: string) =>
    getProjectStore().getAiWorkspace(projectId));
  ipcMain.handle(
    IPC_CHANNELS.codexUpdateSettings,
    (_event, projectId: string, input: {desiredModel: string; desiredEffort: AiReasoningEffort}) =>
      getProjectStore().updateAiProjectSettings(projectId, input),
  );
  ipcMain.handle(IPC_CHANNELS.codexReadAccount, async () => getCodexBridge().readAccount());
  ipcMain.handle(IPC_CHANNELS.codexStartBrowserLogin, async () => {
    const result = await getCodexBridge().startBrowserLogin();
    await openCodexLoginUrl(result.authUrl);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.codexStartDeviceLogin, async () => {
    const result = await getCodexBridge().startDeviceLogin();
    await openCodexLoginUrl(result.verificationUrl);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.codexListModels, async () => getCodexBridge().listModels());
  ipcMain.handle(IPC_CHANNELS.codexReadRateLimits, async () => getCodexBridge().readRateLimits());
  ipcMain.handle(IPC_CHANNELS.codexGenerateProjectQuestion, async (
    _event,
    input: {requestId: string; title: string},
  ): Promise<ProjectQuestionGenerationResult> => {
    const requestId = input.requestId?.trim();
    const title = input.title?.trim();
    if (!requestId || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) throw new Error('Mã lượt tạo câu hỏi không hợp lệ.');
    if (!title || title.length < 3 || title.length > 160) throw new Error('Tên dự án phải có từ 3 đến 160 ký tự.');
    if (projectQuestionGenerationsByRequest.has(requestId)) throw new Error('Lượt tạo câu hỏi này đang chạy.');

    const bridge = getCodexBridge();
    broadcastCodexEvent({type: 'projectQuestionGeneration', requestId, phase: 'CONNECTING'});
    const account = await bridge.readAccount();
    if (!account.signedIn) throw new Error('Hãy đăng nhập Codex trong Không gian AI trước khi tạo câu hỏi.');
    await bridge.assertModelAvailable(PROJECT_QUESTION_MODEL, PROJECT_QUESTION_EFFORT);
    const thread = await bridge.startThread({cwd: getRepositoryRoot(), model: PROJECT_QUESTION_MODEL});

    let resolveCompletion!: (result: ProjectQuestionGenerationResult) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<ProjectQuestionGenerationResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const pending: PendingProjectQuestionGeneration = {
      requestId,
      threadId: thread.threadId,
      turnId: null,
      openedSources: new Map(),
      cancelRequested: false,
      timer: setTimeout(() => {
        const active = projectQuestionGenerationsByRequest.get(requestId);
        if (!active) return;
        broadcastProjectQuestionProgress(active, 'FAILED', {message: 'Lượt tạo câu hỏi đã quá thời gian 3 phút.'});
        cleanupProjectQuestionGeneration(active);
        active.reject(new Error('Lượt tạo câu hỏi đã quá thời gian 3 phút. Hãy thử lại.'));
        if (active.turnId) void bridge.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
      }, 180_000),
      resolve: resolveCompletion,
      reject: rejectCompletion,
    };
    projectQuestionGenerationsByRequest.set(requestId, pending);
    projectQuestionGenerationsByThread.set(thread.threadId, pending);
    broadcastProjectQuestionProgress(pending, 'RESEARCHING');
    try {
      const turn = await bridge.startTurn({
        threadId: thread.threadId,
        text: buildProjectQuestionPrompt(title),
        cwd: getRepositoryRoot(),
        model: PROJECT_QUESTION_MODEL,
        effort: PROJECT_QUESTION_EFFORT,
        outputSchema: PROJECT_QUESTION_OUTPUT_SCHEMA,
      });
      pending.turnId = turn.turnId;
      projectQuestionGenerationsByTurn.set(turn.turnId, pending);
      if (pending.cancelRequested) await bridge.interruptTurn(thread.threadId, turn.turnId);
      const earlyCompletion = pendingTurnCompletions.get(turn.turnId);
      if (earlyCompletion) trackProjectQuestionActivity(earlyCompletion);
      return await completion;
    } catch (error) {
      if (projectQuestionGenerationsByRequest.has(requestId)) {
        const message = error instanceof Error ? error.message : 'Không thể bắt đầu tạo câu hỏi dẫn dắt.';
        broadcastProjectQuestionProgress(pending, pending.cancelRequested ? 'CANCELLED' : 'FAILED', {message});
        cleanupProjectQuestionGeneration(pending);
      }
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.codexTranslateProjectQuestion, async (
    _event,
    input: {requestId: string; question: string},
  ): Promise<{translation: string}> => {
    const requestId = input.requestId?.trim();
    const question = input.question?.trim();
    if (!requestId || !/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) throw new Error('Mã lượt dịch câu hỏi không hợp lệ.');
    if (!question || question.length > 240) throw new Error('Câu hỏi tiếng Anh phải có từ 1 đến 240 ký tự.');
    if (projectQuestionTranslationsByRequest.has(requestId)) throw new Error('Lượt dịch câu hỏi này đang chạy.');

    const bridge = getCodexBridge();
    const account = await bridge.readAccount();
    if (!account.signedIn) throw new Error('Hãy đăng nhập Codex trong Không gian AI trước khi dịch câu hỏi.');
    await bridge.assertModelAvailable(PROJECT_QUESTION_MODEL, PROJECT_QUESTION_EFFORT);
    const thread = await bridge.startThread({cwd: getRepositoryRoot(), model: PROJECT_QUESTION_MODEL});

    let resolveCompletion!: (translation: string) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const pending: PendingProjectQuestionTranslation = {
      requestId,
      threadId: thread.threadId,
      turnId: null,
      timer: setTimeout(() => {
        const active = projectQuestionTranslationsByRequest.get(requestId);
        if (!active) return;
        cleanupProjectQuestionTranslation(active);
        active.reject(new Error('Lượt dịch câu hỏi đã quá thời gian 60 giây. Hãy thử lại.'));
        if (active.turnId) void bridge.interruptTurn(active.threadId, active.turnId).catch(() => undefined);
      }, 60_000),
      resolve: resolveCompletion,
      reject: rejectCompletion,
    };
    projectQuestionTranslationsByRequest.set(requestId, pending);
    projectQuestionTranslationsByThread.set(thread.threadId, pending);
    try {
      const turn = await bridge.startTurn({
        threadId: thread.threadId,
        text: buildProjectQuestionTranslationPrompt(question),
        cwd: getRepositoryRoot(),
        model: PROJECT_QUESTION_MODEL,
        effort: PROJECT_QUESTION_EFFORT,
        outputSchema: PROJECT_QUESTION_TRANSLATION_OUTPUT_SCHEMA,
      });
      pending.turnId = turn.turnId;
      projectQuestionTranslationsByTurn.set(turn.turnId, pending);
      const earlyCompletion = pendingTurnCompletions.get(turn.turnId);
      if (earlyCompletion) trackProjectQuestionTranslation(earlyCompletion);
      return {translation: await completion};
    } catch (error) {
      if (projectQuestionTranslationsByRequest.has(requestId)) cleanupProjectQuestionTranslation(pending);
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.codexInterruptProjectQuestion, async (_event, requestId: string) => {
    const pending = projectQuestionGenerationsByRequest.get(requestId);
    if (!pending) return {interrupted: false};
    pending.cancelRequested = true;
    if (pending.turnId) await getCodexBridge().interruptTurn(pending.threadId, pending.turnId);
    return {interrupted: true};
  });
  ipcMain.handle(IPC_CHANNELS.codexStartOrResumeThread, async (_event, projectId: string) => {
    const store = getProjectStore();
    const project = store.getProject(projectId).project;
    const settings = store.getAiProjectSettings(projectId);
    const bridge = getCodexBridge();
    await bridge.assertModelAvailable(settings.desiredModel, settings.desiredEffort);
    const result = settings.threadId
      ? await bridge.resumeThread(settings.threadId)
      : await bridge.startThread({cwd: project.rootPath, model: settings.desiredModel});
    store.updateAiProjectSettings(projectId, {
      threadId: result.threadId,
      lastConnectionStatus: 'READY',
    });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.codexStartTurn, async (
    _event,
    projectId: string,
    input: {text: string; stage: AiStage},
  ) => {
    const store = getProjectStore();
    const project = store.getProject(projectId).project;
    let settings = store.getAiProjectSettings(projectId);
    const bridge = getCodexBridge();
    const run = store.createAiRun(projectId, {stage: input.stage, prompt: input.text});
    try {
      await bridge.assertModelAvailable(settings.desiredModel, settings.desiredEffort);
      if (!settings.threadId) {
        const thread = await bridge.startThread({cwd: project.rootPath, model: settings.desiredModel});
        settings = store.updateAiProjectSettings(projectId, {threadId: thread.threadId});
      } else {
        await bridge.resumeThread(settings.threadId);
      }
      const result = await bridge.startTurn({
        threadId: settings.threadId!,
        text: input.text,
        cwd: project.rootPath,
        model: settings.desiredModel || DEFAULT_CODEX_MODEL,
        effort: settings.desiredEffort || DEFAULT_CODEX_EFFORT,
      });
      activeAiRuns.set(result.turnId, {projectId, runId: run.id});
      store.updateAiRun(projectId, run.id, {
        status: 'RUNNING',
        actualModel: settings.desiredModel,
        actualEffort: settings.desiredEffort,
        threadId: settings.threadId,
        turnId: result.turnId,
        startedAt: new Date().toISOString(),
      });
      store.updateAiProjectSettings(projectId, {
        lastStage: input.stage,
        lastTurnId: result.turnId,
        lastConnectionStatus: 'READY',
      });
      const earlyCompletion = pendingTurnCompletions.get(result.turnId);
      if (earlyCompletion) {
        pendingTurnCompletions.delete(result.turnId);
        completeTrackedAiRun(earlyCompletion);
      }
      return {...result, threadId: settings.threadId, runId: run.id};
    } catch (error) {
      store.updateAiRun(projectId, run.id, {
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        error: codexRunError(error),
      });
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.codexRunEditorialStage, async (
    _event,
    projectId: string,
    input: {stage: AiStage; instruction: string},
  ) => {
    const store = getProjectStore();
    const project = store.getProject(projectId).project;
    const review = store.getReviewWorkspace(projectId);
    const requiredPrevious: Partial<Record<AiStage, ApprovalGate>> = {
      THESIS: 'TOPIC', OUTLINE: 'THESIS', SCRIPT: 'THESIS', STORYBOARD: 'SCRIPT',
    };
    const requiredGate = requiredPrevious[input.stage];
    if (requiredGate && review.approvals.find(({gate}) => gate === requiredGate)?.status !== 'APPROVED') {
      throw new Error(`${requiredGate} must be approved before running ${input.stage.toLowerCase()}.`);
    }
    let settings = store.getAiProjectSettings(projectId);
    const bridge = getCodexBridge();
    const prompt = input.instruction.trim();
    if (!prompt) throw new Error('Stage instruction cannot be empty.');
    const run = store.createAiRun(projectId, {stage: input.stage, prompt});
    try {
      await bridge.assertModelAvailable(settings.desiredModel, settings.desiredEffort);
      const skill = (await bridge.listSkills(project.rootPath, true)).find(({name}) => name === 'narra');
      if (!skill) throw new Error('Narra skill is not available to Codex for this project.');
      if (!settings.threadId) {
        const thread = await bridge.startThread({cwd: project.rootPath, model: settings.desiredModel});
        settings = store.updateAiProjectSettings(projectId, {threadId: thread.threadId});
      } else {
        await bridge.resumeThread(settings.threadId);
      }
      const stageName = input.stage.toLowerCase();
      const structuredPrompt = [
        `$narra stage=${stageName} project=${project.rootPath}`,
        `Work only on project ${projectId}. The owning AI run ID is ${run.id}.`,
        'Return only the final JSON object required by the supplied output schema. Do not write or modify project files.',
        prompt,
      ].join('\n\n');
      const result = await bridge.startTurn({
        threadId: settings.threadId!, text: structuredPrompt, cwd: project.rootPath,
        model: settings.desiredModel || DEFAULT_CODEX_MODEL,
        effort: settings.desiredEffort || DEFAULT_CODEX_EFFORT,
        outputSchema: getAiStageJsonSchema(input.stage), skill,
      });
      activeAiRuns.set(result.turnId, {projectId, runId: run.id, structuredStage: input.stage});
      store.updateAiRun(projectId, run.id, {
        status: 'RUNNING', actualModel: settings.desiredModel, actualEffort: settings.desiredEffort,
        threadId: settings.threadId, turnId: result.turnId, startedAt: new Date().toISOString(),
      });
      store.updateAiProjectSettings(projectId, {
        lastStage: input.stage, lastTurnId: result.turnId, lastConnectionStatus: 'READY',
      });
      const earlyCompletion = pendingTurnCompletions.get(result.turnId);
      if (earlyCompletion) {
        pendingTurnCompletions.delete(result.turnId);
        completeTrackedAiRun(earlyCompletion);
      }
      return {...result, threadId: settings.threadId, runId: run.id};
    } catch (error) {
      store.updateAiRun(projectId, run.id, {status: 'FAILED', completedAt: new Date().toISOString(), error: codexRunError(error)});
      throw error;
    }
  });
  ipcMain.handle(IPC_CHANNELS.codexInterruptTurn, async (_event, projectId: string) => {
    const settings = getProjectStore().getAiProjectSettings(projectId);
    if (!settings.threadId || !settings.lastTurnId) throw new Error('Project does not have an active Codex turn.');
    await getCodexBridge().interruptTurn(settings.threadId, settings.lastTurnId);
    return {interrupted: true};
  });
  ipcMain.handle(
    IPC_CHANNELS.codexRespondServerRequest,
    async (_event, id: JsonRpcId, result: unknown) => {
      if (!pendingCodexRequests.has(id)) throw new Error('Codex request is no longer pending.');
      pendingCodexRequests.delete(id);
      await getCodexBridge().respondToServerRequest(id, result);
      return {accepted: true};
    },
  );
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, urlValue: string) => {
    const url = new URL(urlValue);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links can be opened.');
    await shell.openExternal(url.toString());
    return {opened: true};
  });
};

const registerProjectHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.listProjects, () => getProjectStore().listProjects());
  ipcMain.handle(IPC_CHANNELS.createProject, (_event, input: CreateProjectInput) =>
    getProjectStore().createProject(input),
  );
  ipcMain.handle(IPC_CHANNELS.getProject, (_event, projectId: string) =>
    getProjectStore().getProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.duplicateProject, (_event, projectId: string) =>
    getProjectStore().duplicateProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.archiveProject, (_event, projectId: string) =>
    getProjectStore().archiveProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.refreshProject, (_event, projectId: string) =>
    getProjectStore().refreshProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndOpenProject, async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Mở thư mục dự án Narra',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().openProjectDirectory(selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.getStoryboard, (_event, projectId: string) =>
    getProjectStore().getStoryboardWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportStoryboard, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Nhập scenes.json và shots.json',
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Narra JSON artifacts', extensions: ['json']}],
    });
    if (selection.canceled) return null;
    const scenesPath = selection.filePaths.find((filePath) => path.basename(filePath).toLowerCase() === 'scenes.json');
    const shotsPath = selection.filePaths.find((filePath) => path.basename(filePath).toLowerCase() === 'shots.json');
    if (!scenesPath || !shotsPath) throw new Error('Select both scenes.json and shots.json in the same import action.');
    return getProjectStore().importStoryboard(projectId, scenesPath, shotsPath);
  });
  ipcMain.handle(
    IPC_CHANNELS.createAssetTask,
    (_event, projectId: string, input: CreateAssetTaskInput) => getProjectStore().createAssetTask(projectId, input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateAssetStatus,
    (_event, projectId: string, assetId: string, input: AssetStatusInput) =>
      getProjectStore().updateAssetStatus(projectId, assetId, input),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportAssetMedia, async (_event, projectId: string, assetId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Nhập media cho tài nguyên',
      properties: ['openFile'],
      filters: [{name: 'Image and video', extensions: ['png', 'jpg', 'jpeg', 'svg', 'mp4', 'mov', 'webm', 'mkv']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importAssetMedia(projectId, assetId, selection.filePaths[0]);
  });
  ipcMain.handle(
    IPC_CHANNELS.importAssetMediaPath,
    (_event, projectId: string, assetId: string, sourcePath: string) =>
      getProjectStore().importAssetMedia(projectId, assetId, sourcePath),
  );
  ipcMain.handle(IPC_CHANNELS.getFlowWorkspace, (_event, projectId: string) =>
    getProjectStore().getFlowWorkspace(projectId));
  ipcMain.handle(IPC_CHANNELS.chooseFlowWatchDirectory, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Chọn thư mục tải xuống Google Flow',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().setFlowWatchDirectory(projectId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.scanFlowCandidates, (_event, projectId: string) =>
    getProjectStore().scanFlowCandidates(projectId));
  ipcMain.handle(IPC_CHANNELS.prepareFlowAssetTask, (_event, projectId: string, input: PrepareFlowTaskInput) =>
    getProjectStore().prepareFlowAssetTask(projectId, input));
  ipcMain.handle(IPC_CHANNELS.selectFlowCandidate, (_event, projectId: string, candidateId: string, assetId: string) =>
    getProjectStore().selectFlowCandidate(projectId, candidateId, assetId));
  ipcMain.handle(IPC_CHANNELS.rejectFlowCandidate, (_event, projectId: string, candidateId: string) =>
    getProjectStore().rejectFlowCandidate(projectId, candidateId));
  ipcMain.handle(IPC_CHANNELS.copyText, (_event, value: string) => {
    if (!value.trim()) throw new Error('Cannot copy empty text.');
    clipboard.writeText(value);
    return {copied: true};
  });
  ipcMain.handle(IPC_CHANNELS.exportStoryboardRenderInput, (_event, projectId: string) =>
    getProjectStore().exportStoryboardRenderInput(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.getVoiceWorkspace, (_event, projectId: string) =>
    getProjectStore().getVoiceWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.syncNarrationSegments, (_event, projectId: string) =>
    getProjectStore().syncNarrationSegments(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportNarrationAudio, async (_event, projectId: string, segmentId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Nhập âm thanh cho đoạn lời đọc',
      properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importNarrationAudio(projectId, segmentId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.generateNarrationSegment, (_event, projectId: string, input: GenerateNarrationInput) =>
    getProjectStore().generateNarrationSegment(projectId, input));
  ipcMain.handle(IPC_CHANNELS.generateMissingNarration, (_event, projectId: string, input: GenerateNarrationBatchInput) =>
    getProjectStore().generateMissingNarration(projectId, input));
  ipcMain.handle(IPC_CHANNELS.chooseAndImportCaptions, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Nhập phụ đề hoặc mốc thời gian theo từ',
      properties: ['openFile'],
      filters: [{name: 'Captions and timestamps', extensions: ['srt', 'vtt', 'json']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importCaptions(projectId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.fitTimelineToNarration, (_event, projectId: string) =>
    getProjectStore().fitTimelineToNarration(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.getTimelineWorkspace, (_event, projectId: string) =>
    getProjectStore().getTimelineWorkspace(projectId));
  ipcMain.handle(IPC_CHANNELS.generateCaptionsFromNarration, (_event, projectId: string) =>
    getProjectStore().generateCaptionsFromNarration(projectId));
  ipcMain.handle(IPC_CHANNELS.updateCaptionCue, (_event, projectId: string, captionId: string, input: UpdateCaptionCueInput) =>
    getProjectStore().updateCaptionCue(projectId, captionId, input));
  ipcMain.handle(IPC_CHANNELS.updateShotAudio, (_event, projectId: string, shotId: string, input: UpdateShotAudioInput) =>
    getProjectStore().updateShotAudio(projectId, shotId, input));
  ipcMain.handle(IPC_CHANNELS.chooseAndImportTimelineAudio, async (_event, projectId: string, role: 'MUSIC' | 'SFX') => {
    const selection = await dialog.showOpenDialog({
      title: `Nhập ${role === 'MUSIC' ? 'nhạc' : 'hiệu ứng âm thanh'}`,
      properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importTimelineAudio(projectId, role, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.getEditorialWorkspace, (_event, projectId: string) =>
    getProjectStore().getEditorialWorkspace(projectId),
  );
  ipcMain.handle(
    IPC_CHANNELS.saveEditorialDocument,
    (_event, projectId: string, document: EditorialDocument, content: string) =>
      getProjectStore().saveEditorialDocument(projectId, document, content),
  );
  ipcMain.handle(IPC_CHANNELS.selectTopicCandidate, (_event, projectId: string, candidateId: string, input: SelectTopicInput) =>
    getProjectStore().selectTopicCandidate(projectId, candidateId, input));
  ipcMain.handle(IPC_CHANNELS.selectThesisCandidate, (_event, projectId: string, candidateId: string, statement: string) =>
    getProjectStore().selectThesisCandidate(projectId, candidateId, statement));
  ipcMain.handle(IPC_CHANNELS.saveOutline, (_event, projectId: string, input: SaveOutlineInput) =>
    getProjectStore().saveOutline(projectId, input));
  ipcMain.handle(IPC_CHANNELS.getReviewWorkspace, (_event, projectId: string) =>
    getProjectStore().getReviewWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.approveGate, (_event, projectId: string, gate: ApprovalGate, note: string) =>
    getProjectStore().approveGate(projectId, gate, note),
  );
  ipcMain.handle(IPC_CHANNELS.revokeGate, (_event, projectId: string, gate: ApprovalGate, note: string) =>
    getProjectStore().revokeGate(projectId, gate, note),
  );
  ipcMain.handle(IPC_CHANNELS.queueRender, (_event, projectId: string, target: RenderTarget) => {
    const result = getProjectStore().queueRender(projectId, target);
    void jobRunner?.runNext();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.cancelJob, (_event, projectId: string, jobId: string) => {
    jobRunner?.cancel(projectId, jobId);
    return getProjectStore().getReviewWorkspace(projectId);
  });
  ipcMain.handle(IPC_CHANNELS.retryJob, (_event, projectId: string, jobId: string) => {
    const result = getProjectStore().retryJob(projectId, jobId);
    void jobRunner?.runNext();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.chooseAndAttachRenderOutput, async (_event, projectId: string, jobId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Gắn video đã kết xuất',
      properties: ['openFile'],
      filters: [{name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().attachRenderOutput(projectId, jobId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.chooseProjectBackupDirectory, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({title: 'Chọn nơi lưu bản sao dự án', properties: ['openDirectory', 'createDirectory']});
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().createProjectBackup(projectId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.getSystemDiagnostics, async (): Promise<SystemDiagnostics> => {
    const checks: SystemDiagnostics['checks'] = [];
    const repositoryRoot = getRepositoryRoot();
    try {
      accessSync(getProjectStore().workspaceRoot, constants.R_OK | constants.W_OK);
      checks.push({id: 'workspace', label: 'Không gian làm việc trên máy', status: 'PASS', detail: `${getProjectStore().listProjects().length} dự án đã lập chỉ mục; thư mục có thể đọc và ghi.`});
    } catch (error) {
      checks.push({id: 'workspace', label: 'Không gian làm việc trên máy', status: 'FAIL', detail: error instanceof Error ? error.message : String(error), remediation: 'Chọn một thư mục không gian Narra có quyền ghi.'});
    }
    try {
      const account = await getCodexBridge().readAccount();
      const models = await getCodexBridge().listModels();
      const hasModel = models.some(({id}) => id === 'gpt-5.6-sol');
      checks.push({
        id: 'codex', label: 'Codex App Server', status: account.signedIn && hasModel ? 'PASS' : 'WARNING',
        detail: account.signedIn ? `Đã đăng nhập; GPT-5.6 Sol ${hasModel ? 'khả dụng' : 'không xuất hiện trong danh sách model'}.` : 'Codex khả dụng nhưng chưa đăng nhập.',
        ...(account.signedIn && hasModel ? {} : {remediation: 'Mở Không gian AI, hoàn tất đăng nhập ChatGPT rồi làm mới chẩn đoán.'}),
      });
    } catch (error) {
      checks.push({id: 'codex', label: 'Codex App Server', status: 'FAIL', detail: error instanceof Error ? error.message : String(error), remediation: 'Kiểm tra cài đặt Codex CLI rồi khởi động lại Narra Studio.'});
    }
    const voice = getProjectStore().getVoiceRuntimeStatus();
    checks.push({
      id: 'voice', label: 'Bộ máy giọng đọc Kokoro', status: voice.available ? 'PASS' : 'WARNING',
      detail: voice.available ? `Kokoro ${voice.modelVersion} đã sẵn sàng.` : `Còn thiếu: ${voice.missing.join(', ') || 'các tệp runtime'}.`,
      ...(voice.available ? {} : {remediation: voice.setupCommand}),
    });
    const remotionRoot = path.join(repositoryRoot, 'remotion');
    const remotionCli = path.join(remotionRoot, 'node_modules/@remotion/cli/remotion-cli.js');
    if (!existsSync(remotionCli)) {
      checks.push({id: 'remotion', label: 'Bộ máy Remotion', status: 'FAIL', detail: `Không tìm thấy CLI trong ${app.isPackaged ? 'tài nguyên đã đóng gói' : 'repository'}.`, remediation: 'Đóng gói lại ứng dụng desktop kèm tài nguyên runtime Narra.'});
    } else {
      const remotion = await runVersionCheck(process.execPath, [remotionCli, 'versions'], remotionRoot);
      checks.push({id: 'remotion', label: 'Bộ máy Remotion', status: remotion.ok ? 'PASS' : 'FAIL', detail: remotion.detail, ...(remotion.ok ? {} : {remediation: 'Chạy pnpm install rồi build lại ứng dụng.'})});
      const ffmpeg = await runVersionCheck(process.execPath, [remotionCli, 'ffmpeg', '-version'], remotionRoot);
      checks.push({id: 'ffmpeg', label: 'Bộ máy FFmpeg', status: ffmpeg.ok ? 'PASS' : 'FAIL', detail: ffmpeg.detail, ...(ffmpeg.ok ? {} : {remediation: 'Sửa bộ máy FFmpeg đi kèm Remotion.'})});
    }
    return {checkedAt: new Date().toISOString(), appVersion: app.getVersion(), packaged: app.isPackaged, platform: `${process.platform} ${process.arch}`, checks};
  });
};

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.NARRA_DEV_SERVER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
    return window;
  }

  await window.loadFile(path.join(currentDirectory, '../dist/index.html'));
  return window;
};

const sendMenuAction = (action: 'NEW_PROJECT' | 'OPEN_PROJECT' | 'REFRESH_PROJECT'): void => {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC_CHANNELS.menuAction, action);
};

const installApplicationMenu = (): void => {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Tệp',
      submenu: [
        {label: 'Tạo dự án mới…', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('NEW_PROJECT')},
        {label: 'Mở thư mục dự án…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('OPEN_PROJECT')},
        {type: 'separator'},
        {label: 'Làm mới dự án', accelerator: 'F5', click: () => sendMenuAction('REFRESH_PROJECT')},
        {type: 'separator'},
        {label: 'Thoát', role: 'quit'},
      ],
    },
    {
      label: 'Chỉnh sửa',
      submenu: [
        {label: 'Hoàn tác', role: 'undo'},
        {label: 'Làm lại', role: 'redo'},
        {type: 'separator'},
        {label: 'Cắt', role: 'cut'},
        {label: 'Sao chép', role: 'copy'},
        {label: 'Dán', role: 'paste'},
        {label: 'Chọn tất cả', role: 'selectAll'},
      ],
    },
    {
      label: 'Hiển thị',
      submenu: [
        {label: 'Phóng to', role: 'zoomIn'},
        {label: 'Thu nhỏ', role: 'zoomOut'},
        {label: 'Kích thước mặc định', role: 'resetZoom'},
        {type: 'separator'},
        {label: 'Toàn màn hình', role: 'togglefullscreen'},
      ],
    },
    {
      label: 'Cửa sổ',
      submenu: [
        {label: 'Thu nhỏ cửa sổ', role: 'minimize'},
        {label: 'Đóng cửa sổ', role: 'close'},
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

void app.whenReady().then(async () => {
  installApplicationMenu();
  const storageRoot = getLocalStorageRoot();
  const workspaceRoot =
    process.env.NARRA_WORKSPACE_ROOT ?? path.join(storageRoot, 'projects');
  const databaseRoot =
    process.env.NARRA_DATABASE_ROOT ?? path.join(storageRoot, 'database');
  const repositoryRoot = getRepositoryRoot();
  projectStore = new ProjectStore(workspaceRoot, {
    databaseRoot,
    voiceProvider: new KokoroOnnxProvider({
      repositoryRoot,
      ...(process.env.NARRA_VOICE_RUNTIME_ROOT ? {runtimeRoot: process.env.NARRA_VOICE_RUNTIME_ROOT} : {}),
      ...(process.env.NARRA_VOICE_PYTHON ? {pythonExecutable: process.env.NARRA_VOICE_PYTHON} : {}),
      nodeExecutable: process.execPath,
    }),
  });
  jobRunner = new LocalJobRunner(projectStore, repositoryRoot);
  jobRunner.start();
  registerProjectHandlers();
  registerCodexHandlers();
  protocol.handle('narra-media', (request) => {
    try {
      const url = new URL(request.url);
      const [projectId, assetId] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (!['asset', 'narration', 'flow-candidate'].includes(url.hostname) || !projectId || !assetId) {
        return new Response('Invalid media URL', {status: 400});
      }
      const filePath = url.hostname === 'narration'
        ? getProjectStore().getNarrationFilePath(projectId, assetId)
        : url.hostname === 'flow-candidate'
          ? getProjectStore().getFlowCandidateFilePath(projectId, assetId)
          : getProjectStore().getAssetFilePath(projectId, assetId);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Media not found', {status: 404});
    }
  });
  const mainWindow = await createWindow();

  if (process.env.NARRA_SMOKE_TEST === '1') {
    const result = (await mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const startedAt = Date.now();
        const check = () => {
          const heading = document.querySelector('h1')?.textContent;
          if (heading) {
            Promise.resolve(window.narra?.listProjects())
              .then((projects) => resolve({
                heading,
                apiVersion: window.narra?.version,
                projectCount: Array.isArray(projects) ? projects.length : -1,
              }))
              .catch((error) => resolve({heading, apiVersion: window.narra?.version, apiError: String(error)}));
            return;
          }
          if (Date.now() - startedAt > 5000) {
            resolve({heading, apiVersion: window.narra?.version});
            return;
          }
          setTimeout(check, 50);
        };
        check();
      })
    `)) as {heading?: string; apiVersion?: number; projectCount?: number; apiError?: string};
    if (result.heading !== 'Narra Studio' || result.apiVersion !== 16 || typeof result.projectCount !== 'number' || result.projectCount < 0) {
      throw new Error(`Desktop smoke test received ${JSON.stringify(result)}.`);
    }
    writeFileSync(
      path.join(workspaceRoot, '.desktop-smoke-ok'),
      `renderer=Narra Studio\napiVersion=16\nprojectCount=${result.projectCount}\n`,
      'utf8',
    );
    if (process.env.NARRA_SMOKE_EDITORIAL_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Biên tập')
          ?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 450));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.editorial-stage-tabs button')]
          .find((button) => button.textContent?.trim() === 'Chủ đề')
          ?.click()
      `);
      const editorialResult = (await mainWindow.webContents.executeJavaScript(`({
        hasWorkspace: Boolean(document.querySelector('.editorial-workspace')),
        stageTabCount: document.querySelectorAll('.editorial-stage-tabs button').length,
        topicCardCount: document.querySelectorAll('.topic-card').length,
        selectedTopicCount: document.querySelectorAll('.topic-card.selected').length,
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })`)) as {hasWorkspace: boolean; stageTabCount: number; topicCardCount: number; selectedTopicCount: number; hasOverflow: boolean};
      if (!editorialResult.hasWorkspace || editorialResult.stageTabCount !== 6 || editorialResult.topicCardCount < 2 ||
          editorialResult.selectedTopicCount !== 1 || editorialResult.hasOverflow) {
        throw new Error(`Editorial smoke test received ${JSON.stringify(editorialResult)}.`);
      }
      writeFileSync(path.join(workspaceRoot, '.editorial-smoke-ok'), `${JSON.stringify(editorialResult)}\n`, 'utf8');
    }
    if (process.env.NARRA_SMOKE_FLOW_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Storyboard & tài nguyên')
          ?.click()
      `);
      const flowResult = (await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const startedAt = Date.now();
          const check = () => {
            const panel = document.querySelector('.flow-assistant-panel');
            if (panel || Date.now() - startedAt > 5000) {
              resolve({
                hasPanel: Boolean(panel),
                promptCardCount: document.querySelectorAll('.flow-prompt-grid article').length,
                candidateCount: document.querySelectorAll('.flow-candidate').length,
                hasWatchFolder: Boolean(document.querySelector('.flow-inbox small')?.textContent?.trim()),
                hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              });
              return;
            }
            setTimeout(check, 50);
          };
          check();
        })
      `)) as {hasPanel: boolean; promptCardCount: number; candidateCount: number; hasWatchFolder: boolean; hasOverflow: boolean};
      if (!flowResult.hasPanel || flowResult.promptCardCount !== 2 || flowResult.candidateCount < 1 ||
          !flowResult.hasWatchFolder || flowResult.hasOverflow) {
        throw new Error(`Flow UI smoke test received ${JSON.stringify(flowResult)}.`);
      }
      writeFileSync(path.join(workspaceRoot, '.flow-smoke-ok'), `${JSON.stringify(flowResult)}\n`, 'utf8');
    }
    if (process.env.NARRA_SMOKE_VOICE_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Lời đọc & phụ đề')
          ?.click()
      `);
      const voiceResult = (await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const startedAt = Date.now();
          const check = () => {
            const workspace = document.querySelector('.voice-workspace');
            const waveform = document.querySelector('.audio-waveform');
            if ((workspace && waveform) || Date.now() - startedAt > 5000) {
              resolve({
                hasWorkspace: Boolean(workspace),
                hasRuntimeReady: document.querySelector('.voice-runtime-card.ready') !== null,
                hasGenerationControls: document.querySelector('.voice-generation-card') !== null,
                hasWaveform: Boolean(waveform),
                hasProvenance: document.querySelector('.voice-provenance') !== null,
                hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              });
              return;
            }
            setTimeout(check, 50);
          };
          check();
        })
      `)) as {hasWorkspace: boolean; hasRuntimeReady: boolean; hasGenerationControls: boolean; hasWaveform: boolean; hasProvenance: boolean; hasOverflow: boolean};
      if (!voiceResult.hasWorkspace || !voiceResult.hasRuntimeReady || !voiceResult.hasGenerationControls ||
          !voiceResult.hasWaveform || !voiceResult.hasProvenance || voiceResult.hasOverflow) {
        throw new Error(`Voice UI smoke test received ${JSON.stringify(voiceResult)}.`);
      }
      writeFileSync(path.join(workspaceRoot, '.voice-smoke-ok'), `${JSON.stringify(voiceResult)}\n`, 'utf8');
      if (process.env.NARRA_SMOKE_VOICE_GENERATE === '1') {
        const generationResult = (await mainWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const versionBefore = document.querySelector('.audio-import-row strong')?.textContent?.trim() ?? '';
            const button = document.querySelector('.voice-generation-actions .primary');
            if (!button || button.disabled) return resolve({state: 'not-ready', versionBefore});
            button.click();
            const startedAt = Date.now();
            const check = () => {
              const message = document.querySelector('.success-notice')?.textContent?.trim() ?? '';
              const error = document.querySelector('.error-notice')?.textContent?.trim() ?? '';
              const versionAfter = document.querySelector('.audio-import-row strong')?.textContent?.trim() ?? '';
              if (error || (message.includes('Đã tạo') && versionAfter !== versionBefore)) {
                resolve({state: error ? 'failed' : 'completed', versionBefore, versionAfter, message, error});
                return;
              }
              if (Date.now() - startedAt > 180000) return resolve({state: 'timeout', versionBefore, versionAfter, message, error});
              setTimeout(check, 100);
            };
            check();
          })
        `)) as {state: string; versionBefore: string; versionAfter?: string; message?: string; error?: string};
        if (generationResult.state !== 'completed') throw new Error(`Voice generation smoke received ${JSON.stringify(generationResult)}.`);
        writeFileSync(path.join(workspaceRoot, '.voice-generation-smoke-ok'), `${JSON.stringify(generationResult)}\n`, 'utf8');
      }
    }
    if (process.env.NARRA_SMOKE_TIMELINE_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Dòng thời gian')
          ?.click()
      `);
      await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const startedAt = Date.now();
          const prepare = () => {
            const workspace = document.querySelector('.timeline-workspace');
            if (!workspace && Date.now() - startedAt <= 5000) return setTimeout(prepare, 50);
            if (document.querySelectorAll('.caption-cue-list button').length > 0) return resolve(true);
            const generate = [...document.querySelectorAll('.timeline-toolbar button')]
              .find((button) => button.textContent?.includes('Tạo cue'));
            if (!generate || generate.disabled) return resolve(false);
            generate.click();
            const waitForCues = () => {
              if (document.querySelectorAll('.caption-cue-list button').length > 0) return resolve(true);
              if (Date.now() - startedAt > 10000) return resolve(false);
              setTimeout(waitForCues, 50);
            };
            waitForCues();
          };
          prepare();
        })
      `);
      const timelineResult = (await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const startedAt = Date.now();
          const check = () => {
            const workspace = document.querySelector('.timeline-workspace');
            if (workspace || Date.now() - startedAt > 5000) {
              resolve({
                hasWorkspace: Boolean(workspace),
                cueCount: document.querySelectorAll('.caption-cue-list button').length,
                shotAudioCount: document.querySelectorAll('.shot-audio-list article').length,
                hasPreflight: Boolean(document.querySelector('.preflight-banner')),
                hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              });
              return;
            }
            setTimeout(check, 50);
          };
          check();
        })
      `)) as {hasWorkspace: boolean; cueCount: number; shotAudioCount: number; hasPreflight: boolean; hasOverflow: boolean};
      if (!timelineResult.hasWorkspace || timelineResult.cueCount < 1 || timelineResult.shotAudioCount < 1 ||
          !timelineResult.hasPreflight || timelineResult.hasOverflow) throw new Error(`Timeline UI smoke test received ${JSON.stringify(timelineResult)}.`);
      writeFileSync(path.join(workspaceRoot, '.timeline-smoke-ok'), `${JSON.stringify(timelineResult)}\n`, 'utf8');
    }
    if (process.env.NARRA_SMOKE_SYSTEM_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Hệ thống')
          ?.click()
      `);
      const systemResult = (await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const startedAt = Date.now();
          const check = () => {
            const workspace = document.querySelector('.system-workspace');
            const cards = document.querySelectorAll('.diagnostic-list article');
            const isBusy = workspace?.getAttribute('aria-busy') === 'true';
            if ((workspace && cards.length >= 5 && !isBusy) || Date.now() - startedAt > 30000) {
              resolve({
                hasWorkspace: Boolean(workspace),
                diagnosticCount: cards.length,
                hasBackupAction: Boolean(document.querySelector('.backup-card button')),
                isBusy,
                hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              });
              return;
            }
            setTimeout(check, 100);
          };
          check();
        })
      `)) as {hasWorkspace: boolean; diagnosticCount: number; hasBackupAction: boolean; isBusy: boolean; hasOverflow: boolean};
      if (!systemResult.hasWorkspace || systemResult.diagnosticCount < 5 || !systemResult.hasBackupAction ||
          systemResult.isBusy || systemResult.hasOverflow) throw new Error(`System UI smoke test received ${JSON.stringify(systemResult)}.`);
      writeFileSync(path.join(workspaceRoot, '.system-smoke-ok'), `${JSON.stringify(systemResult)}\n`, 'utf8');
    }
    if (process.env.NARRA_SMOKE_SCREENSHOT) {
      if (process.env.NARRA_SMOKE_OPEN_FIRST_PROJECT === '1') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (process.env.NARRA_SMOKE_WORKSPACE_TAB) {
        const translatedTabs: Record<string, string> = {
          Overview: 'Tổng quan',
          'AI workspace': 'Không gian AI',
          Editorial: 'Biên tập',
          'Storyboard & assets': 'Storyboard & tài nguyên',
          'Voice & captions': 'Lời đọc & phụ đề',
          Timeline: 'Dòng thời gian',
          'Review & render': 'Duyệt & kết xuất',
          System: 'Hệ thống',
        };
        const tabLabel = JSON.stringify(translatedTabs[process.env.NARRA_SMOKE_WORKSPACE_TAB] ?? process.env.NARRA_SMOKE_WORKSPACE_TAB);
        await mainWindow.webContents.executeJavaScript(`
          [...document.querySelectorAll('.workspace-tabs button')]
            .find((button) => button.textContent?.trim() === ${tabLabel})
            ?.click()
        `);
      }
      if (process.env.NARRA_SMOKE_AI_RUN === '1') {
        const aiResult = await mainWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const startedAt = Date.now();
            const startWhenReady = () => {
              const button = document.querySelector('.run-button');
              if (button && !button.disabled) {
                button.click();
                waitForCompletion();
                return;
              }
              if (Date.now() - startedAt > 30000) {
                resolve({state: 'not-ready'});
                return;
              }
              setTimeout(startWhenReady, 100);
            };
            const waitForCompletion = () => {
              const state = document.querySelector('.run-state')?.textContent?.trim();
              if (state === 'Hoàn thành' || state === 'Thất bại' || state === 'Đã dừng') {
                resolve({state, responseLength: document.querySelector('.agent-response p')?.textContent?.length ?? 0});
                return;
              }
              if (Date.now() - startedAt > 150000) {
                resolve({state: state ?? 'timeout'});
                return;
              }
              setTimeout(waitForCompletion, 150);
            };
            startWhenReady();
          })
        `) as {state: string; responseLength?: number};
        if (aiResult.state !== 'Hoàn thành' || !aiResult.responseLength) {
          throw new Error(`AI workspace smoke received ${JSON.stringify(aiResult)}.`);
        }
      } else if (process.env.NARRA_SMOKE_WORKSPACE_TAB === 'AI workspace' || process.env.NARRA_SMOKE_WORKSPACE_TAB === 'Không gian AI') {
        const aiReady = await mainWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const startedAt = Date.now();
            const check = () => {
              if (document.querySelector('.ai-layout')) return resolve(true);
              if (Date.now() - startedAt > 30000) return resolve(false);
              setTimeout(check, 100);
            };
            check();
          })
        `) as boolean;
        if (!aiReady) throw new Error('AI workspace did not finish loading for smoke capture.');
      }
      await new Promise((resolve) => setTimeout(resolve, process.env.NARRA_SMOKE_WORKSPACE_TAB === 'AI workspace' || process.env.NARRA_SMOKE_WORKSPACE_TAB === 'Không gian AI' ? 1500 : 600));
      await mainWindow.webContents.executeJavaScript('window.scrollTo({top: 0, behavior: "instant"})');
      const screenshot = await mainWindow.webContents.capturePage();
      writeFileSync(process.env.NARRA_SMOKE_SCREENSHOT, screenshot.toPNG());
    }
    console.log('NARRA_DESKTOP_SMOKE_OK');
    await new Promise((resolve) => setTimeout(resolve, 100));
    jobRunner?.stop();
    jobRunner = null;
    projectStore.close();
    projectStore = null;
    codexBridge?.close();
    codexBridge = null;
    app.exit(0);
    return;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('NARRA_DESKTOP_STARTUP_FAILED', error);
  if (process.env.NARRA_SMOKE_TEST === '1' && process.env.NARRA_WORKSPACE_ROOT) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    writeFileSync(path.join(process.env.NARRA_WORKSPACE_ROOT, '.desktop-smoke-failed'), message, 'utf8');
  }
  jobRunner?.stop();
  jobRunner = null;
  projectStore?.close();
  projectStore = null;
  codexBridge?.close();
  codexBridge = null;
  app.exit(1);
});

app.on('before-quit', () => {
  jobRunner?.stop();
  jobRunner = null;
  projectStore?.close();
  projectStore = null;
  codexBridge?.close();
  codexBridge = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
