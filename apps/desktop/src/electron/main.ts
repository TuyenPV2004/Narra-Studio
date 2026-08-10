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
} from '@narra/project-store';
import {getAiStageJsonSchema, type AiReasoningEffort, type AiStage} from '@narra/contracts';
import {app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell} from 'electron';
import {writeFileSync} from 'node:fs';
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

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let projectStore: ProjectStore | null = null;
let jobRunner: LocalJobRunner | null = null;
let codexBridge: CodexBridge | null = null;
const activeAiRuns = new Map<string, {projectId: string; runId: string; structuredStage?: AiStage}>();
const pendingCodexRequests = new Map<JsonRpcId, string>();
const pendingTurnCompletions = new Map<string, CodexBridgeNotification>();
const completedAgentMessages = new Map<string, string>();

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
      title: 'Open Narra project folder',
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
      title: 'Import scenes.json and shots.json',
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
      title: 'Import asset media',
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
      title: 'Choose Google Flow download folder',
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
      title: 'Import narration segment audio',
      properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importNarrationAudio(projectId, segmentId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.chooseAndImportCaptions, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import captions or word timestamps',
      properties: ['openFile'],
      filters: [{name: 'Captions and timestamps', extensions: ['srt', 'vtt', 'json']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importCaptions(projectId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.fitTimelineToNarration, (_event, projectId: string) =>
    getProjectStore().fitTimelineToNarration(projectId),
  );
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
      title: 'Attach completed render output',
      properties: ['openFile'],
      filters: [{name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().attachRenderOutput(projectId, jobId, selection.filePaths[0]);
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

void app.whenReady().then(async () => {
  const workspaceRoot =
    process.env.NARRA_WORKSPACE_ROOT ?? path.join(app.getPath('documents'), 'Narra Studio', 'projects');
  projectStore = new ProjectStore(workspaceRoot);
  jobRunner = new LocalJobRunner(projectStore, path.resolve(currentDirectory, '../../..'));
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
    if (result.heading !== 'Narra Studio' || result.apiVersion !== 10 || typeof result.projectCount !== 'number' || result.projectCount < 0) {
      throw new Error(`Desktop smoke test received ${JSON.stringify(result)}.`);
    }
    writeFileSync(
      path.join(workspaceRoot, '.desktop-smoke-ok'),
      `renderer=Narra Studio\napiVersion=10\nprojectCount=${result.projectCount}\n`,
      'utf8',
    );
    if (process.env.NARRA_SMOKE_EDITORIAL_UI === '1') {
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.workspace-tabs button')]
          .find((button) => button.textContent?.trim() === 'Editorial')
          ?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 450));
      await mainWindow.webContents.executeJavaScript(`
        [...document.querySelectorAll('.editorial-stage-tabs button')]
          .find((button) => button.textContent?.trim() === 'Topic')
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
          .find((button) => button.textContent?.trim() === 'Storyboard & assets')
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
    if (process.env.NARRA_SMOKE_SCREENSHOT) {
      if (process.env.NARRA_SMOKE_OPEN_FIRST_PROJECT === '1') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.project-row:not(.archived)')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (process.env.NARRA_SMOKE_WORKSPACE_TAB) {
        const tabLabel = JSON.stringify(process.env.NARRA_SMOKE_WORKSPACE_TAB);
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
              if (state === 'Completed' || state === 'Failed' || state === 'Stopped') {
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
        if (aiResult.state !== 'Completed' || !aiResult.responseLength) {
          throw new Error(`AI workspace smoke received ${JSON.stringify(aiResult)}.`);
        }
      } else if (process.env.NARRA_SMOKE_WORKSPACE_TAB === 'AI workspace') {
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
      await new Promise((resolve) => setTimeout(resolve, process.env.NARRA_SMOKE_WORKSPACE_TAB === 'AI workspace' ? 1500 : 600));
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
