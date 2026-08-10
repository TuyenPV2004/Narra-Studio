/// <reference types="vite/client" />

import type {
  AssetStatusInput,
  CreateAssetTaskInput,
  CreateProjectInput,
  ProjectDetail,
  ProjectRecord,
  StoryboardWorkspace,
  VoiceWorkspace,
  ApprovalGate,
  EditorialDocument,
  EditorialWorkspace,
  RenderTarget,
  ReviewWorkspace,
  AiWorkspace,
  SelectTopicInput,
  SaveOutlineInput,
  PrepareFlowTaskInput,
  FlowWorkspace,
  GenerateNarrationInput,
  GenerateNarrationBatchInput,
} from '@narra/project-store';
import type {AiReasoningEffort, AiStage, AiProjectSettings} from '@narra/contracts';

interface NarraDesktopApi {
  readonly runtime: 'electron';
  readonly version: 11;
  listProjects: () => Promise<ProjectRecord[]>;
  createProject: (input: CreateProjectInput) => Promise<ProjectDetail>;
  chooseAndOpenProject: () => Promise<ProjectDetail | null>;
  getProject: (projectId: string) => Promise<ProjectDetail>;
  duplicateProject: (projectId: string) => Promise<ProjectDetail>;
  archiveProject: (projectId: string) => Promise<ProjectRecord>;
  refreshProject: (projectId: string) => Promise<ProjectDetail>;
  getStoryboard: (projectId: string) => Promise<StoryboardWorkspace>;
  chooseAndImportStoryboard: (projectId: string) => Promise<StoryboardWorkspace | null>;
  createAssetTask: (projectId: string, input: CreateAssetTaskInput) => Promise<StoryboardWorkspace>;
  updateAssetStatus: (projectId: string, assetId: string, input: AssetStatusInput) => Promise<StoryboardWorkspace>;
  chooseAndImportAssetMedia: (projectId: string, assetId: string) => Promise<StoryboardWorkspace | null>;
  importDroppedAssetMedia: (projectId: string, assetId: string, file: File) => Promise<StoryboardWorkspace>;
  getFlowWorkspace: (projectId: string) => Promise<FlowWorkspace>;
  chooseFlowWatchDirectory: (projectId: string) => Promise<FlowWorkspace | null>;
  scanFlowCandidates: (projectId: string) => Promise<FlowWorkspace>;
  prepareFlowAssetTask: (projectId: string, input: PrepareFlowTaskInput) => Promise<StoryboardWorkspace>;
  selectFlowCandidate: (projectId: string, candidateId: string, assetId: string) => Promise<StoryboardWorkspace>;
  rejectFlowCandidate: (projectId: string, candidateId: string) => Promise<FlowWorkspace>;
  copyText: (value: string) => Promise<{copied: true}>;
  exportStoryboardRenderInput: (projectId: string) => Promise<string>;
  getVoiceWorkspace: (projectId: string) => Promise<VoiceWorkspace>;
  syncNarrationSegments: (projectId: string) => Promise<VoiceWorkspace>;
  chooseAndImportNarrationAudio: (projectId: string, segmentId: string) => Promise<VoiceWorkspace | null>;
  generateNarrationSegment: (projectId: string, input: GenerateNarrationInput) => Promise<VoiceWorkspace>;
  generateMissingNarration: (projectId: string, input: GenerateNarrationBatchInput) => Promise<VoiceWorkspace>;
  chooseAndImportCaptions: (projectId: string) => Promise<VoiceWorkspace | null>;
  fitTimelineToNarration: (projectId: string) => Promise<VoiceWorkspace>;
  getEditorialWorkspace: (projectId: string) => Promise<EditorialWorkspace>;
  saveEditorialDocument: (projectId: string, document: EditorialDocument, content: string) => Promise<EditorialWorkspace>;
  selectTopicCandidate: (projectId: string, candidateId: string, input: SelectTopicInput) => Promise<EditorialWorkspace>;
  selectThesisCandidate: (projectId: string, candidateId: string, statement: string) => Promise<EditorialWorkspace>;
  saveOutline: (projectId: string, input: SaveOutlineInput) => Promise<EditorialWorkspace>;
  getReviewWorkspace: (projectId: string) => Promise<ReviewWorkspace>;
  approveGate: (projectId: string, gate: ApprovalGate, note: string) => Promise<ReviewWorkspace>;
  revokeGate: (projectId: string, gate: ApprovalGate, note: string) => Promise<ReviewWorkspace>;
  queueRender: (projectId: string, target: RenderTarget) => Promise<ReviewWorkspace>;
  cancelJob: (projectId: string, jobId: string) => Promise<ReviewWorkspace>;
  retryJob: (projectId: string, jobId: string) => Promise<ReviewWorkspace>;
  chooseAndAttachRenderOutput: (projectId: string, jobId: string) => Promise<ReviewWorkspace | null>;
  codexReadAccount: () => Promise<{
    signedIn: boolean;
    accountType: string | null;
    planType: string | null;
  }>;
  codexStartBrowserLogin: () => Promise<{
    loginId: string;
    authUrl?: string;
  }>;
  codexStartDeviceLogin: () => Promise<{
    loginId: string;
    verificationUrl?: string;
    userCode?: string;
  }>;
  codexListModels: () => Promise<Array<{
    id: string;
    displayName: string;
    description: string;
    supportedReasoningEfforts: Array<{reasoningEffort: string; description?: string}>;
    defaultReasoningEffort: string | null;
  }>>;
  codexReadRateLimits: () => Promise<unknown>;
  codexStartOrResumeThread: (projectId: string) => Promise<{threadId: string}>;
  codexGetWorkspace: (projectId: string) => Promise<AiWorkspace>;
  codexUpdateSettings: (
    projectId: string,
    input: {desiredModel: string; desiredEffort: AiReasoningEffort},
  ) => Promise<AiProjectSettings>;
  codexStartTurn: (
    projectId: string,
    input: {text: string; stage: AiStage},
  ) => Promise<{threadId: string; turnId: string; runId: string}>;
  codexRunEditorialStage: (
    projectId: string,
    input: {stage: AiStage; instruction: string},
  ) => Promise<{threadId: string; turnId: string; runId: string}>;
  codexInterruptTurn: (projectId: string) => Promise<{interrupted: true}>;
  codexRespondServerRequest: (id: number | string, result: unknown) => Promise<{accepted: true}>;
  openExternalUrl: (url: string) => Promise<{opened: true}>;
  onCodexEvent: (listener: (event: Record<string, unknown>) => void) => () => void;
}

declare global {
  interface Window {
    readonly narra: NarraDesktopApi;
  }
}

export {};
