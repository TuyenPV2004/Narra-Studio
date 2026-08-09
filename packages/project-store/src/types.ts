import type {Asset, CaptionCue, ClaimCollection, FactCollection, NarrationSegment, Project, Scene, Shot, SourceCollection} from '@narra/contracts';

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

export type TimelineWarning = {
  sceneId: string;
  kind: 'MISSING_AUDIO' | 'SHORTER' | 'LONGER' | 'ALIGNED';
  plannedDurationSec: number;
  actualDurationSec: number | null;
  deltaSec: number | null;
  message: string;
};

export type VoiceWorkspace = {
  projectId: string;
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

export type EditorialWorkspace = {
  projectId: string;
  researchBrief: string;
  thesis: string;
  script: string;
  sources: SourceCollection['items'];
  facts: FactCollection['items'];
  claims: ClaimCollection['items'];
};

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
