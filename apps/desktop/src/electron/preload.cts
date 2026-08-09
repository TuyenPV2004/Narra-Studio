import type {CreateProjectInput} from '@narra/project-store';
import {contextBridge, ipcRenderer} from 'electron';

const channels = {
  listProjects: 'projects:list',
  createProject: 'projects:create',
  chooseAndOpenProject: 'projects:choose-and-open',
  getProject: 'projects:get',
  duplicateProject: 'projects:duplicate',
  archiveProject: 'projects:archive',
  refreshProject: 'projects:refresh',
} as const;

const api = {
  runtime: 'electron',
  version: 2,
  listProjects: () => ipcRenderer.invoke(channels.listProjects),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke(channels.createProject, input),
  chooseAndOpenProject: () => ipcRenderer.invoke(channels.chooseAndOpenProject),
  getProject: (projectId: string) => ipcRenderer.invoke(channels.getProject, projectId),
  duplicateProject: (projectId: string) => ipcRenderer.invoke(channels.duplicateProject, projectId),
  archiveProject: (projectId: string) => ipcRenderer.invoke(channels.archiveProject, projectId),
  refreshProject: (projectId: string) => ipcRenderer.invoke(channels.refreshProject, projectId),
};

contextBridge.exposeInMainWorld('narra', api);
