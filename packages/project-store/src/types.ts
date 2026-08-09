import type {Asset, CaptionCue, NarrationSegment, Project, Scene, Shot} from '@narra/contracts';

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
