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

  it('moves an asset from planning through human import and QA into the renderable storyboard', async () => {
    const store = createStore();
    const created = store.createProject({title: 'Storyboard Flow', question: 'How does the visual explain the claim?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-storyboard-import-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([{
      id: 'scene-hook', projectId, order: 0, title: 'The hook', narration: 'A physical system powers every answer.',
      durationSec: 8, claimIds: [],
    }]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([{
      id: 'shot-hook', projectId, sceneId: 'scene-hook', order: 0, durationSec: 8,
      visualType: 'AI_IMAGE', visualPurpose: 'Show the physical data centre', assetRoute: 'GOOGLE_FLOW',
      evidenceRequired: false, claimIds: [],
    }]), 'utf8');

    let workspace = store.importStoryboard(projectId, scenesPath, shotsPath);
    expect(workspace.staleScopes.find(({scope}) => scope === 'ASSETS')?.stale).toBe(true);
    workspace = store.createAssetTask(projectId, {
      shotId: 'shot-hook', kind: 'IMAGE', provider: 'GOOGLE_FLOW', brief: 'Wide data-centre exterior',
      prompt: 'Documentary still, wide data-centre exterior at dusk', rightsNote: 'Generated locally for this project.',
    });
    const asset = workspace.assets[0];
    expect(asset?.status).toBe('PLANNED');
    expect(workspace.shots[0]?.assetId).toBe(asset?.id);
    expect(() => store.updateAssetStatus(projectId, asset?.id ?? '', {status: 'QA_PASS'})).toThrow('Invalid asset transition');

    workspace = store.updateAssetStatus(projectId, asset?.id ?? '', {status: 'AWAITING_HUMAN'});
    expect(workspace.assets[0]?.status).toBe('AWAITING_HUMAN');
    const imagePath = path.join(importDirectory, 'candidate.png');
    writeFileSync(imagePath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    workspace = await store.importAssetMedia(projectId, asset?.id ?? '', imagePath);
    expect(workspace.assets[0]).toMatchObject({status: 'IMPORTED', metadata: {width: 1, height: 1, aspectRatio: '1:1'}});

    workspace = store.updateAssetStatus(projectId, asset?.id ?? '', {status: 'QA_PASS', qaNote: 'Composition approved.'});
    expect(workspace.assets[0]).toMatchObject({status: 'QA_PASS', qaNote: 'Composition approved.'});
    expect(store.getAssetFilePath(projectId, asset?.id ?? '')).toContain(`${path.sep}assets${path.sep}images${path.sep}`);
    expect(workspace.staleScopes.find(({scope}) => scope === 'ASSETS')?.stale).toBe(false);
    expect(workspace.staleScopes.find(({scope}) => scope === 'RENDER')?.stale).toBe(true);
    const renderInput = JSON.parse(readFileSync(store.exportStoryboardRenderInput(projectId), 'utf8')) as {
      bundle: {assets: Array<{id: string; status: string}>};
    };
    expect(renderInput.bundle.assets.find(({id}) => id === asset?.id)?.status).toBe('QA_PASS');
  });

  it('rejects storyboard imports with broken scene references without changing the project', () => {
    const store = createStore();
    const created = store.createProject({title: 'Broken Storyboard', question: 'Will invalid links be rejected?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-invalid-storyboard-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([{
      id: 'scene-valid', projectId, order: 0, title: 'Valid scene', narration: 'Narration.', durationSec: 5, claimIds: [],
    }]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([{
      id: 'shot-broken', projectId, sceneId: 'scene-missing', order: 0, durationSec: 5,
      visualType: 'TEXT', visualPurpose: 'Broken reference',
    }]), 'utf8');

    expect(() => store.importStoryboard(projectId, scenesPath, shotsPath)).toThrow('references unknown scene');
    expect(store.getStoryboardWorkspace(projectId).scenes).toHaveLength(0);
  });
});
