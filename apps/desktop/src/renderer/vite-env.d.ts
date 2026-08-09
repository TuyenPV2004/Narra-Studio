/// <reference types="vite/client" />

import type {CreateProjectInput, ProjectDetail, ProjectRecord} from '@narra/project-store';

interface NarraDesktopApi {
  readonly runtime: 'electron';
  readonly version: 2;
  listProjects: () => Promise<ProjectRecord[]>;
  createProject: (input: CreateProjectInput) => Promise<ProjectDetail>;
  chooseAndOpenProject: () => Promise<ProjectDetail | null>;
  getProject: (projectId: string) => Promise<ProjectDetail>;
  duplicateProject: (projectId: string) => Promise<ProjectDetail>;
  archiveProject: (projectId: string) => Promise<ProjectRecord>;
  refreshProject: (projectId: string) => Promise<ProjectDetail>;
}

declare global {
  interface Window {
    readonly narra: NarraDesktopApi;
  }
}

export {};
