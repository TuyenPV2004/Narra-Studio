import {afterEach, describe, expect, it} from 'vitest';
import {existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LocalJobRunner, ProjectStore} from '../src/index.js';

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
    expect(created.artifactVersions).toHaveLength(16);
    expect(readFileSync(path.join(created.project.rootPath, 'project.json'), 'utf8')).toContain(created.project.id);

    const workspace = store.workspaceRoot;
    store.close();
    stores.pop();
    const reopened = new ProjectStore(workspace);
    stores.push(reopened);

    expect(reopened.listProjects()).toHaveLength(1);
    expect(reopened.getProject(created.project.id).project.title).toBe('Grid at Midnight');
  });

  it('persists resumable Codex thread state in project AI settings', () => {
    const store = createStore();
    const created = store.createProject({title: 'Codex Session', question: 'Can the project resume its AI thread?'});

    expect(store.getAiProjectSettings(created.project.id)).toMatchObject({
      desiredModel: 'gpt-5.6-sol',
      desiredEffort: 'medium',
      threadId: null,
    });

    const updated = store.updateAiProjectSettings(created.project.id, {
      threadId: 'thread-1',
      lastTurnId: 'turn-1',
      lastConnectionStatus: 'READY',
    });

    expect(updated).toMatchObject({threadId: 'thread-1', lastTurnId: 'turn-1', lastConnectionStatus: 'READY'});
    expect(store.getAiProjectSettings(created.project.id)).toEqual(updated);
  });

  it('persists AI run metadata without storing account credentials', () => {
    const store = createStore();
    const created = store.createProject({title: 'AI Run History', question: 'What should we investigate?'});
    const run = store.createAiRun(created.project.id, {stage: 'DISCOVER', prompt: 'Find three defensible angles.'});

    expect(run).toMatchObject({status: 'QUEUED', requestedModel: 'gpt-5.6-sol', requestedEffort: 'medium'});
    const completed = store.updateAiRun(created.project.id, run.id, {
      status: 'COMPLETED',
      threadId: 'thread-1',
      turnId: 'turn-1',
      actualModel: 'gpt-5.6-sol',
      actualEffort: 'medium',
      startedAt: '2026-08-10T00:00:00.000Z',
      completedAt: '2026-08-10T00:01:00.000Z',
    });

    expect(store.getAiWorkspace(created.project.id).runs[0]).toEqual(completed);
    const persisted = readFileSync(path.join(created.project.rootPath, 'ai/runs.json'), 'utf8');
    expect(persisted).toContain('Find three defensible angles.');
    expect(persisted).not.toContain('email');
    expect(persisted).not.toContain('token');
  });

  it('validates structured editorial output before writing and protects an approved topic', () => {
    const store = createStore();
    const created = store.createProject({title: 'Structured Editorial', question: 'Which angle can the evidence support?'});
    const projectId = created.project.id;
    const discoverRun = store.createAiRun(projectId, {stage: 'DISCOVER', prompt: 'Discover defensible topics.'});
    const topic = (id: string, rank: number) => ({
      id, projectId, runId: discoverRun.id, title: `Topic ${rank}`, hook: 'A concrete tension.', angle: 'Follow the evidence.',
      rationale: 'Primary evidence and visual material are available.',
      scores: {viewPotential: 80, storyDepth: 82, visualPotential: 75, sourceQuality: 90, evergreenValue: 78, originalAngle: 72, adSafety: 95},
      recommendationRank: rank, sourceIds: [], risks: ['The latest data may change.'],
    });
    store.applyEditorialStageOutput(projectId, 'DISCOVER', discoverRun.id, {topicCandidates: [topic('topic-one', 1), topic('topic-two', 2)]});
    let editorial = store.selectTopicCandidate(projectId, 'topic-one', {
      title: 'Edited topic', hook: 'An edited hook.', angle: 'An edited angle.', rationale: 'A creator-reviewed rationale.',
    });
    expect(editorial.topicCandidates.find(({id}) => id === 'topic-one')).toMatchObject({selected: true, title: 'Edited topic'});

    const researchRun = store.createAiRun(projectId, {stage: 'RESEARCH', prompt: 'Research the selected topic.'});
    const sourcesPath = path.join(created.project.rootPath, 'research/sources.json');
    const before = readFileSync(sourcesPath, 'utf8');
    expect(() => store.applyEditorialStageOutput(projectId, 'RESEARCH', researchRun.id, {sources: []})).toThrow();
    expect(readFileSync(sourcesPath, 'utf8')).toBe(before);

    store.approveGate(projectId, 'TOPIC', 'Creator approved the selected topic.');
    expect(() => store.applyEditorialStageOutput(projectId, 'DISCOVER', discoverRun.id, {
      topicCandidates: [topic('topic-three', 1), topic('topic-four', 2)],
    })).toThrow('Revoke');
    editorial = store.getEditorialWorkspace(projectId);
    expect(editorial.topicCandidates.find(({selected}) => selected)?.id).toBe('topic-one');
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

  it('adds U0 AI artifacts when opening a legacy project without changing its identity', () => {
    const store = createStore();
    const created = store.createProject({title: 'Legacy Project', question: 'Can an old project migrate safely?'});
    const updatePaths = [
      'ai/runs.json', 'ai/search_activity.json', 'ai/source_cards.json', 'ai/settings.json',
      'research/topic_candidates.json', 'thesis/thesis_candidates.json', 'script/outline.json',
    ];
    for (const artifactPath of updatePaths) {
      rmSync(path.join(created.project.rootPath, ...artifactPath.split('/')), {force: true});
      store.database.prepare('DELETE FROM artifact_versions WHERE project_id = ? AND artifact_path = ?')
        .run(created.project.id, artifactPath);
    }
    rmSync(path.join(created.project.rootPath, 'ai'), {recursive: true, force: true});

    const opened = store.openProjectDirectory(created.project.rootPath);
    expect(opened.project.id).toBe(created.project.id);
    expect(opened.project.validation?.status).toBe('VALID');
    expect(opened.artifactVersions).toHaveLength(16);
    const settings = JSON.parse(readFileSync(path.join(created.project.rootPath, 'ai', 'settings.json'), 'utf8')) as Record<string, unknown>;
    expect(settings).toMatchObject({
      projectId: created.project.id,
      desiredModel: 'gpt-5.6-sol',
      desiredEffort: 'medium',
      threadId: null,
      lastConnectionStatus: 'UNKNOWN',
    });
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

  it('reports an invalid AI workspace relationship without modifying editorial artifacts', () => {
    const store = createStore();
    const created = store.createProject({title: 'AI Relationship', question: 'Can AI provenance be validated?'});
    const sourceCardsPath = path.join(created.project.rootPath, 'ai', 'source_cards.json');
    const sourceCards = JSON.parse(readFileSync(sourceCardsPath, 'utf8')) as {
      projectId: string;
      items: unknown[];
    };
    sourceCards.items = [{
      id: 'source-card-one', projectId: created.project.id, runId: 'run-missing',
      title: 'Official source', url: 'https://example.com/source', summary: 'Relevant evidence.',
      supportsFactIds: [], accessedAt: '2026-08-10T00:00:00.000Z',
    }];
    writeFileSync(sourceCardsPath, `${JSON.stringify(sourceCards, null, 2)}\n`, 'utf8');

    const refreshed = store.refreshProject(created.project.id);
    expect(refreshed.project.validation?.status).toBe('INVALID');
    expect(refreshed.project.validation?.issues.some(({file, message}) =>
      file === 'ai/workspace' && message.includes('unknown run run-missing'),
    )).toBe(true);
    expect(readFileSync(path.join(created.project.rootPath, 'script', 'script_v1.md'), 'utf8')).toBe('');
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

  it('prepares Google Flow prompts, deduplicates downloads, and requires creator confirmation before import', async () => {
    const store = createStore();
    const created = store.createProject({title: 'Assisted Flow', question: 'Can creator-operated generation remain traceable?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-flow-import-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([{
      id: 'scene-flow', projectId, order: 0, title: 'Physical infrastructure',
      narration: 'A physical system sits behind the interface.', durationSec: 6, claimIds: [],
    }]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([{
      id: 'shot-flow', projectId, sceneId: 'scene-flow', order: 0, durationSec: 6,
      visualType: 'AI_IMAGE', visualPurpose: 'Show restrained physical infrastructure at dusk',
      assetRoute: 'GOOGLE_FLOW', evidenceRequired: true, claimIds: [],
    }]), 'utf8');
    store.importStoryboard(projectId, scenesPath, shotsPath);
    store.saveEditorialDocument(projectId, 'THESIS', 'The interface depends on physical infrastructure.');
    store.saveEditorialDocument(projectId, 'SCRIPT', '# Opening\n\nA physical system sits behind the interface.');
    for (const gate of ['TOPIC', 'THESIS', 'SCRIPT', 'STORYBOARD'] as const) store.approveGate(projectId, gate, 'Flow test approval.');

    let storyboard = store.prepareFlowAssetTask(projectId, {shotId: 'shot-flow', kind: 'IMAGE'});
    const asset = storyboard.assets[0];
    expect(asset?.task?.flow).toMatchObject({
      version: 1, shotToken: 'flow-shot-flow-v1', imageModel: 'Nano Banana 2',
      videoModel: 'Veo 3.1 Lite', generationDurationSec: 6,
    });
    expect(asset?.task?.flow?.negativeGuidance).toContain('fabricated evidence');
    expect(asset?.status).toBe('PLANNED');

    store.setFlowWatchDirectory(projectId, importDirectory);
    const downloadedImage = path.join(importDirectory, 'flow-shot-flow-v1-result.png');
    writeFileSync(downloadedImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    let flowWorkspace = await store.scanFlowCandidates(projectId);
    expect(flowWorkspace.candidates).toHaveLength(1);
    expect(flowWorkspace.candidates[0]).toMatchObject({status: 'DETECTED', suggestedShotId: 'shot-flow', kind: 'IMAGE'});
    flowWorkspace = await store.scanFlowCandidates(projectId);
    expect(flowWorkspace.candidates).toHaveLength(1);
    expect(existsSync(downloadedImage)).toBe(true);

    storyboard = store.updateAssetStatus(projectId, asset?.id ?? '', {status: 'AWAITING_HUMAN'});
    expect(storyboard.assets[0]?.status).toBe('AWAITING_HUMAN');
    storyboard = await store.selectFlowCandidate(projectId, flowWorkspace.candidates[0]?.id ?? '', asset?.id ?? '');
    expect(storyboard.assets[0]).toMatchObject({
      status: 'SELECTED',
      generation: {provider: 'GOOGLE_FLOW', promptVersion: 1, model: 'Nano Banana 2', sourceFileName: 'flow-shot-flow-v1-result.png'},
    });
    expect(storyboard.assets[0]?.status).not.toBe('QA_PASS');
    expect(store.getFlowWorkspace(projectId).candidates[0]?.status).toBe('SELECTED');
    expect(existsSync(downloadedImage)).toBe(true);
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
    expect(store.queueRender(projectId, 'ROUGH').jobs).toHaveLength(1);
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

  it('runs idempotent media jobs with isolated retry, cancellation, atomic output, and crash recovery', () => {
    const store = createStore();
    const created = store.createProject({title: 'Job Recovery', question: 'Can local work resume safely?'});
    const sourceRelative = 'assets/source.mp4';
    writeFileSync(path.join(created.project.rootPath, sourceRelative), 'media-placeholder', 'utf8');

    let review = store.queueMediaJob(created.project.id, {type: 'PROBE', sourcePath: sourceRelative});
    const probeId = review.jobs[0]?.id ?? '';
    review = store.queueMediaJob(created.project.id, {type: 'PROBE', sourcePath: sourceRelative});
    expect(review.jobs.filter(({type}) => type === 'PROBE')).toHaveLength(1);
    const probe = store.claimNextJob();
    expect(probe).toMatchObject({id: probeId, type: 'PROBE', attempt: 1});
    writeFileSync(probe?.tempOutputPath ?? '', '{"streams":[]}', 'utf8');
    store.updateJobProgress(probeId, 0.75);
    store.completeJob(probeId);
    expect(store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === probeId)).toMatchObject({
      status: 'COMPLETED', progress: 1, outputPath: `renders/jobs/${probeId}.txt`,
    });

    review = store.queueMediaJob(created.project.id, {type: 'PROXY', sourcePath: sourceRelative, scope: 'scene-one'});
    const proxyId = review.jobs.find(({type}) => type === 'PROXY')?.id ?? '';
    const firstAttempt = store.claimNextJob();
    writeFileSync(firstAttempt?.tempOutputPath ?? '', 'partial', 'utf8');
    store.failJob(proxyId, 'Encoder stopped.', true);
    expect(existsSync(firstAttempt?.tempOutputPath ?? '')).toBe(false);
    expect(store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === proxyId)?.status).toBe('RETRYABLE_FAILED');
    store.retryJob(created.project.id, proxyId);
    const secondAttempt = store.claimNextJob();
    expect(secondAttempt).toMatchObject({id: proxyId, attempt: 2, scope: 'scene-one'});
    store.requestJobCancellation(created.project.id, proxyId);
    store.markJobCancelled(proxyId);
    expect(store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === proxyId)?.status).toBe('CANCELLED');

    store.queueMediaJob(created.project.id, {type: 'POST_PROCESS', sourcePath: sourceRelative});
    const interrupted = store.claimNextJob();
    writeFileSync(interrupted?.tempOutputPath ?? '', 'partial', 'utf8');
    expect(store.recoverInterruptedJobs()).toBe(1);
    expect(existsSync(interrupted?.tempOutputPath ?? '')).toBe(false);
    const recovered = store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === interrupted?.id);
    expect(recovered).toMatchObject({status: 'RETRYABLE_FAILED', errorMessage: expect.stringContaining('stopped')});
  });

  it('executes a real local ffprobe job through the worker', async () => {
    const store = createStore();
    const created = store.createProject({title: 'Worker Probe', question: 'Does the local worker execute media tools?'});
    const sourceRelative = 'assets/probe.wav';
    writeFileSync(path.join(created.project.rootPath, sourceRelative), silentWav(0.25));
    const queued = store.queueMediaJob(created.project.id, {type: 'PROBE', sourcePath: sourceRelative});
    const jobId = queued.jobs[0]?.id ?? '';
    const runner = new LocalJobRunner(store, path.resolve(import.meta.dirname, '../../..'));
    runner.start();
    let job = store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === jobId);
    const deadline = Date.now() + 10_000;
    while (job?.status === 'QUEUED' || job?.status === 'RUNNING') {
      if (Date.now() > deadline) throw new Error('Timed out waiting for local probe job.');
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = store.getReviewWorkspace(created.project.id).jobs.find(({id}) => id === jobId);
    }
    runner.stop();
    expect(job).toMatchObject({status: 'COMPLETED', progress: 1});
    expect(readFileSync(path.join(created.project.rootPath, job?.outputPath ?? ''), 'utf8')).toContain('"streams"');
    expect(job?.log).toContain('Starting attempt 1');
  });

  it.runIf(process.env.NARRA_RENDER_SMOKE === '1')('renders a real one-second snapshot through the local worker', async () => {
    const store = createStore();
    const created = store.createProject({title: 'Worker Render', question: 'Does the local render worker produce a video?'});
    const projectId = created.project.id;
    const importDirectory = mkdtempSync(path.join(tmpdir(), 'narra-render-smoke-import-'));
    temporaryDirectories.push(importDirectory);
    const scenesPath = path.join(importDirectory, 'scenes.json');
    const shotsPath = path.join(importDirectory, 'shots.json');
    writeFileSync(scenesPath, JSON.stringify([{
      id: 'scene-one', projectId, order: 0, title: 'Smoke', narration: 'Local render.', durationSec: 1, claimIds: [],
    }]), 'utf8');
    writeFileSync(shotsPath, JSON.stringify([{
      id: 'shot-one', projectId, sceneId: 'scene-one', order: 0, durationSec: 1,
      visualType: 'TEXT', visualPurpose: 'Verify local render', assetRoute: 'NONE', claimIds: [],
    }]), 'utf8');
    store.importStoryboard(projectId, scenesPath, shotsPath);
    store.saveEditorialDocument(projectId, 'THESIS', 'A local worker can render an immutable snapshot.');
    store.saveEditorialDocument(projectId, 'SCRIPT', '# Smoke\n\nLocal render.');
    for (const gate of ['TOPIC', 'THESIS', 'SCRIPT', 'STORYBOARD', 'ASSETS'] as const) store.approveGate(projectId, gate, 'Render smoke.');
    const queued = store.queueRender(projectId, 'ROUGH');
    const jobId = queued.jobs[0]?.id ?? '';
    const runner = new LocalJobRunner(store, path.resolve(import.meta.dirname, '../../..'));
    runner.start();
    let job = store.getReviewWorkspace(projectId).jobs.find(({id}) => id === jobId);
    const deadline = Date.now() + 90_000;
    while (job?.status === 'QUEUED' || job?.status === 'RUNNING') {
      if (Date.now() > deadline) throw new Error('Timed out waiting for local render job.');
      await new Promise((resolve) => setTimeout(resolve, 250));
      job = store.getReviewWorkspace(projectId).jobs.find(({id}) => id === jobId);
    }
    runner.stop();
    if (job?.status !== 'COMPLETED') throw new Error(`Render smoke failed: ${job?.errorMessage ?? 'unknown'}\n${job?.log ?? ''}`);
    expect(job).toMatchObject({status: 'COMPLETED', progress: 1, outputPath: 'renders/rough/render-v1.mp4'});
    expect(existsSync(path.join(created.project.rootPath, job?.outputPath ?? ''))).toBe(true);
  }, 90_000);
});
