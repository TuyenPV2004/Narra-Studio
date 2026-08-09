import type {ApprovalGate, AssetStatusInput, CreateAssetTaskInput, CreateProjectInput, EditorialDocument, RenderTarget} from '@narra/project-store';
import {contextBridge, ipcRenderer, webUtils} from 'electron';

const channels = {
  listProjects: 'projects:list',
  createProject: 'projects:create',
  chooseAndOpenProject: 'projects:choose-and-open',
  getProject: 'projects:get',
  duplicateProject: 'projects:duplicate',
  archiveProject: 'projects:archive',
  refreshProject: 'projects:refresh',
  getStoryboard: 'storyboard:get',
  chooseAndImportStoryboard: 'storyboard:choose-and-import',
  createAssetTask: 'assets:create-task',
  updateAssetStatus: 'assets:update-status',
  chooseAndImportAssetMedia: 'assets:choose-and-import-media',
  importAssetMediaPath: 'assets:import-media-path',
  exportStoryboardRenderInput: 'render:export-storyboard-input',
  getVoiceWorkspace: 'voice:get',
  syncNarrationSegments: 'voice:sync-segments',
  chooseAndImportNarrationAudio: 'voice:choose-and-import-audio',
  chooseAndImportCaptions: 'voice:choose-and-import-captions',
  fitTimelineToNarration: 'voice:fit-timeline',
  getEditorialWorkspace: 'editorial:get',
  saveEditorialDocument: 'editorial:save-document',
  getReviewWorkspace: 'review:get',
  approveGate: 'review:approve-gate',
  revokeGate: 'review:revoke-gate',
  queueRender: 'render:queue',
  cancelJob: 'render:cancel-job',
  retryJob: 'render:retry-job',
  chooseAndAttachRenderOutput: 'render:choose-and-attach-output',
} as const;

const api = {
  runtime: 'electron',
  version: 6,
  listProjects: () => ipcRenderer.invoke(channels.listProjects),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke(channels.createProject, input),
  chooseAndOpenProject: () => ipcRenderer.invoke(channels.chooseAndOpenProject),
  getProject: (projectId: string) => ipcRenderer.invoke(channels.getProject, projectId),
  duplicateProject: (projectId: string) => ipcRenderer.invoke(channels.duplicateProject, projectId),
  archiveProject: (projectId: string) => ipcRenderer.invoke(channels.archiveProject, projectId),
  refreshProject: (projectId: string) => ipcRenderer.invoke(channels.refreshProject, projectId),
  getStoryboard: (projectId: string) => ipcRenderer.invoke(channels.getStoryboard, projectId),
  chooseAndImportStoryboard: (projectId: string) => ipcRenderer.invoke(channels.chooseAndImportStoryboard, projectId),
  createAssetTask: (projectId: string, input: CreateAssetTaskInput) =>
    ipcRenderer.invoke(channels.createAssetTask, projectId, input),
  updateAssetStatus: (projectId: string, assetId: string, input: AssetStatusInput) =>
    ipcRenderer.invoke(channels.updateAssetStatus, projectId, assetId, input),
  chooseAndImportAssetMedia: (projectId: string, assetId: string) =>
    ipcRenderer.invoke(channels.chooseAndImportAssetMedia, projectId, assetId),
  importDroppedAssetMedia: (projectId: string, assetId: string, file: File) =>
    ipcRenderer.invoke(channels.importAssetMediaPath, projectId, assetId, webUtils.getPathForFile(file)),
  exportStoryboardRenderInput: (projectId: string) => ipcRenderer.invoke(channels.exportStoryboardRenderInput, projectId),
  getVoiceWorkspace: (projectId: string) => ipcRenderer.invoke(channels.getVoiceWorkspace, projectId),
  syncNarrationSegments: (projectId: string) => ipcRenderer.invoke(channels.syncNarrationSegments, projectId),
  chooseAndImportNarrationAudio: (projectId: string, segmentId: string) =>
    ipcRenderer.invoke(channels.chooseAndImportNarrationAudio, projectId, segmentId),
  chooseAndImportCaptions: (projectId: string) => ipcRenderer.invoke(channels.chooseAndImportCaptions, projectId),
  fitTimelineToNarration: (projectId: string) => ipcRenderer.invoke(channels.fitTimelineToNarration, projectId),
  getEditorialWorkspace: (projectId: string) => ipcRenderer.invoke(channels.getEditorialWorkspace, projectId),
  saveEditorialDocument: (projectId: string, document: EditorialDocument, content: string) =>
    ipcRenderer.invoke(channels.saveEditorialDocument, projectId, document, content),
  getReviewWorkspace: (projectId: string) => ipcRenderer.invoke(channels.getReviewWorkspace, projectId),
  approveGate: (projectId: string, gate: ApprovalGate, note: string) =>
    ipcRenderer.invoke(channels.approveGate, projectId, gate, note),
  revokeGate: (projectId: string, gate: ApprovalGate, note: string) =>
    ipcRenderer.invoke(channels.revokeGate, projectId, gate, note),
  queueRender: (projectId: string, target: RenderTarget) => ipcRenderer.invoke(channels.queueRender, projectId, target),
  cancelJob: (projectId: string, jobId: string) => ipcRenderer.invoke(channels.cancelJob, projectId, jobId),
  retryJob: (projectId: string, jobId: string) => ipcRenderer.invoke(channels.retryJob, projectId, jobId),
  chooseAndAttachRenderOutput: (projectId: string, jobId: string) =>
    ipcRenderer.invoke(channels.chooseAndAttachRenderOutput, projectId, jobId),
};

contextBridge.exposeInMainWorld('narra', api);
