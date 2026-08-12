export type FlowAccountStatus = 'EMPTY' | 'CONNECTED' | 'BUSY' | 'WAITING_FOR_USER' | 'ERROR';

export type FlowAccount = {
  id: number;
  partition: string;
  status: FlowAccountStatus;
  cookieCount: number;
  activeJobCount: number;
  lastUsedAt: string | null;
  error: string | null;
};

export type FlowAutomationJobStatus =
  | 'QUEUED'
  | 'PREPARING_SESSION'
  | 'UPLOADING'
  | 'SUBMITTING'
  | 'GENERATING'
  | 'DOWNLOADING'
  | 'COMPLETED'
  | 'WAITING_FOR_USER'
  | 'RETRYABLE_FAILED'
  | 'TERMINAL_FAILED'
  | 'CANCELLED';

export type FlowGenerationRequest = {
  projectId: string;
  assetId: string;
  shotId: string;
  shotToken: string;
  kind: 'IMAGE' | 'VIDEO';
  prompt: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  durationSec?: 4 | 6 | 8;
  referencePaths?: string[];
  downloadDirectory: string;
  slotId?: number;
};

export type FlowAutomationJob = Omit<FlowGenerationRequest, 'slotId'> & {
  id: string;
  slotId: number | null;
  status: FlowAutomationJobStatus;
  progress: number;
  attempt: number;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AvisStatus = {
  configured: boolean;
  apiBase: string;
  keySource: 'environment' | 'none';
};

export type AvisGenerationRequest = {
  projectId: string;
  assetId: string;
  kind: 'IMAGE' | 'VIDEO';
  prompt: string;
  model?: string;
  size?: string;
  ratio?: string;
  durationSec?: number;
  firstFrameDataUrl?: string;
  lastFrameDataUrl?: string;
  referenceImageDataUrl?: string;
  outputDirectory: string;
};

export type AvisGenerationResult = {
  provider: 'AVIS';
  jobId: string;
  model: string;
  outputPath: string;
  sourceUrl: string;
};
