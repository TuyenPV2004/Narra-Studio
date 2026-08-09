/// <reference types="vite/client" />

import type {
  AssetStatusInput,
  CreateAssetTaskInput,
  CreateProjectInput,
  ProjectDetail,
  ProjectRecord,
  StoryboardWorkspace,
} from '@narra/project-store';

interface NarraDesktopApi {
  readonly runtime: 'electron';
  readonly version: 3;
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
  exportStoryboardRenderInput: (projectId: string) => Promise<string>;
}

declare global {
  interface Window {
    readonly narra: NarraDesktopApi;
  }
}

export {};
