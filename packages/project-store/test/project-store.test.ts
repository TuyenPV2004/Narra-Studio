import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProjectStore} from '../src/index.js';

const temporaryDirectories: string[] = [];
const stores: ProjectStore[] = [];

const silentWav = (durationSec: number): Buffer => {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = Math.round(durationSec * sampleRate) * channels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
};

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
    expect(created.artifactVersions).toHaveLength(9);
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

  it('replaces one narration segment, fits scene and shot timing, and exports captions for render', async () => {
    const store = createStore();
    const created = store.createProject({title: 'Voice Timeline', question: 'Can real narration control timing?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-voice-import-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([
      {id: 'scene-one', projectId, order: 0, title: 'One', narration: 'Electricity powers systems.', durationSec: 4, claimIds: []},
      {id: 'scene-two', projectId, order: 1, title: 'Two', narration: 'Cooling protects computers.', durationSec: 6, claimIds: []},
    ]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([
      {id: 'shot-one', projectId, sceneId: 'scene-one', order: 0, durationSec: 4, visualType: 'TEXT', visualPurpose: 'First idea'},
      {id: 'shot-two', projectId, sceneId: 'scene-two', order: 0, durationSec: 6, visualType: 'TEXT', visualPurpose: 'Second idea'},
    ]), 'utf8');
    store.importStoryboard(projectId, scenesPath, shotsPath);
    let voice = store.syncNarrationSegments(projectId);
    expect(voice.segments).toHaveLength(2);

    const firstAudio = path.join(importDirectory, 'first.wav');
    const firstReplacement = path.join(importDirectory, 'first-replacement.wav');
    const secondAudio = path.join(importDirectory, 'second.wav');
    writeFileSync(firstAudio, silentWav(1));
    writeFileSync(firstReplacement, silentWav(1.5));
    writeFileSync(secondAudio, silentWav(2));
    await store.importNarrationAudio(projectId, 'vo-scene-one', firstAudio);
    voice = await store.importNarrationAudio(projectId, 'vo-scene-two', secondAudio);
    const secondPath = voice.segments.find(({id}) => id === 'vo-scene-two')?.audioPath;
    expect(voice.segments.find(({id}) => id === 'vo-scene-one')?.durationSec).toBeCloseTo(1, 2);

    const captionsPath = path.join(importDirectory, 'words.json');
    writeFileSync(captionsPath, JSON.stringify({timebase: 'segment', words: [
      {word: 'Electricity', start: 0, end: 0.3, segment_id: 'vo-scene-one'},
      {word: 'powers', start: 0.3, end: 0.6, segment_id: 'vo-scene-one'},
      {word: 'systems.', start: 0.6, end: 0.9, segment_id: 'vo-scene-one'},
      {word: 'Cooling', start: 0, end: 0.5, segment_id: 'vo-scene-two'},
      {word: 'protects', start: 0.5, end: 1, segment_id: 'vo-scene-two'},
      {word: 'computers.', start: 1, end: 1.5, segment_id: 'vo-scene-two'},
    ]}), 'utf8');
    voice = store.importCaptions(projectId, captionsPath);
    expect(voice.qaIssues).toEqual([]);
    expect(voice.captions.find(({segmentId}) => segmentId === 'vo-scene-two')?.startMs).toBe(1000);

    store.fitTimelineToNarration(projectId);
    let storyboard = store.getStoryboardWorkspace(projectId);
    expect(storyboard.scenes.map(({durationSec}) => durationSec)).toEqual([1, 2]);
    expect(storyboard.shots.map(({durationSec}) => durationSec)).toEqual([1, 2]);
    voice = await store.importNarrationAudio(projectId, 'vo-scene-one', firstReplacement);
    expect(voice.segments.find(({id}) => id === 'vo-scene-one')).toMatchObject({version: 2, durationSec: 1.5});
    expect(voice.segments.find(({id}) => id === 'vo-scene-two')?.audioPath).toBe(secondPath);
    expect(voice.captions.find(({segmentId}) => segmentId === 'vo-scene-two')?.startMs).toBe(1500);
    expect(voice.staleScopes.find(({scope}) => scope === 'CAPTIONS')?.stale).toBe(true);
    store.fitTimelineToNarration(projectId);
    storyboard = store.getStoryboardWorkspace(projectId);
    expect(storyboard.scenes.map(({durationSec}) => durationSec)).toEqual([1.5, 2]);

    const renderInput = JSON.parse(readFileSync(store.exportStoryboardRenderInput(projectId), 'utf8')) as {
      bundle: {narrationSegments: unknown[]; captions: unknown[]};
    };
    expect(renderInput.bundle.narrationSegments).toHaveLength(2);
    expect(renderInput.bundle.captions).toHaveLength(2);
  });

  it('enforces approval order and keeps versioned render snapshots, outputs, and logs', () => {
    const store = createStore();
    const created = store.createProject({title: 'Approval Flow', question: 'Can each decision be audited?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-approval-import-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([{
      id: 'scene-one', projectId, order: 0, title: 'Opening', narration: 'A traceable decision begins here.', durationSec: 5, claimIds: [],
    }]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([{
      id: 'shot-one', projectId, sceneId: 'scene-one', order: 0, durationSec: 5,
      visualType: 'TEXT', visualPurpose: 'State the opening question', assetRoute: 'NONE', claimIds: [],
    }]), 'utf8');
    store.importStoryboard(projectId, scenesPath, shotsPath);
    store.saveEditorialDocument(projectId, 'THESIS', 'The process is reliable when every transition is explicit.');
    store.saveEditorialDocument(projectId, 'SCRIPT', '# Opening\n\nEvery approval leaves a local record.');

    expect(() => store.approveGate(projectId, 'THESIS', '')).toThrow('locked');
    store.approveGate(projectId, 'TOPIC', 'Question selected.');
    store.approveGate(projectId, 'THESIS', 'Thesis selected.');
    store.approveGate(projectId, 'SCRIPT', 'Script reviewed.');
    store.approveGate(projectId, 'STORYBOARD', 'Shots reviewed.');
    let review = store.approveGate(projectId, 'ASSETS', 'No external visual assets required.');
    expect(review.approvals.find(({gate}) => gate === 'ASSETS')?.status).toBe('APPROVED');

    review = store.queueRender(projectId, 'ROUGH');
    const rough = review.jobs[0];
    expect(rough).toMatchObject({target: 'ROUGH', version: 1, status: 'QUEUED'});
    expect(readFileSync(path.join(created.project.rootPath, rough?.inputSnapshotPath ?? ''), 'utf8')).toContain(projectId);
    const roughOutput = path.join(importDirectory, 'rough.mp4');
    writeFileSync(roughOutput, 'rough-video-placeholder', 'utf8');
    review = store.attachRenderOutput(projectId, rough?.id ?? '', roughOutput);
    expect(review.jobs[0]).toMatchObject({status: 'COMPLETED', outputPath: 'renders/rough/render-v1.mp4'});
    expect(review.jobs[0]?.log).toContain('Output imported');

    store.approveGate(projectId, 'ROUGH_CUT', 'Rough cut approved.');
    review = store.queueRender(projectId, 'FINAL');
    const final = review.jobs.find(({target}) => target === 'FINAL');
    const finalOutput = path.join(importDirectory, 'final.mp4');
    writeFileSync(finalOutput, 'final-video-placeholder', 'utf8');
    store.attachRenderOutput(projectId, final?.id ?? '', finalOutput);
    store.approveGate(projectId, 'FINAL', 'Ready to publish.');
    expect(store.getProject(projectId).project.status).toBe('FINAL_APPROVED');

    store.saveEditorialDocument(projectId, 'SCRIPT', '# Revised opening\n\nThe script changed.');
    review = store.getReviewWorkspace(projectId);
    expect(review.approvals.find(({gate}) => gate === 'THESIS')?.status).toBe('APPROVED');
    expect(review.approvals.find(({gate}) => gate === 'SCRIPT')?.status).toBe('REVOKED');
    expect(review.approvals.find(({gate}) => gate === 'FINAL')?.unlocked).toBe(false);
    expect(store.getProject(projectId).project.status).toBe('THESIS_APPROVED');
  });
});
