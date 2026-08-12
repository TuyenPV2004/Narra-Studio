import type {
  AiProjectSettings,
  AiRun,
  Asset,
  CaptionCue,
  ClaimCollection,
  FactCollection,
  NarrationSegment,
  Project,
  Scene,
  Shot,
  SourceCollection,
  AiSourceCard,
  TopicCandidate,
  ThesisCandidate,
  OutlineSection,
  AiStage,
  FlowPromptPackage,
  MediaMetadata,
} from '@narra/contracts';

export type CreateProjectInput = {
  title: string;
  question: string;
  targetDurationSec?: number;
  language?: string;
  aspectRatio?: Project['aspectRatio'];
};

export type ValidationIssue = {
  severity: 'ERROR' | 'WARNING';
  file: string;
  path: string;
  message: string;
  suggestion: string;
};

export type ValidationReport = {
  status: 'VALID' | 'INVALID';
  checkedAt: string;
  issues: ValidationIssue[];
};

export type ProjectRecord = Project & {
  rootPath: string;
  archived: boolean;
  lastOpenedAt: string | null;
  validation: ValidationReport | null;
};

export type ProjectDetail = {
  project: ProjectRecord;
  artifactVersions: Array<{
    path: string;
    schemaVersion: number;
    contentHash: string;
    updatedAt: string;
    stale: boolean;
  }>;
};

export type AiWorkspace = {
  projectId: string;
  settings: AiProjectSettings;
  runs: AiRun[];
};

export type CreateAiRunInput = {
  stage: AiRun['stage'];
  prompt: string;
};

export type UpdateAiRunInput = Partial<Pick<AiRun,
  'status' | 'actualModel' | 'actualEffort' | 'threadId' | 'turnId' | 'startedAt' | 'completedAt' | 'error' | 'usage'>>;

export type StaleScope = {
  scope: 'ASSETS' | 'AUDIO' | 'CAPTIONS' | 'RENDER';
  stale: boolean;
  reason: string | null;
  updatedAt: string;
};

export type StoryboardWorkspace = {
  projectId: string;
  scenes: Scene[];
  shots: Shot[];
  assets: Asset[];
  staleScopes: StaleScope[];
};

export type CreateAssetTaskInput = {
  shotId: string;
  kind: Extract<Asset['kind'], 'IMAGE' | 'VIDEO'>;
  provider: NonNullable<Asset['task']>['provider'];
  brief: string;
  prompt: string;
  negativePrompt?: string;
  rightsNote: string;
};

export type AssetStatusInput = {
  status: Asset['status'];
  qaNote?: string;
};

export type AttachGeneratedAssetInput = {
  provider: 'GOOGLE_FLOW' | 'AVIS';
  providerJobId?: string;
  promptVersion?: number;
  model: string;
  prompt: string;
};

export type PrepareFlowTaskInput = {
  shotId: string;
  kind?: 'IMAGE' | 'VIDEO';
  imageModel?: string;
  videoModel?: string;
};

export type FlowCandidateStatus = 'DETECTED' | 'IMPORTED' | 'SELECTED' | 'REJECTED';

export type FlowCandidate = {
  id: string;
  projectId: string;
  fileName: string;
  kind: 'IMAGE' | 'VIDEO';
  suggestedShotId: string | null;
  status: FlowCandidateStatus;
  fingerprint: string;
  fileSizeBytes: number;
  detectedAt: string;
  updatedAt: string;
  metadata: MediaMetadata | null;
};

export type FlowWorkspace = {
  projectId: string;
  watchDirectory: string | null;
  flowUrl: string;
  promptPackages: Array<{assetId: string; shotId: string; package: FlowPromptPackage}>;
  candidates: FlowCandidate[];
};

export type TimelineWarning = {
  sceneId: string;
  kind: 'MISSING_AUDIO' | 'SHORTER' | 'LONGER' | 'ALIGNED';
  plannedDurationSec: number;
  actualDurationSec: number | null;
  deltaSec: number | null;
  message: string;
};

export type VoicePreset = {
  id: string;
  label: string;
  description: string;
  voice: string;
  language: 'en-us' | 'en-gb';
  defaultSpeed: number;
};

export type VoiceRuntimeStatus = {
  provider: 'KOKORO_ONNX';
  available: boolean;
  modelVersion: string;
  missing: string[];
  setupCommand: string;
  licenseSummary: string;
};

export type GenerateNarrationInput = {
  segmentId: string;
  presetId: string;
  speed: number;
  pronunciationNotes?: string;
};

export type GenerateNarrationBatchInput = Omit<GenerateNarrationInput, 'segmentId' | 'pronunciationNotes'>;

export type VoiceWorkspace = {
  projectId: string;
  runtime: VoiceRuntimeStatus;
  presets: VoicePreset[];
  segments: NarrationSegment[];
  captions: CaptionCue[];
  qaIssues: Array<{
    segmentId: string;
    severity: 'WARNING' | 'ERROR';
    message: string;
    missingTerms: string[];
    similarity: number;
  }>;
  timelineWarnings: TimelineWarning[];
  staleScopes: StaleScope[];
};

export type TimelinePreflightIssue = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  subjectId: string;
  message: string;
};

export type TimelineWorkspace = {
  projectId: string;
  durationSec: number;
  scenes: Scene[];
  shots: Shot[];
  assets: Asset[];
  segments: NarrationSegment[];
  captions: CaptionCue[];
  preflightIssues: TimelinePreflightIssue[];
  staleScopes: StaleScope[];
};

export type UpdateCaptionCueInput = Pick<CaptionCue, 'startMs' | 'endMs' | 'text'>;
export type UpdateShotAudioInput = Pick<Shot, 'sourceAudioMode' | 'sourceAudioVolume'>;

export type ProjectBackupResult = {
  projectId: string;
  backupPath: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
};

export type DiagnosticCheck = {
  id: string;
  label: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  detail: string;
  remediation?: string;
};

export type SystemDiagnostics = {
  checkedAt: string;
  appVersion: string;
  packaged: boolean;
  platform: string;
  checks: DiagnosticCheck[];
};

export type EditorialWorkspace = {
  projectId: string;
  researchBrief: string;
  thesis: string;
  script: string;
  sources: SourceCollection['items'];
  facts: FactCollection['items'];
  claims: ClaimCollection['items'];
  sourceCards: AiSourceCard[];
  topicCandidates: TopicCandidate[];
  thesisCandidates: ThesisCandidate[];
  outlineSections: OutlineSection[];
  scriptQaReport: string;
};

export type EditorialStage = AiStage;

export type SelectTopicInput = Pick<TopicCandidate, 'title' | 'hook' | 'angle' | 'rationale'>;

export type SaveOutlineInput = Array<Pick<OutlineSection,
  'id' | 'title' | 'objective' | 'claimIds' | 'sourceIds' | 'targetDurationSec' | 'contentNotes'>>;

export type EditorialDocument = 'RESEARCH' | 'THESIS' | 'SCRIPT';

export type ApprovalGate = 'TOPIC' | 'THESIS' | 'SCRIPT' | 'STORYBOARD' | 'ASSETS' | 'ROUGH_CUT' | 'FINAL';

export type ApprovalRecord = {
  id: string;
  projectId: string;
  gate: ApprovalGate;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  artifactVersion: number;
  approvedAt: string | null;
  note: string | null;
  unlocked: boolean;
  ready: boolean;
  readinessMessage: string;
};

export type RenderTarget = 'ROUGH' | 'FINAL';
export type MediaJobType = 'PROBE' | 'PROXY' | 'RENDER' | 'POST_PROCESS';

export type QueueMediaJobInput = {
  type: Exclude<MediaJobType, 'RENDER'>;
  sourcePath: string;
  scope?: string;
};

export type RenderJobRecord = {
  id: string;
  projectId: string;
  type: MediaJobType;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'RETRYABLE_FAILED' | 'TERMINAL_FAILED' | 'CANCELLED';
  version: number;
  target: RenderTarget;
  inputSnapshotPath: string;
  logPath: string | null;
  outputPath: string | null;
  tempOutputPath: string | null;
  attempt: number;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  scope: string;
  log: string;
  createdAt: string;
  updatedAt: string;
};

export type JobExecution = {
  id: string;
  projectId: string;
  type: MediaJobType;
  target: RenderTarget;
  version: number;
  attempt: number;
  scope: string;
  projectRoot: string;
  inputSnapshotPath: string;
  tempOutputPath: string;
  outputPath: string;
};

export type ReviewWorkspace = {
  projectId: string;
  approvals: ApprovalRecord[];
  jobs: RenderJobRecord[];
};
