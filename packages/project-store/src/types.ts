import type {Project} from '@narra/contracts';

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
