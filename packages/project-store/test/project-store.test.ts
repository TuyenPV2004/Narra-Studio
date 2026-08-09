import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../src/index.js';

const temporaryDirectories: string[] = [];
const stores: ProjectStore[] = [];

const createStore = (): ProjectStore => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'narra-project-store-'));
  temporaryDirectories.push(workspace);
  const store = new ProjectStore(workspace);
  stores.push(store);
  return store;
};

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, {recursive: true, force: true});
  }
});

describe('ProjectStore', () => {
  it('creates the portable project layout and persists the index after reopening', () => {
    const store = createStore();
    const created = store.createProject({title: 'Grid at Midnight', question: 'Why is demand changing?'});

    expect(created.project.validation?.status).toBe('VALID');
    expect(created.artifactVersions).toHaveLength(7);
    expect(readFileSync(path.join(created.project.rootPath, 'project.json'), 'utf8')).toContain(created.project.id);

    const workspace = store.workspaceRoot;
    store.close();
    stores.pop();
    const reopened = new ProjectStore(workspace);
    stores.push(reopened);

    expect(reopened.listProjects()).toHaveLength(1);
    expect(reopened.getProject(created.project.id).project.title).toBe('Grid at Midnight');
  });

  it('duplicates project artifacts with a new project id and archives without deleting files', () => {
    const store = createStore();
    const original = store.createProject({title: 'Original Story', question: 'What happened?'});
    const duplicate = store.duplicateProject(original.project.id);

    expect(duplicate.project.id).not.toBe(original.project.id);
    expect(duplicate.project.title).toBe('Original Story (Copy)');
    expect(duplicate.project.validation?.status).toBe('VALID');

    const archived = store.archiveProject(original.project.id);
    expect(archived.archived).toBe(true);
    expect(readFileSync(path.join(original.project.rootPath, 'project.json'), 'utf8')).toContain('Original Story');
  });

  it('re-registers a moved project directory and keeps its project identity', () => {
    const store = createStore();
    const created = store.createProject({title: 'Portable Story', question: 'Can it move?'});
    const movedRoot = path.join(store.workspaceRoot, 'moved-portable-story');
    renameSync(created.project.rootPath, movedRoot);

    const opened = store.openProjectDirectory(movedRoot);
    expect(opened.project.id).toBe(created.project.id);
    expect(opened.project.rootPath).toBe(movedRoot);
    expect(opened.project.validation?.status).toBe('VALID');
  });

  it('reports an actionable error for a newer artifact schema', () => {
    const store = createStore();
    const created = store.createProject({title: 'Future Artifact', question: 'What changed?'});
    const sourcesPath = path.join(created.project.rootPath, 'research', 'sources.json');
    const sources = JSON.parse(readFileSync(sourcesPath, 'utf8')) as Record<string, unknown>;
    sources.schemaVersion = 99;
    writeFileSync(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');

    const refreshed = store.refreshProject(created.project.id);
    expect(refreshed.project.validation?.status).toBe('INVALID');
    expect(refreshed.project.validation?.issues[0]).toMatchObject({
      file: 'research/sources.json',
      path: 'schemaVersion',
    });
    expect(refreshed.project.validation?.issues[0]?.suggestion).toContain('Upgrade Narra Studio');
  });
});
