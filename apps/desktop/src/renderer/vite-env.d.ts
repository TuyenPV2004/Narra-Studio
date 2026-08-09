/// <reference types="vite/client" />

import type {
  AssetStatusInput,
  CreateAssetTaskInput,
  CreateProjectInput,
  ProjectDetail,
  ProjectRecord,
  StoryboardWorkspace,
  VoiceWorkspace,
} from '@narra/project-store';

interface NarraDesktopApi {
  readonly runtime: 'electron';
  readonly version: 4;
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
  getVoiceWorkspace: (projectId: string) => Promise<VoiceWorkspace>;
  syncNarrationSegments: (projectId: string) => Promise<VoiceWorkspace>;
  chooseAndImportNarrationAudio: (projectId: string, segmentId: string) => Promise<VoiceWorkspace | null>;
  chooseAndImportCaptions: (projectId: string) => Promise<VoiceWorkspace | null>;
  fitTimelineToNarration: (projectId: string) => Promise<VoiceWorkspace>;
}

declare global {
  interface Window {
    readonly narra: NarraDesktopApi;
  }
}

export {};
