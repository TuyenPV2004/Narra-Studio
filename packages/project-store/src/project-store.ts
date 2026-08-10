import {
  AiProjectSettingsSchema,
  AiRunCollectionSchema,
  AiRunSchema,
  AiSearchActivityCollectionSchema,
  AiSourceCardCollectionSchema,
  AiWorkspaceBundleSchema,
  AssetCollectionSchema,
  AssetSchema,
  CaptionCollectionSchema,
  CaptionCueSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  ProjectBundleSchema,
  ProjectSchema,
  NarrationSegmentCollectionSchema,
  NarrationSegmentSchema,
  OutlineSectionCollectionSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
  ThesisSchema,
  ThesisCandidateCollectionSchema,
  TopicCandidateCollectionSchema,
  type Asset,
  type AiProjectSettings,
  type AiRun,
  type CaptionCue,
  type NarrationSegment,
  type Project,
  type ShotCollection,
} from '@narra/contracts';
import {createHash, randomUUID} from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {
  COLLECTION_ARTIFACTS,
  CURRENT_ARTIFACT_SCHEMA_VERSION,
  JSON_ARTIFACTS,
  OBJECT_ARTIFACTS,
  PROJECT_DIRECTORIES,
  UPDATE_V1_ARTIFACT_PATHS,
} from './artifact-layout.js';
import {openWorkspaceDatabase} from './database.js';
import {compareNarrationTranscript, parseTimedText, parseWordTimestamps} from './caption-parser.js';
import type {
  ApprovalGate,
  ApprovalRecord,
  CreateProjectInput,
  AssetStatusInput,
  CreateAssetTaskInput,
  EditorialDocument,
  EditorialWorkspace,
  ProjectDetail,
  ProjectRecord,
  RenderJobRecord,
  JobExecution,
  QueueMediaJobInput,
  RenderTarget,
  ReviewWorkspace,
  StaleScope,
  StoryboardWorkspace,
  ValidationIssue,
  ValidationReport,
  VoiceWorkspace,
  AiWorkspace,
  CreateAiRunInput,
  UpdateAiRunInput,
} from './types.js';

type ProjectRow = {
  id: string;
  title: string;
  question: string;
  status: Project['status'];
  root_path: string;
  target_duration_sec: number;
  language: string;
  aspect_ratio: Project['aspectRatio'];
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  archived: number;
  validation_status: ValidationReport['status'] | null;
  validation_checked_at: string | null;
  validation_issues_json: string | null;
};

const isoNow = (): string => new Date().toISOString();
const toPortablePath = (value: string): string => value.split(path.sep).join('/');
const APPROVAL_GATES: ApprovalGate[] = ['TOPIC', 'THESIS', 'SCRIPT', 'STORYBOARD', 'ASSETS', 'ROUGH_CUT', 'FINAL'];

type ApprovalRow = {
  id: string;
  project_id: string;
  gate: ApprovalGate;
  status: ApprovalRecord['status'];
  artifact_version: number;
  approved_at: string | null;
  note: string | null;
};

type JobRow = {
  id: string;
  project_id: string;
  type: RenderJobRecord['type'];
  status: RenderJobRecord['status'];
  input_snapshot_path: string;
  version: number;
  target: RenderTarget;
  log_path: string | null;
  output_path: string | null;
  temp_output_path: string | null;
  attempt: number;
  progress: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  cancel_requested: number;
  scope: string;
  command_json: string | null;
  created_at: string;
  updated_at: string;
};

const atomicWriteJson = (filePath: string, value: unknown): void => {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
};

const atomicWriteText = (filePath: string, value: string): void => {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, value, 'utf8');
  renameSync(temporaryPath, filePath);
};

const contentHash = (content: string): string =>
  createHash('sha256').update(content).digest('hex');

const parseJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

const defaultObjectArtifact = (artifactPath: string, projectId: string, updatedAt: string): unknown => {
  if (artifactPath === 'ai/settings.json') {
    return {
      schemaVersion: 1,
      projectId,
      updatedAt,
      desiredModel: 'gpt-5.6-sol',
      desiredEffort: 'medium',
      threadId: null,
      lastStage: null,
      lastTurnId: null,
      lastConnectionStatus: 'UNKNOWN',
    };
  }
  throw new Error(`No default object artifact is registered for ${artifactPath}.`);
};

const replaceProjectId = (value: unknown, previousId: string, nextId: string): unknown => {
  if (value === previousId) return nextId;
  if (Array.isArray(value)) return value.map((item) => replaceProjectId(item, previousId, nextId));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceProjectId(item, previousId, nextId)]),
    );
  }
  return value;
};

const makeProjectId = (title: string): string => {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'project';
  return `${slug}-${randomUUID().slice(0, 8)}`;
};

const mapRow = (row: ProjectRow): ProjectRecord => ({
  schemaVersion: 1,
  id: row.id,
  title: row.title,
  question: row.question,
  status: row.status,
  targetDurationSec: row.target_duration_sec,
  language: row.language,
  aspectRatio: row.aspect_ratio,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  rootPath: row.root_path,
  archived: row.archived === 1,
  lastOpenedAt: row.last_opened_at,
  validation:
    row.validation_status && row.validation_checked_at
      ? {
          status: row.validation_status,
          checkedAt: row.validation_checked_at,
          issues: row.validation_issues_json
            ? (JSON.parse(row.validation_issues_json) as ValidationIssue[])
            : [],
        }
      : null,
});

export class ProjectStore {
  readonly workspaceRoot: string;
  readonly database: DatabaseSync;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    mkdirSync(this.workspaceRoot, {recursive: true});
    this.database = openWorkspaceDatabase(this.workspaceRoot);
  }

  close(): void {
    this.database.close();
  }

  listProjects(): ProjectRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM projects ORDER BY archived ASC, updated_at DESC')
      .all() as ProjectRow[];
    return rows.map(mapRow);
  }

  getProject(projectId: string): ProjectDetail {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
      | ProjectRow
      | undefined;
    if (!row) throw new Error(`Project ${projectId} is not registered in this workspace.`);

    const versions = this.database
      .prepare(
        `SELECT artifact_path, schema_version, content_hash, updated_at, stale
         FROM artifact_versions WHERE project_id = ? ORDER BY artifact_path`,
      )
      .all(projectId) as Array<{
      artifact_path: string;
      schema_version: number;
      content_hash: string;
      updated_at: string;
      stale: number;
    }>;

    return {
      project: mapRow(row),
      artifactVersions: versions.map((version) => ({
        path: version.artifact_path,
        schemaVersion: version.schema_version,
        contentHash: version.content_hash,
        updatedAt: version.updated_at,
        stale: version.stale === 1,
      })),
    };
  }

  getAiProjectSettings(projectId: string): AiProjectSettings {
    const project = this.getProject(projectId).project;
    return AiProjectSettingsSchema.parse(parseJson(path.join(project.rootPath, 'ai/settings.json')));
  }

  updateAiProjectSettings(
    projectId: string,
    input: Partial<Pick<AiProjectSettings,
      'desiredModel' | 'desiredEffort' | 'threadId' | 'lastStage' | 'lastTurnId' | 'lastConnectionStatus'>>,
  ): AiProjectSettings {
    const project = this.getProject(projectId).project;
    const current = this.getAiProjectSettings(projectId);
    const next = AiProjectSettingsSchema.parse({...current, ...input, updatedAt: isoNow()});
    atomicWriteJson(path.join(project.rootPath, 'ai/settings.json'), next);
    this.refreshProject(projectId);
    return next;
  }

  getAiWorkspace(projectId: string): AiWorkspace {
    const project = this.getProject(projectId).project;
    const runs = AiRunCollectionSchema.parse(parseJson(path.join(project.rootPath, 'ai/runs.json')));
    return {
      projectId,
      settings: this.getAiProjectSettings(projectId),
      runs: [...runs.items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  createAiRun(projectId: string, input: CreateAiRunInput): AiRun {
    const project = this.getProject(projectId).project;
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('AI run prompt cannot be empty.');
    const filePath = path.join(project.rootPath, 'ai/runs.json');
    const collection = AiRunCollectionSchema.parse(parseJson(filePath));
    const settings = this.getAiProjectSettings(projectId);
    const now = isoNow();
    const run = AiRunSchema.parse({
      id: `run-${randomUUID()}`,
      projectId,
      stage: input.stage,
      prompt,
      status: 'QUEUED',
      requestedModel: settings.desiredModel,
      requestedEffort: settings.desiredEffort,
      threadId: settings.threadId,
      turnId: null,
      updatedAt: now,
      error: null,
      usage: null,
    });
    atomicWriteJson(filePath, {...collection, updatedAt: now, items: [...collection.items, run]});
    this.refreshProject(projectId);
    return run;
  }

  updateAiRun(projectId: string, runId: string, input: UpdateAiRunInput): AiRun {
    const project = this.getProject(projectId).project;
    const filePath = path.join(project.rootPath, 'ai/runs.json');
    const collection = AiRunCollectionSchema.parse(parseJson(filePath));
    const index = collection.items.findIndex(({id}) => id === runId);
    if (index < 0) throw new Error(`AI run ${runId} was not found.`);
    const now = isoNow();
    const current = collection.items[index]!;
    const next = AiRunSchema.parse({...current, ...input, updatedAt: now});
    const items = [...collection.items];
    items[index] = next;
    atomicWriteJson(filePath, {...collection, updatedAt: now, items});
    this.refreshProject(projectId);
    return next;
  }

  createProject(input: CreateProjectInput): ProjectDetail {
    const now = isoNow();
    const project: Project = {
      schemaVersion: 1,
      id: makeProjectId(input.title),
      title: input.title.trim(),
      question: input.question.trim(),
      status: 'NEW',
      targetDurationSec: input.targetDurationSec ?? 480,
      language: input.language ?? 'en',
      aspectRatio: input.aspectRatio ?? '16:9',
      createdAt: now,
      updatedAt: now,
    };
    const parsed = ProjectSchema.safeParse(project);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const projectRoot = path.join(this.workspaceRoot, project.id);
    if (existsSync(projectRoot)) throw new Error(`Project directory already exists: ${projectRoot}`);
    mkdirSync(projectRoot);
    for (const directory of PROJECT_DIRECTORIES) {
      mkdirSync(path.join(projectRoot, directory), {recursive: true});
    }
    atomicWriteJson(path.join(projectRoot, 'project.json'), project);
    for (const artifact of COLLECTION_ARTIFACTS) {
      atomicWriteJson(path.join(projectRoot, artifact.path), {
        schemaVersion: CURRENT_ARTIFACT_SCHEMA_VERSION,
        projectId: project.id,
        updatedAt: now,
        items: [],
      });
    }
    for (const artifact of OBJECT_ARTIFACTS) {
      atomicWriteJson(path.join(projectRoot, artifact.path), defaultObjectArtifact(artifact.path, project.id, now));
    }
    writeFileSync(path.join(projectRoot, 'research/research_packet.md'), '', 'utf8');
    atomicWriteJson(path.join(projectRoot, 'thesis/thesis.json'), {schemaVersion: 1, projectId: project.id, updatedAt: now, statement: ''});
    writeFileSync(path.join(projectRoot, 'script/script_v1.md'), '', 'utf8');

    this.upsertProject(project, projectRoot, false);
    return this.refreshProject(project.id);
  }

  openProjectDirectory(projectRoot: string): ProjectDetail {
    const resolvedRoot = path.resolve(projectRoot);
    const projectFile = path.join(resolvedRoot, 'project.json');
    if (!existsSync(projectFile)) throw new Error(`No project.json found in ${resolvedRoot}.`);
    const parsed = ProjectSchema.safeParse(parseJson(projectFile));
    if (!parsed.success) {
      throw new Error(
        `Cannot open project.json: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    this.upsertProject(parsed.data, resolvedRoot, false);
    const openedAt = isoNow();
    this.database.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(openedAt, parsed.data.id);
    return this.refreshProject(parsed.data.id);
  }

  duplicateProject(projectId: string): ProjectDetail {
    const source = this.getProject(projectId).project;
    const nextId = makeProjectId(`${source.title} copy`);
    const destination = path.join(this.workspaceRoot, nextId);
    cpSync(source.rootPath, destination, {recursive: true, errorOnExist: true});

    const now = isoNow();
    this.rewriteJsonTree(destination, source.id, nextId, now);
    const projectFile = path.join(destination, 'project.json');
    const duplicated = ProjectSchema.parse(parseJson(projectFile));
    const nextProject = {
      ...duplicated,
      id: nextId,
      title: `${source.title} (Copy)`,
      status: 'NEW' as const,
      createdAt: now,
      updatedAt: now,
    };
    atomicWriteJson(projectFile, nextProject);
    this.upsertProject(nextProject, destination, false);
    return this.refreshProject(nextId);
  }

  archiveProject(projectId: string): ProjectRecord {
    const now = isoNow();
    const result = this.database
      .prepare('UPDATE projects SET archived = 1, updated_at = ? WHERE id = ?')
      .run(now, projectId);
    if (result.changes !== 1) throw new Error(`Project ${projectId} was not found.`);
    return this.getProject(projectId).project;
  }

  refreshProject(projectId: string): ProjectDetail {
    const record = this.getProject(projectId).project;
    this.ensureUpdateV1Artifacts(record.rootPath, projectId);
    this.ensurePhase4Artifacts(record.rootPath, projectId);
    this.ensurePhase5Artifacts(record.rootPath);
    const report = this.validateProjectDirectory(record.rootPath, projectId);
    this.database
      .prepare(
        `UPDATE projects
         SET validation_status = ?, validation_checked_at = ?, validation_issues_json = ?
         WHERE id = ?`,
      )
      .run(report.status, report.checkedAt, JSON.stringify(report.issues), projectId);
    return this.getProject(projectId);
  }

  getStoryboardWorkspace(projectId: string): StoryboardWorkspace {
    const project = this.getProject(projectId).project;
    this.ensureStaleScopes(projectId);
    const scenes = SceneCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/scenes.json')));
    const shots = ShotCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/shots.json')));
    const assets = AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json')));
    const staleRows = this.database
      .prepare('SELECT scope, stale, reason, updated_at FROM stale_scopes WHERE project_id = ? ORDER BY scope')
      .all(projectId) as Array<{scope: StaleScope['scope']; stale: number; reason: string | null; updated_at: string}>;

    return {
      projectId,
      scenes: [...scenes.items].sort((left, right) => left.order - right.order),
      shots: [...shots.items].sort((left, right) => left.order - right.order),
      assets: assets.items,
      staleScopes: staleRows.map((row) => ({
        scope: row.scope,
        stale: row.stale === 1,
        reason: row.reason,
        updatedAt: row.updated_at,
      })),
    };
  }

  importStoryboard(projectId: string, scenesFilePath: string, shotsFilePath: string): StoryboardWorkspace {
    const project = this.getProject(projectId).project;
    const now = isoNow();
    const sceneValue = parseJson(scenesFilePath);
    const shotValue = parseJson(shotsFilePath);
    const scenes = SceneCollectionSchema.parse(
      Array.isArray(sceneValue)
        ? {schemaVersion: 1, projectId, updatedAt: now, items: sceneValue}
        : sceneValue,
    );
    const shots = ShotCollectionSchema.parse(
      Array.isArray(shotValue)
        ? {schemaVersion: 1, projectId, updatedAt: now, items: shotValue}
        : shotValue,
    );

    this.assertCollectionProjectIds(projectId, scenes.items, 'scene');
    this.assertCollectionProjectIds(projectId, shots.items, 'shot');
    const sceneIds = new Set(scenes.items.map(({id}) => id));
    const duplicateSceneIds = scenes.items.filter((scene, index) => scenes.items.findIndex(({id}) => id === scene.id) !== index);
    const duplicateShotIds = shots.items.filter((shot, index) => shots.items.findIndex(({id}) => id === shot.id) !== index);
    if (duplicateSceneIds[0]) throw new Error(`Duplicate scene id ${duplicateSceneIds[0].id}.`);
    if (duplicateShotIds[0]) throw new Error(`Duplicate shot id ${duplicateShotIds[0].id}.`);
    for (const shot of shots.items) {
      if (!sceneIds.has(shot.sceneId)) throw new Error(`Shot ${shot.id} references unknown scene ${shot.sceneId}.`);
    }

    const assets = AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json')));
    const assetIds = new Set(assets.items.map(({id}) => id));
    for (const shot of shots.items) {
      if (shot.assetId && !assetIds.has(shot.assetId)) {
        throw new Error(`Shot ${shot.id} references unknown asset ${shot.assetId}; import the manifest first or omit assetId.`);
      }
    }

    atomicWriteJson(path.join(project.rootPath, 'storyboard/scenes.json'), {...scenes, updatedAt: now});
    atomicWriteJson(path.join(project.rootPath, 'storyboard/shots.json'), {...shots, updatedAt: now});
    this.refreshProject(projectId);
    this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], 'Storyboard changed');
    this.database
      .prepare("UPDATE artifact_versions SET stale = 1 WHERE project_id = ? AND artifact_path = 'assets/manifest.json'")
      .run(projectId);
    return this.getStoryboardWorkspace(projectId);
  }

  createAssetTask(projectId: string, input: CreateAssetTaskInput): StoryboardWorkspace {
    const project = this.getProject(projectId).project;
    const now = isoNow();
    const shotsPath = path.join(project.rootPath, 'storyboard/shots.json');
    const assetsPath = path.join(project.rootPath, 'assets/manifest.json');
    const shots = ShotCollectionSchema.parse(parseJson(shotsPath));
    const assets = AssetCollectionSchema.parse(parseJson(assetsPath));
    const shotIndex = shots.items.findIndex(({id}) => id === input.shotId);
    if (shotIndex === -1) throw new Error(`Shot ${input.shotId} was not found.`);
    const shot = shots.items[shotIndex];
    if (!shot) throw new Error(`Shot ${input.shotId} was not found.`);
    if (shot.assetId && assets.items.some(({id}) => id === shot.assetId)) {
      throw new Error(`Shot ${shot.id} already has asset task ${shot.assetId}.`);
    }

    const asset: Asset = {
      id: `asset-${shot.id}-${randomUUID().slice(0, 6)}`,
      projectId,
      shotId: shot.id,
      kind: input.kind,
      status: 'PLANNED',
      rightsNote: input.rightsNote.trim(),
      task: {
        provider: input.provider,
        brief: input.brief.trim(),
        prompt: input.prompt.trim(),
        negativePrompt: input.negativePrompt?.trim() || undefined,
        createdAt: now,
      },
    };
    const parsedAsset = AssetSchema.parse(asset);
    const nextShots: ShotCollection = {
      ...shots,
      updatedAt: now,
      items: shots.items.map((item, index) => index === shotIndex ? {...item, assetId: parsedAsset.id} : item),
    };
    atomicWriteJson(shotsPath, nextShots);
    atomicWriteJson(assetsPath, {...assets, updatedAt: now, items: [...assets.items, parsedAsset]});
    this.refreshProject(projectId);
    this.markScopes(projectId, ['ASSETS', 'RENDER'], 'Asset task changed');
    return this.getStoryboardWorkspace(projectId);
  }

  updateAssetStatus(projectId: string, assetId: string, input: AssetStatusInput): StoryboardWorkspace {
    const project = this.getProject(projectId).project;
    const assetsPath = path.join(project.rootPath, 'assets/manifest.json');
    const assets = AssetCollectionSchema.parse(parseJson(assetsPath));
    const assetIndex = assets.items.findIndex(({id}) => id === assetId);
    if (assetIndex === -1) throw new Error(`Asset ${assetId} was not found.`);
    const asset = assets.items[assetIndex];
    if (!asset) throw new Error(`Asset ${assetId} was not found.`);
    if (asset.status !== input.status) this.assertAssetTransition(asset.status, input.status);
    if (input.status === 'QA_PASS') this.assertAssetReadyForQa(project.rootPath, asset);

    const now = isoNow();
    const nextAsset = {...asset, status: input.status, qaNote: input.qaNote?.trim() || asset.qaNote};
    atomicWriteJson(assetsPath, {
      ...assets,
      updatedAt: now,
      items: assets.items.map((item, index) => index === assetIndex ? nextAsset : item),
    });
    this.refreshProject(projectId);
    this.markScopes(projectId, ['RENDER'], `Asset ${assetId} changed to ${input.status}`);
    this.syncAssetScope(projectId);
    return this.getStoryboardWorkspace(projectId);
  }

  async importAssetMedia(projectId: string, assetId: string, sourcePath: string): Promise<StoryboardWorkspace> {
    const project = this.getProject(projectId).project;
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`Media file was not found: ${sourcePath}`);
    const assetsPath = path.join(project.rootPath, 'assets/manifest.json');
    const assets = AssetCollectionSchema.parse(parseJson(assetsPath));
    const assetIndex = assets.items.findIndex(({id}) => id === assetId);
    if (assetIndex === -1) throw new Error(`Asset ${assetId} was not found.`);
    const asset = assets.items[assetIndex];
    if (!asset || (asset.kind !== 'IMAGE' && asset.kind !== 'VIDEO')) {
      throw new Error(`Asset ${assetId} does not accept image or video media.`);
    }
    if (!['AWAITING_HUMAN', 'IMPORTED', 'SELECTED', 'QA_FAIL', 'QA_PASS'].includes(asset.status)) {
      throw new Error(`Asset ${assetId} must be AWAITING_HUMAN before media can be imported.`);
    }

    const {probeMedia} = await import('./media-probe.js');
    const metadata = await probeMedia(sourcePath, asset.kind);
    const extension = path.extname(sourcePath).toLowerCase();
    const destinationDirectory = asset.kind === 'IMAGE' ? 'assets/images' : 'assets/videos';
    const relativePath = `${destinationDirectory}/${asset.id}-${Date.now()}${extension}`;
    const destinationPath = path.join(project.rootPath, ...relativePath.split('/'));
    copyFileSync(sourcePath, destinationPath);

    const now = isoNow();
    const nextAsset: Asset = {...asset, status: 'IMPORTED', path: relativePath, metadata};
    atomicWriteJson(assetsPath, {
      ...assets,
      updatedAt: now,
      items: assets.items.map((item, index) => index === assetIndex ? nextAsset : item),
    });
    this.refreshProject(projectId);
    this.markScopes(projectId, ['ASSETS', 'RENDER'], `Media imported for ${assetId}`);
    return this.getStoryboardWorkspace(projectId);
  }

  getAssetFilePath(projectId: string, assetId: string): string {
    const project = this.getProject(projectId).project;
    const assets = AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json')));
    const asset = assets.items.find(({id}) => id === assetId);
    if (!asset?.path) throw new Error(`Asset ${assetId} has no imported media.`);
    const resolved = path.resolve(project.rootPath, ...asset.path.split('/'));
    const projectPrefix = `${path.resolve(project.rootPath)}${path.sep}`;
    if (!resolved.startsWith(projectPrefix)) throw new Error(`Asset ${assetId} points outside its project.`);
    if (!existsSync(resolved)) throw new Error(`Asset media is missing: ${asset.path}`);
    return resolved;
  }

  getVoiceWorkspace(projectId: string): VoiceWorkspace {
    const project = this.getProject(projectId).project;
    this.ensurePhase4Artifacts(project.rootPath, projectId);
    this.ensureStaleScopes(projectId);
    const segments = NarrationSegmentCollectionSchema.parse(
      parseJson(path.join(project.rootPath, 'audio/narration/segments.json')),
    ).items;
    const captions = CaptionCollectionSchema.parse(
      parseJson(path.join(project.rootPath, 'captions/captions.json')),
    ).items;
    const staleRows = this.database
      .prepare('SELECT scope, stale, reason, updated_at FROM stale_scopes WHERE project_id = ? ORDER BY scope')
      .all(projectId) as Array<{scope: StaleScope['scope']; stale: number; reason: string | null; updated_at: string}>;
    return {
      projectId,
      segments: [...segments].sort((left, right) => left.order - right.order),
      captions,
      qaIssues: compareNarrationTranscript(segments, captions),
      timelineWarnings: this.getTimelineWarnings(project.rootPath, segments),
      staleScopes: staleRows.map((row) => ({
        scope: row.scope,
        stale: row.stale === 1,
        reason: row.reason,
        updatedAt: row.updated_at,
      })),
    };
  }

  syncNarrationSegments(projectId: string): VoiceWorkspace {
    const project = this.getProject(projectId).project;
    const now = isoNow();
    const scenes = SceneCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/scenes.json'))).items;
    if (scenes.length === 0) throw new Error('Import a storyboard before creating narration segments.');
    const segmentsPath = path.join(project.rootPath, 'audio/narration/segments.json');
    const collection = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
    const existingByScene = new Map(collection.items.map((segment) => [segment.sceneId, segment]));
    const segments = [...scenes]
      .sort((left, right) => left.order - right.order)
      .map((scene, order) => {
        const existing = existingByScene.get(scene.id);
        return NarrationSegmentSchema.parse({
          id: existing?.id ?? `vo-${scene.id}`,
          projectId,
          sceneId: scene.id,
          order,
          text: scene.narration,
          plannedDurationSec: existing?.plannedDurationSec ?? scene.durationSec,
          durationSec: existing?.durationSec,
          audioPath: existing?.audioPath,
          audioMetadata: existing?.audioMetadata,
          status: existing?.audioPath && existing.text !== scene.narration ? 'NEEDS_REVIEW' : existing?.status ?? 'PLANNED',
          version: existing?.version ?? 1,
          pronunciationNotes: existing?.pronunciationNotes,
        });
      });
    atomicWriteJson(segmentsPath, {...collection, updatedAt: now, items: segments});
    this.refreshProject(projectId);
    this.syncAudioScope(projectId, segments);
    this.markScopes(projectId, ['CAPTIONS', 'RENDER'], 'Narration segments changed');
    return this.getVoiceWorkspace(projectId);
  }

  async importNarrationAudio(projectId: string, segmentId: string, sourcePath: string): Promise<VoiceWorkspace> {
    const project = this.getProject(projectId).project;
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`Audio file was not found: ${sourcePath}`);
    const segmentsPath = path.join(project.rootPath, 'audio/narration/segments.json');
    const collection = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
    const index = collection.items.findIndex(({id}) => id === segmentId);
    const segment = collection.items[index];
    if (!segment) throw new Error(`Narration segment ${segmentId} was not found.`);
    const {probeMedia} = await import('./media-probe.js');
    const metadata = await probeMedia(sourcePath, 'AUDIO');
    if (!metadata.durationSec || metadata.durationSec <= 0) throw new Error(`Audio duration could not be read for ${path.basename(sourcePath)}.`);
    const version = segment.audioPath ? segment.version + 1 : segment.version;
    const extension = path.extname(sourcePath).toLowerCase();
    const relativePath = `audio/narration/${segment.id}-v${version}${extension}`;
    copyFileSync(sourcePath, path.join(project.rootPath, ...relativePath.split('/')));
    const next = NarrationSegmentSchema.parse({
      ...segment,
      version,
      audioPath: relativePath,
      audioMetadata: metadata,
      durationSec: metadata.durationSec,
      status: 'IMPORTED',
    });
    this.retimeCaptionsForSegment(project.rootPath, collection.items, segment, metadata.durationSec);
    atomicWriteJson(segmentsPath, {
      ...collection,
      updatedAt: isoNow(),
      items: collection.items.map((item, itemIndex) => itemIndex === index ? next : item),
    });
    this.refreshProject(projectId);
    this.syncAudioScope(projectId);
    this.markScopes(projectId, ['CAPTIONS', 'RENDER'], `Narration segment ${segmentId} audio changed`);
    return this.getVoiceWorkspace(projectId);
  }

  importCaptions(projectId: string, sourcePath: string): VoiceWorkspace {
    const project = this.getProject(projectId).project;
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`Caption file was not found: ${sourcePath}`);
    const extension = path.extname(sourcePath).toLowerCase();
    const raw = readFileSync(sourcePath, 'utf8');
    let captions: CaptionCue[];
    let segmentTimebase = false;
    if (extension === '.srt' || extension === '.vtt') {
      captions = parseTimedText(raw, projectId);
    } else if (extension === '.json') {
      const value = JSON.parse(raw) as unknown;
      segmentTimebase = Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'timebase' in value && (value as {timebase?: unknown}).timebase === 'segment');
      const wrapped = CaptionCollectionSchema.safeParse(value);
      if (wrapped.success) {
        captions = wrapped.data.items;
      } else {
        const direct = CaptionCollectionSchema.safeParse({schemaVersion: 1, projectId, updatedAt: isoNow(), items: value});
        captions = direct.success ? direct.data.items : parseWordTimestamps(value, projectId);
      }
    } else {
      throw new Error('Caption import supports .srt, .vtt and word timestamp .json files.');
    }

    const segmentsPath = path.join(project.rootPath, 'audio/narration/segments.json');
    const segmentCollection = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
    if (segmentTimebase) captions = this.offsetSegmentCaptions(captions, segmentCollection.items);
    const collectionPath = path.join(project.rootPath, 'captions/captions.json');
    const current = CaptionCollectionSchema.parse(parseJson(collectionPath));
    const parsedCaptions = captions.map((caption, index) => CaptionCueSchema.parse({
      ...caption,
      id: `caption-${index + 1}`,
      projectId,
    }));
    atomicWriteJson(collectionPath, {...current, updatedAt: isoNow(), items: parsedCaptions});

    const issues = compareNarrationTranscript(segmentCollection.items, parsedCaptions);
    const issueIds = new Set(issues.map(({segmentId}) => segmentId));
    atomicWriteJson(segmentsPath, {
      ...segmentCollection,
      updatedAt: isoNow(),
      items: segmentCollection.items.map((segment) => ({
        ...segment,
        status: issueIds.has(segment.id) ? 'NEEDS_REVIEW' : segment.audioPath ? 'READY' : segment.status,
      })),
    });
    this.refreshProject(projectId);
    this.setScope(projectId, 'CAPTIONS', false, null);
    this.markScopes(projectId, ['RENDER'], 'Captions changed');
    return this.getVoiceWorkspace(projectId);
  }

  fitTimelineToNarration(projectId: string): VoiceWorkspace {
    const project = this.getProject(projectId).project;
    const segments = NarrationSegmentCollectionSchema.parse(
      parseJson(path.join(project.rootPath, 'audio/narration/segments.json')),
    ).items;
    if (segments.length === 0 || segments.some(({durationSec}) => !durationSec)) {
      throw new Error('Every narration segment needs imported audio before fitting the timeline.');
    }
    const scenesPath = path.join(project.rootPath, 'storyboard/scenes.json');
    const shotsPath = path.join(project.rootPath, 'storyboard/shots.json');
    const scenes = SceneCollectionSchema.parse(parseJson(scenesPath));
    const shots = ShotCollectionSchema.parse(parseJson(shotsPath));
    const durationByScene = new Map<string, number>();
    for (const segment of segments) durationByScene.set(segment.sceneId, (durationByScene.get(segment.sceneId) ?? 0) + (segment.durationSec ?? 0));
    const nextScenes = scenes.items.map((scene) => ({...scene, durationSec: durationByScene.get(scene.id) ?? scene.durationSec}));
    const nextShots = shots.items.map((shot) => {
      const sceneShots = shots.items.filter(({sceneId}) => sceneId === shot.sceneId);
      const previousTotal = sceneShots.reduce((total, item) => total + item.durationSec, 0);
      const target = durationByScene.get(shot.sceneId);
      return target && previousTotal > 0 ? {...shot, durationSec: shot.durationSec * target / previousTotal} : shot;
    });
    const now = isoNow();
    atomicWriteJson(scenesPath, {...scenes, updatedAt: now, items: nextScenes});
    atomicWriteJson(shotsPath, {...shots, updatedAt: now, items: nextShots});
    this.refreshProject(projectId);
    this.setScope(projectId, 'AUDIO', false, null);
    this.markScopes(projectId, ['RENDER'], 'Timeline fitted to narration audio');
    return this.getVoiceWorkspace(projectId);
  }

  getNarrationFilePath(projectId: string, segmentId: string): string {
    const project = this.getProject(projectId).project;
    const segments = NarrationSegmentCollectionSchema.parse(
      parseJson(path.join(project.rootPath, 'audio/narration/segments.json')),
    ).items;
    const segment = segments.find(({id}) => id === segmentId);
    if (!segment?.audioPath) throw new Error(`Narration segment ${segmentId} has no imported audio.`);
    return this.resolveProjectFile(project.rootPath, segment.audioPath, `Narration segment ${segmentId}`);
  }

  exportStoryboardRenderInput(projectId: string): string {
    const project = this.getProject(projectId).project;
    const bundle = ProjectBundleSchema.parse({
      project: ProjectSchema.parse(project),
      sources: SourceCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/sources.json'))).items,
      facts: FactCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/facts.json'))).items,
      claims: ClaimCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/claims.json'))).items,
      scenes: SceneCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/scenes.json'))).items,
      shots: ShotCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/shots.json'))).items,
      assets: AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json'))).items,
      narrationSegments: NarrationSegmentCollectionSchema.parse(
        parseJson(path.join(project.rootPath, 'audio/narration/segments.json')),
      ).items,
      captions: CaptionCollectionSchema.parse(parseJson(path.join(project.rootPath, 'captions/captions.json'))).items,
      jobs: [],
      approvals: [],
    });
    const outputPath = path.join(project.rootPath, 'renders/rough/storyboard-input.json');
    atomicWriteJson(outputPath, {bundle});
    return outputPath;
  }

  getEditorialWorkspace(projectId: string): EditorialWorkspace {
    const project = this.getProject(projectId).project;
    this.ensurePhase5Artifacts(project.rootPath);
    return {
      projectId,
      researchBrief: readFileSync(path.join(project.rootPath, 'research/research_packet.md'), 'utf8'),
      thesis: ThesisSchema.parse(parseJson(path.join(project.rootPath, 'thesis/thesis.json'))).statement,
      script: readFileSync(path.join(project.rootPath, 'script/script_v1.md'), 'utf8'),
      sources: SourceCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/sources.json'))).items,
      facts: FactCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/facts.json'))).items,
      claims: ClaimCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/claims.json'))).items,
    };
  }

  saveEditorialDocument(projectId: string, document: EditorialDocument, content: string): EditorialWorkspace {
    const project = this.getProject(projectId).project;
    this.ensurePhase5Artifacts(project.rootPath);
    const paths: Record<EditorialDocument, string> = {
      RESEARCH: 'research/research_packet.md',
      THESIS: 'thesis/thesis.json',
      SCRIPT: 'script/script_v1.md',
    };
    const relativePath = paths[document];
    const filePath = path.join(project.rootPath, ...relativePath.split('/'));
    const normalized = content.trimEnd();
    const now = isoNow();
    const persisted = document === 'THESIS'
      ? `${JSON.stringify({schemaVersion: 1, projectId, updatedAt: now, statement: normalized}, null, 2)}\n`
      : normalized ? `${normalized}\n` : '';
    atomicWriteText(filePath, persisted);
    this.database.prepare(
      `INSERT INTO artifact_versions (project_id, artifact_path, schema_version, content_hash, updated_at, stale)
       VALUES (?, ?, 1, ?, ?, 0)
       ON CONFLICT(project_id, artifact_path) DO UPDATE SET
         content_hash = excluded.content_hash, updated_at = excluded.updated_at, stale = 0`,
    ).run(projectId, relativePath, contentHash(persisted), now);
    const gate: ApprovalGate = document === 'SCRIPT' ? 'SCRIPT' : 'THESIS';
    this.revokeApprovalChain(projectId, gate, `${document.toLowerCase()} document changed`);
    this.markScopes(projectId, ['AUDIO', 'CAPTIONS', 'RENDER'], `${document.toLowerCase()} document changed`);
    return this.getEditorialWorkspace(projectId);
  }

  getReviewWorkspace(projectId: string): ReviewWorkspace {
    const project = this.getProject(projectId).project;
    this.ensureApprovalRows(projectId);
    const rows = this.database.prepare(
      `SELECT id, project_id, gate, status, artifact_version, approved_at, note
       FROM approvals WHERE project_id = ?`,
    ).all(projectId) as ApprovalRow[];
    const byGate = new Map(rows.map((row) => [row.gate, row]));
    const approvals = APPROVAL_GATES.map((gate, index): ApprovalRecord => {
      const row = byGate.get(gate)!;
      const previousApproved = index === 0 || byGate.get(APPROVAL_GATES[index - 1]!)?.status === 'APPROVED';
      const readiness = this.getGateReadiness(projectId, gate);
      return {
        id: row.id,
        projectId: row.project_id,
        gate: row.gate,
        status: row.status,
        artifactVersion: row.artifact_version,
        approvedAt: row.approved_at,
        note: row.note,
        unlocked: previousApproved,
        ready: readiness.ready,
        readinessMessage: readiness.message,
      };
    });
    const jobRows = this.database.prepare(
      `SELECT id, project_id, type, status, input_snapshot_path, version, target,
              log_path, output_path, temp_output_path, attempt, progress, started_at,
              finished_at, error_message, idempotency_key, cancel_requested, scope,
              command_json, created_at, updated_at
       FROM jobs WHERE project_id = ? ORDER BY created_at DESC`,
    ).all(projectId) as JobRow[];
    return {
      projectId,
      approvals,
      jobs: jobRows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        type: row.type,
        status: row.status,
        version: row.version,
        target: row.target,
        inputSnapshotPath: row.input_snapshot_path,
        logPath: row.log_path,
        outputPath: row.output_path,
        tempOutputPath: row.temp_output_path,
        attempt: row.attempt,
        progress: row.progress,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        errorMessage: row.error_message,
        cancelRequested: row.cancel_requested === 1,
        scope: row.scope,
        log: row.log_path && existsSync(path.join(project.rootPath, ...row.log_path.split('/')))
          ? readFileSync(path.join(project.rootPath, ...row.log_path.split('/')), 'utf8')
          : '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  approveGate(projectId: string, gate: ApprovalGate, note: string): ReviewWorkspace {
    const workspace = this.getReviewWorkspace(projectId);
    const approval = workspace.approvals.find((item) => item.gate === gate);
    if (!approval?.unlocked) throw new Error(`${gate} is locked until the previous gate is approved.`);
    if (!approval.ready) throw new Error(approval.readinessMessage);
    const now = isoNow();
    this.database.prepare(
      `UPDATE approvals SET status = 'APPROVED',
       artifact_version = CASE WHEN status = 'PENDING' THEN artifact_version ELSE artifact_version + 1 END,
       approved_at = ?, note = ? WHERE project_id = ? AND gate = ?`,
    ).run(now, note.trim() || null, projectId, gate);
    this.updateProjectStatus(projectId, this.statusForGate(gate), now);
    return this.getReviewWorkspace(projectId);
  }

  revokeGate(projectId: string, gate: ApprovalGate, note: string): ReviewWorkspace {
    this.ensureApprovalRows(projectId);
    this.revokeApprovalChain(projectId, gate, note.trim() || `${gate} approval revoked`);
    return this.getReviewWorkspace(projectId);
  }

  queueRender(projectId: string, target: RenderTarget): ReviewWorkspace {
    const review = this.getReviewWorkspace(projectId);
    const requiredGate: ApprovalGate = target === 'ROUGH' ? 'ASSETS' : 'ROUGH_CUT';
    if (review.approvals.find(({gate}) => gate === requiredGate)?.status !== 'APPROVED') {
      throw new Error(`${requiredGate} must be approved before queuing a ${target.toLowerCase()} render.`);
    }
    const project = this.getProject(projectId).project;
    const exportedPath = this.exportStoryboardRenderInput(projectId);
    const snapshotContent = readFileSync(exportedPath, 'utf8');
    const idempotencyKey = contentHash(`${target}\nFULL\n${snapshotContent}`);
    const active = this.database.prepare(
      `SELECT id FROM jobs WHERE project_id = ? AND idempotency_key = ?
       AND status IN ('QUEUED', 'RUNNING')`,
    ).get(projectId, idempotencyKey);
    if (active) return this.getReviewWorkspace(projectId);
    const versionRow = this.database.prepare(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM jobs WHERE project_id = ? AND target = ?',
    ).get(projectId, target) as {next_version: number};
    const version = versionRow.next_version;
    const snapshotRelative = `renders/${target.toLowerCase()}/render-v${version}-input.json`;
    const snapshotPath = path.join(project.rootPath, ...snapshotRelative.split('/'));
    renameSync(exportedPath, snapshotPath);
    const logRelative = `renders/${target.toLowerCase()}/render-v${version}.log`;
    const tempOutputRelative = `renders/${target.toLowerCase()}/.render-v${version}.working.mp4`;
    const logPath = path.join(project.rootPath, ...logRelative.split('/'));
    const now = isoNow();
    writeFileSync(logPath, `[${now}] Queued ${target.toLowerCase()} render v${version}.\nSnapshot: ${snapshotRelative}\n`, 'utf8');
    this.database.prepare(
      `INSERT INTO jobs (id, project_id, type, status, input_snapshot_path, created_at, updated_at,
                         version, target, log_path, output_path, temp_output_path, idempotency_key, scope)
       VALUES (?, ?, 'RENDER', 'QUEUED', ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'FULL')`,
    ).run(`render-${target.toLowerCase()}-${randomUUID().slice(0, 8)}`, projectId, snapshotRelative, now, now, version, target, logRelative, tempOutputRelative, idempotencyKey);
    return this.getReviewWorkspace(projectId);
  }

  queueMediaJob(projectId: string, input: QueueMediaJobInput): ReviewWorkspace {
    const project = this.getProject(projectId).project;
    const sourcePath = this.resolveProjectFile(project.rootPath, input.sourcePath, 'Media job source');
    const sourceStat = statSync(sourcePath);
    const scope = input.scope?.trim() || 'FULL';
    const idempotencyKey = contentHash(JSON.stringify({
      type: input.type,
      sourcePath: input.sourcePath,
      sourceSize: sourceStat.size,
      sourceModifiedAt: sourceStat.mtimeMs,
      scope,
    }));
    const active = this.database.prepare(
      `SELECT id FROM jobs WHERE project_id = ? AND idempotency_key = ?
       AND status IN ('QUEUED', 'RUNNING')`,
    ).get(projectId, idempotencyKey);
    if (active) return this.getReviewWorkspace(projectId);

    const id = `${input.type.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const directory = path.join(project.rootPath, 'renders/jobs');
    mkdirSync(directory, {recursive: true});
    const snapshotRelative = `renders/jobs/${id}-input.json`;
    const logRelative = `renders/jobs/${id}.log`;
    const extension = input.type === 'PROBE' ? 'txt' : 'mp4';
    const tempOutputRelative = `renders/jobs/.${id}.working.${extension}`;
    const now = isoNow();
    atomicWriteJson(path.join(project.rootPath, ...snapshotRelative.split('/')), {type: input.type, sourcePath: input.sourcePath, scope});
    writeFileSync(path.join(project.rootPath, ...logRelative.split('/')), `[${now}] Queued ${input.type.toLowerCase()} job.\nSnapshot: ${snapshotRelative}\n`, 'utf8');
    this.database.prepare(
      `INSERT INTO jobs (id, project_id, type, status, input_snapshot_path, created_at, updated_at,
                         version, target, log_path, output_path, temp_output_path, idempotency_key, scope)
       VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, 1, 'ROUGH', ?, NULL, ?, ?, ?)`,
    ).run(id, projectId, input.type, snapshotRelative, now, now, logRelative, tempOutputRelative, idempotencyKey, scope);
    return this.getReviewWorkspace(projectId);
  }

  claimNextJob(): JobExecution | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(
        `SELECT jobs.*, projects.root_path FROM jobs JOIN projects ON projects.id = jobs.project_id
         WHERE jobs.status = 'QUEUED' ORDER BY jobs.created_at ASC LIMIT 1`,
      ).get() as (JobRow & {root_path: string}) | undefined;
      if (!row) {
        this.database.exec('COMMIT');
        return null;
      }
      const now = isoNow();
      this.database.prepare(
        `UPDATE jobs SET status = 'RUNNING', attempt = attempt + 1, progress = 0,
         started_at = ?, finished_at = NULL, error_message = NULL, cancel_requested = 0, updated_at = ?
         WHERE id = ? AND status = 'QUEUED'`,
      ).run(now, now, row.id);
      this.database.exec('COMMIT');
      const outputRelative = row.type === 'RENDER'
        ? `renders/${row.target.toLowerCase()}/render-v${row.version}.mp4`
        : `renders/jobs/${row.id}.${row.type === 'PROBE' ? 'txt' : 'mp4'}`;
      return {
        id: row.id,
        projectId: row.project_id,
        type: row.type,
        target: row.target,
        version: row.version,
        attempt: row.attempt + 1,
        scope: row.scope,
        projectRoot: row.root_path,
        inputSnapshotPath: path.join(row.root_path, ...row.input_snapshot_path.split('/')),
        tempOutputPath: path.join(row.root_path, ...(row.temp_output_path ?? '').split('/')),
        outputPath: path.join(row.root_path, ...outputRelative.split('/')),
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  setJobCommand(jobId: string, command: string, args: string[]): void {
    this.database.prepare('UPDATE jobs SET command_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify({command, args}), isoNow(), jobId);
  }

  appendJobLog(jobId: string, stream: 'SYSTEM' | 'STDOUT' | 'STDERR', message: string): void {
    const row = this.database.prepare(
      `SELECT jobs.log_path, projects.root_path FROM jobs JOIN projects ON projects.id = jobs.project_id WHERE jobs.id = ?`,
    ).get(jobId) as {log_path: string | null; root_path: string} | undefined;
    if (!row?.log_path) return;
    const normalized = message.replace(/\r\n/g, '\n').trimEnd();
    if (!normalized) return;
    appendFileSync(path.join(row.root_path, ...row.log_path.split('/')), `[${isoNow()}] ${stream}: ${normalized}\n`, 'utf8');
  }

  updateJobProgress(jobId: string, progress: number): void {
    const safeProgress = Math.max(0, Math.min(1, progress));
    this.database.prepare(
      `UPDATE jobs SET progress = CASE WHEN progress > ? THEN progress ELSE ? END, updated_at = ?
       WHERE id = ? AND status = 'RUNNING'`,
    ).run(safeProgress, safeProgress, isoNow(), jobId);
  }

  isJobCancellationRequested(jobId: string): boolean {
    const row = this.database.prepare('SELECT cancel_requested FROM jobs WHERE id = ?').get(jobId) as {cancel_requested: number} | undefined;
    return row?.cancel_requested === 1;
  }

  requestJobCancellation(projectId: string, jobId: string): ReviewWorkspace {
    const row = this.database.prepare('SELECT status FROM jobs WHERE id = ? AND project_id = ?')
      .get(jobId, projectId) as {status: RenderJobRecord['status']} | undefined;
    if (!row) throw new Error(`Render job ${jobId} was not found.`);
    const now = isoNow();
    if (row.status === 'QUEUED') {
      this.database.prepare(
        `UPDATE jobs SET status = 'CANCELLED', cancel_requested = 1, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(now, now, jobId);
      this.appendJobLog(jobId, 'SYSTEM', 'Cancelled before execution.');
    } else if (row.status === 'RUNNING') {
      this.database.prepare('UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?').run(now, jobId);
      this.appendJobLog(jobId, 'SYSTEM', 'Cancellation requested.');
    }
    return this.getReviewWorkspace(projectId);
  }

  markJobCancelled(jobId: string): void {
    this.removeJobTemporaryOutput(jobId);
    const now = isoNow();
    this.database.prepare(
      `UPDATE jobs SET status = 'CANCELLED', finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, jobId);
    this.appendJobLog(jobId, 'SYSTEM', 'Job cancelled; temporary output removed.');
  }

  retryJob(projectId: string, jobId: string): ReviewWorkspace {
    const row = this.database.prepare('SELECT status FROM jobs WHERE id = ? AND project_id = ?')
      .get(jobId, projectId) as {status: RenderJobRecord['status']} | undefined;
    if (!row) throw new Error(`Render job ${jobId} was not found.`);
    if (!['RETRYABLE_FAILED', 'CANCELLED'].includes(row.status)) {
      throw new Error('Only a retryable failed or cancelled job can be retried.');
    }
    this.removeJobTemporaryOutput(jobId);
    this.database.prepare(
      `UPDATE jobs SET status = 'QUEUED', progress = 0, started_at = NULL, finished_at = NULL,
       error_message = NULL, cancel_requested = 0, updated_at = ? WHERE id = ?`,
    ).run(isoNow(), jobId);
    this.appendJobLog(jobId, 'SYSTEM', 'Queued for retry with the same immutable snapshot.');
    return this.getReviewWorkspace(projectId);
  }

  completeJob(jobId: string): void {
    const row = this.database.prepare(
      `SELECT jobs.project_id, jobs.type, jobs.id, jobs.target, jobs.version, jobs.temp_output_path, projects.root_path
       FROM jobs JOIN projects ON projects.id = jobs.project_id WHERE jobs.id = ?`,
    ).get(jobId) as {project_id: string; type: RenderJobRecord['type']; id: string; target: RenderTarget; version: number; temp_output_path: string | null; root_path: string} | undefined;
    if (!row?.temp_output_path) throw new Error(`Job ${jobId} has no temporary output path.`);
    const temporary = path.join(row.root_path, ...row.temp_output_path.split('/'));
    if (!existsSync(temporary) || !statSync(temporary).isFile()) throw new Error('Renderer exited without producing its temporary output.');
    const outputRelative = row.type === 'RENDER'
      ? `renders/${row.target.toLowerCase()}/render-v${row.version}.mp4`
      : `renders/jobs/${row.id}.${row.type === 'PROBE' ? 'txt' : 'mp4'}`;
    const output = path.join(row.root_path, ...outputRelative.split('/'));
    if (existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${outputRelative}`);
    renameSync(temporary, output);
    const now = isoNow();
    this.database.prepare(
      `UPDATE jobs SET status = 'COMPLETED', progress = 1, output_path = ?, finished_at = ?,
       error_message = NULL, updated_at = ? WHERE id = ?`,
    ).run(outputRelative, now, now, jobId);
    if (row.type === 'RENDER') this.setScope(row.project_id, 'RENDER', false, null);
    this.appendJobLog(jobId, 'SYSTEM', `Completed atomically: ${outputRelative}`);
  }

  failJob(jobId: string, message: string, retryable = true): void {
    this.removeJobTemporaryOutput(jobId);
    const row = this.database.prepare('SELECT attempt FROM jobs WHERE id = ?').get(jobId) as {attempt: number} | undefined;
    const status = retryable && (row?.attempt ?? 0) < 3 ? 'RETRYABLE_FAILED' : 'TERMINAL_FAILED';
    const now = isoNow();
    this.database.prepare(
      `UPDATE jobs SET status = ?, error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(status, message.slice(0, 2000), now, now, jobId);
    this.appendJobLog(jobId, 'SYSTEM', `${status}: ${message}`);
  }

  recoverInterruptedJobs(): number {
    const rows = this.database.prepare("SELECT id FROM jobs WHERE status = 'RUNNING'").all() as Array<{id: string}>;
    for (const row of rows) this.failJob(row.id, 'Application stopped while the job was running. Safe to retry.', true);
    return rows.length;
  }

  attachRenderOutput(projectId: string, jobId: string, sourcePath: string): ReviewWorkspace {
    const project = this.getProject(projectId).project;
    const job = this.database.prepare(
      'SELECT id, version, target, status, log_path FROM jobs WHERE id = ? AND project_id = ?',
    ).get(jobId, projectId) as Pick<JobRow, 'id' | 'version' | 'target' | 'status' | 'log_path'> | undefined;
    if (!job) throw new Error(`Render job ${jobId} was not found.`);
    if (job.status === 'RUNNING') throw new Error('Cancel the running job before attaching an existing output.');
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error('Selected render output is not a file.');
    const extension = path.extname(sourcePath).toLowerCase() || '.mp4';
    const outputRelative = `renders/${job.target.toLowerCase()}/render-v${job.version}${extension}`;
    copyFileSync(sourcePath, path.join(project.rootPath, ...outputRelative.split('/')));
    const now = isoNow();
    if (job.log_path) {
      const logPath = path.join(project.rootPath, ...job.log_path.split('/'));
      const previous = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      writeFileSync(logPath, `${previous}[${now}] Output imported: ${outputRelative}\n`, 'utf8');
    }
    this.database.prepare(
      `UPDATE jobs SET status = 'COMPLETED', progress = 1, output_path = ?, finished_at = ?,
       error_message = NULL, updated_at = ? WHERE id = ?`,
    ).run(outputRelative, now, now, jobId);
    this.setScope(projectId, 'RENDER', false, null);
    return this.getReviewWorkspace(projectId);
  }

  private removeJobTemporaryOutput(jobId: string): void {
    const row = this.database.prepare(
      `SELECT jobs.temp_output_path, projects.root_path FROM jobs
       JOIN projects ON projects.id = jobs.project_id WHERE jobs.id = ?`,
    ).get(jobId) as {temp_output_path: string | null; root_path: string} | undefined;
    if (!row?.temp_output_path) return;
    const projectRoot = path.resolve(row.root_path);
    const temporary = path.resolve(projectRoot, ...row.temp_output_path.split('/'));
    if (!temporary.startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Unsafe temporary output path for job ${jobId}.`);
    }
    if (existsSync(temporary) && statSync(temporary).isFile()) unlinkSync(temporary);
  }

  private upsertProject(project: Project, rootPath: string, archived: boolean): void {
    this.database
      .prepare(
        `INSERT INTO projects (
          id, title, question, status, root_path, target_duration_sec, language,
          aspect_ratio, created_at, updated_at, last_opened_at, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          question = excluded.question,
          status = excluded.status,
          root_path = excluded.root_path,
          target_duration_sec = excluded.target_duration_sec,
          language = excluded.language,
          aspect_ratio = excluded.aspect_ratio,
          updated_at = excluded.updated_at,
          archived = excluded.archived`,
      )
      .run(
        project.id,
        project.title,
        project.question,
        project.status,
        rootPath,
        project.targetDurationSec,
        project.language,
        project.aspectRatio,
        project.createdAt,
        project.updatedAt,
        null,
        archived ? 1 : 0,
      );
    this.ensureStaleScopes(project.id);
  }

  private ensureStaleScopes(projectId: string): void {
    const now = isoNow();
    for (const scope of ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'] as const) {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO stale_scopes (project_id, scope, stale, reason, updated_at)
           VALUES (?, ?, 0, NULL, ?)`,
        )
        .run(projectId, scope, now);
    }
  }

  private ensurePhase4Artifacts(projectRoot: string, projectId: string): void {
    const now = isoNow();
    for (const artifactPath of ['audio/narration/segments.json', 'captions/captions.json']) {
      const filePath = path.join(projectRoot, ...artifactPath.split('/'));
      if (existsSync(filePath)) continue;
      const tracked = this.database
        .prepare('SELECT 1 AS found FROM artifact_versions WHERE project_id = ? AND artifact_path = ?')
        .get(projectId, artifactPath) as {found: number} | undefined;
      if (tracked) continue;
      mkdirSync(path.dirname(filePath), {recursive: true});
      atomicWriteJson(filePath, {schemaVersion: 1, projectId, updatedAt: now, items: []});
    }
  }

  private ensureUpdateV1Artifacts(projectRoot: string, projectId: string): void {
    const now = isoNow();
    for (const artifact of JSON_ARTIFACTS) {
      if (!UPDATE_V1_ARTIFACT_PATHS.has(artifact.path)) continue;
      const filePath = path.join(projectRoot, ...artifact.path.split('/'));
      if (existsSync(filePath)) continue;
      const tracked = this.database
        .prepare('SELECT 1 AS found FROM artifact_versions WHERE project_id = ? AND artifact_path = ?')
        .get(projectId, artifact.path) as {found: number} | undefined;
      if (tracked) continue;
      mkdirSync(path.dirname(filePath), {recursive: true});
      const value = artifact.path === 'ai/settings.json'
        ? defaultObjectArtifact(artifact.path, projectId, now)
        : {schemaVersion: 1, projectId, updatedAt: now, items: []};
      atomicWriteJson(filePath, value);
    }
  }

  private ensurePhase5Artifacts(projectRoot: string): void {
    for (const artifactPath of ['research/research_packet.md', 'script/script_v1.md']) {
      const filePath = path.join(projectRoot, ...artifactPath.split('/'));
      if (existsSync(filePath)) continue;
      mkdirSync(path.dirname(filePath), {recursive: true});
      writeFileSync(filePath, '', 'utf8');
    }
    const thesisPath = path.join(projectRoot, 'thesis/thesis.json');
    if (!existsSync(thesisPath)) {
      mkdirSync(path.dirname(thesisPath), {recursive: true});
      const project = ProjectSchema.parse(parseJson(path.join(projectRoot, 'project.json')));
      atomicWriteJson(thesisPath, {schemaVersion: 1, projectId: project.id, updatedAt: isoNow(), statement: ''});
    }
  }

  private ensureApprovalRows(projectId: string): void {
    for (const gate of APPROVAL_GATES) {
      this.database.prepare(
        `INSERT OR IGNORE INTO approvals
         (id, project_id, gate, status, artifact_version, approved_at, note)
         VALUES (?, ?, ?, 'PENDING', 1, NULL, NULL)`,
      ).run(`approval-${gate.toLowerCase()}-${projectId}`, projectId, gate);
    }
  }

  private getGateReadiness(projectId: string, gate: ApprovalGate): {ready: boolean; message: string} {
    const project = this.getProject(projectId).project;
    this.ensurePhase5Artifacts(project.rootPath);
    if (gate === 'TOPIC') return {ready: true, message: 'Topic and documentary question are ready.'};
    if (gate === 'THESIS') {
      const ready = ThesisSchema.parse(parseJson(path.join(project.rootPath, 'thesis/thesis.json'))).statement.trim().length > 0;
      return {ready, message: ready ? 'Thesis document is ready.' : 'Write and save the thesis before approval.'};
    }
    if (gate === 'SCRIPT') {
      const ready = readFileSync(path.join(project.rootPath, 'script/script_v1.md'), 'utf8').trim().length > 0;
      return {ready, message: ready ? 'Script document is ready.' : 'Write and save the script before approval.'};
    }
    if (gate === 'STORYBOARD') {
      const workspace = this.getStoryboardWorkspace(projectId);
      const ready = workspace.scenes.length > 0 && workspace.shots.length > 0;
      return {ready, message: ready ? 'Storyboard has scenes and shots.' : 'Import a storyboard with at least one scene and one shot.'};
    }
    if (gate === 'ASSETS') {
      const workspace = this.getStoryboardWorkspace(projectId);
      const required = workspace.shots.filter(({visualType}) => ['AI_IMAGE', 'AI_VIDEO', 'STOCK'].includes(visualType));
      const byId = new Map(workspace.assets.map((asset) => [asset.id, asset]));
      const ready = required.every((shot) => shot.assetId && byId.get(shot.assetId)?.status === 'QA_PASS');
      return {ready, message: ready ? 'All required visual assets passed QA.' : 'Every generated or stock shot needs an asset with QA PASS.'};
    }
    const target: RenderTarget = gate === 'ROUGH_CUT' ? 'ROUGH' : 'FINAL';
    const completed = this.database.prepare(
      `SELECT output_path FROM jobs WHERE project_id = ? AND target = ? AND status = 'COMPLETED'
       AND output_path IS NOT NULL ORDER BY version DESC LIMIT 1`,
    ).get(projectId, target) as {output_path: string} | undefined;
    const ready = Boolean(completed && existsSync(path.join(project.rootPath, ...completed.output_path.split('/'))));
    return {ready, message: ready ? `${target} render output is available.` : `Complete and import a ${target.toLowerCase()} render output first.`};
  }

  private revokeApprovalChain(projectId: string, gate: ApprovalGate, note: string): void {
    this.ensureApprovalRows(projectId);
    const start = APPROVAL_GATES.indexOf(gate);
    const now = isoNow();
    for (const current of APPROVAL_GATES.slice(start)) {
      this.database.prepare(
        `UPDATE approvals
         SET status = CASE WHEN status = 'APPROVED' THEN 'REVOKED' ELSE status END,
             approved_at = NULL, note = ?
         WHERE project_id = ? AND gate = ?`,
      ).run(current === gate ? note : `Upstream ${gate} approval changed`, projectId, current);
    }
    const previousGate = APPROVAL_GATES[start - 1];
    this.updateProjectStatus(projectId, previousGate ? this.statusForGate(previousGate) : 'NEW', now);
  }

  private statusForGate(gate: ApprovalGate): Project['status'] {
    const statuses: Record<ApprovalGate, Project['status']> = {
      TOPIC: 'TOPIC_SELECTED',
      THESIS: 'THESIS_APPROVED',
      SCRIPT: 'SCRIPT_APPROVED',
      STORYBOARD: 'STORYBOARD_APPROVED',
      ASSETS: 'ASSETS_READY',
      ROUGH_CUT: 'ROUGH_CUT_APPROVED',
      FINAL: 'FINAL_APPROVED',
    };
    return statuses[gate];
  }

  private updateProjectStatus(projectId: string, status: Project['status'], updatedAt: string): void {
    const project = this.getProject(projectId).project;
    const projectPath = path.join(project.rootPath, 'project.json');
    const portable = ProjectSchema.parse(parseJson(projectPath));
    atomicWriteJson(projectPath, {...portable, status, updatedAt});
    this.database.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, projectId);
  }

  private setScope(projectId: string, scope: StaleScope['scope'], stale: boolean, reason: string | null): void {
    this.ensureStaleScopes(projectId);
    this.database
      .prepare(
        `UPDATE stale_scopes SET stale = ?, reason = ?, updated_at = ?
         WHERE project_id = ? AND scope = ?`,
      )
      .run(stale ? 1 : 0, reason, isoNow(), projectId, scope);
  }

  private syncAudioScope(projectId: string, provided?: NarrationSegment[]): void {
    const project = this.getProject(projectId).project;
    const segments = provided ?? NarrationSegmentCollectionSchema.parse(
      parseJson(path.join(project.rootPath, 'audio/narration/segments.json')),
    ).items;
    const ready = segments.length > 0 && segments.every(({audioPath, durationSec}) => audioPath && durationSec);
    this.setScope(projectId, 'AUDIO', !ready, ready ? null : 'One or more narration segments need imported audio');
  }

  private getTimelineWarnings(projectRoot: string, segments: NarrationSegment[]): VoiceWorkspace['timelineWarnings'] {
    const scenes = SceneCollectionSchema.parse(parseJson(path.join(projectRoot, 'storyboard/scenes.json'))).items;
    return scenes.map((scene) => {
      const sceneSegments = segments.filter(({sceneId}) => sceneId === scene.id);
      const plannedDurationSec = sceneSegments.reduce((total, segment) => total + segment.plannedDurationSec, 0) || scene.durationSec;
      if (sceneSegments.length === 0 || sceneSegments.some(({durationSec}) => !durationSec)) {
        return {
          sceneId: scene.id,
          kind: 'MISSING_AUDIO' as const,
          plannedDurationSec,
          actualDurationSec: null,
          deltaSec: null,
          message: 'Import every narration segment for this scene before fitting the timeline.',
        };
      }
      const actualDurationSec = sceneSegments.reduce((total, segment) => total + (segment.durationSec ?? 0), 0);
      const deltaSec = actualDurationSec - plannedDurationSec;
      const kind = Math.abs(deltaSec) <= 0.25 ? 'ALIGNED' as const : deltaSec > 0 ? 'LONGER' as const : 'SHORTER' as const;
      return {
        sceneId: scene.id,
        kind,
        plannedDurationSec,
        actualDurationSec,
        deltaSec,
        message: kind === 'ALIGNED'
          ? 'Narration matches the planned scene duration.'
          : `Narration is ${Math.abs(deltaSec).toFixed(2)}s ${deltaSec > 0 ? 'longer' : 'shorter'} than the original plan.`,
      };
    });
  }

  private offsetSegmentCaptions(captions: CaptionCue[], segments: NarrationSegment[]): CaptionCue[] {
    const offsets = new Map<string, number>();
    let offsetMs = 0;
    for (const segment of [...segments].sort((left, right) => left.order - right.order)) {
      offsets.set(segment.id, offsetMs);
      offsetMs += Math.round((segment.durationSec ?? segment.plannedDurationSec) * 1000);
    }
    return captions.map((caption) => {
      if (!caption.segmentId) return caption;
      const offset = offsets.get(caption.segmentId) ?? 0;
      return {
        ...caption,
        startMs: caption.startMs + offset,
        endMs: caption.endMs + offset,
        words: caption.words?.map((word) => ({...word, startMs: word.startMs + offset, endMs: word.endMs + offset})),
      };
    });
  }

  private retimeCaptionsForSegment(
    projectRoot: string,
    segments: NarrationSegment[],
    changedSegment: NarrationSegment,
    nextDurationSec: number,
  ): void {
    if (!changedSegment.durationSec || Math.abs(changedSegment.durationSec - nextDurationSec) < 0.001) return;
    const captionsPath = path.join(projectRoot, 'captions/captions.json');
    const collection = CaptionCollectionSchema.parse(parseJson(captionsPath));
    if (!collection.items.some(({segmentId}) => segmentId)) return;
    const ordered = [...segments].sort((left, right) => left.order - right.order);
    const segmentStartMs = ordered
      .filter(({order}) => order < changedSegment.order)
      .reduce((total, segment) => total + Math.round((segment.durationSec ?? segment.plannedDurationSec) * 1000), 0);
    const previousDurationMs = changedSegment.durationSec * 1000;
    const nextDurationMs = nextDurationSec * 1000;
    const deltaMs = nextDurationMs - previousDurationMs;
    const ratio = nextDurationMs / previousDurationMs;
    const orderById = new Map(ordered.map(({id, order}) => [id, order]));
    const retime = (timeMs: number, segmentId: string | undefined): number => {
      if (!segmentId) return timeMs;
      if (segmentId === changedSegment.id) return Math.round(segmentStartMs + (timeMs - segmentStartMs) * ratio);
      return (orderById.get(segmentId) ?? -1) > changedSegment.order ? Math.round(timeMs + deltaMs) : timeMs;
    };
    atomicWriteJson(captionsPath, {
      ...collection,
      updatedAt: isoNow(),
      items: collection.items.map((caption) => {
        const startMs = retime(caption.startMs, caption.segmentId);
        return {
          ...caption,
          startMs,
          endMs: Math.max(startMs + 1, retime(caption.endMs, caption.segmentId)),
          words: caption.words?.map((word) => {
            const wordStartMs = retime(word.startMs, caption.segmentId);
            return {
              ...word,
              startMs: wordStartMs,
              endMs: Math.max(wordStartMs + 1, retime(word.endMs, caption.segmentId)),
            };
          }),
        };
      }),
    });
  }

  private resolveProjectFile(projectRoot: string, relativePath: string, label: string): string {
    const resolved = path.resolve(projectRoot, ...relativePath.split('/'));
    const prefix = `${path.resolve(projectRoot)}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw new Error(`${label} points outside its project.`);
    if (!existsSync(resolved)) throw new Error(`${label} media is missing: ${relativePath}`);
    return resolved;
  }

  private markScopes(projectId: string, scopes: StaleScope['scope'][], reason: string): void {
    this.ensureStaleScopes(projectId);
    const now = isoNow();
    for (const scope of scopes) {
      this.database
        .prepare(
          `INSERT INTO stale_scopes (project_id, scope, stale, reason, updated_at)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(project_id, scope) DO UPDATE SET
             stale = 1, reason = excluded.reason, updated_at = excluded.updated_at`,
        )
        .run(projectId, scope, reason, now);
    }
  }

  private syncAssetScope(projectId: string): void {
    const workspace = this.getStoryboardWorkspace(projectId);
    const requiredShots = workspace.shots.filter(({visualType}) =>
      ['AI_IMAGE', 'AI_VIDEO', 'STOCK'].includes(visualType),
    );
    const assetsById = new Map(workspace.assets.map((asset) => [asset.id, asset]));
    const ready = requiredShots.every((shot) => shot.assetId && assetsById.get(shot.assetId)?.status === 'QA_PASS');
    const now = isoNow();
    this.database
      .prepare(
        `UPDATE stale_scopes SET stale = ?, reason = ?, updated_at = ?
         WHERE project_id = ? AND scope = 'ASSETS'`,
      )
      .run(ready ? 0 : 1, ready ? null : 'One or more visual assets still require QA', now, projectId);
  }

  private assertCollectionProjectIds(
    projectId: string,
    items: Array<{id: string; projectId: string}>,
    label: string,
  ): void {
    const mismatch = items.find((item) => item.projectId !== projectId);
    if (mismatch) throw new Error(`${label} ${mismatch.id} belongs to ${mismatch.projectId}, expected ${projectId}.`);
  }

  private assertAssetTransition(current: Asset['status'], next: Asset['status']): void {
    const transitions: Record<Asset['status'], Asset['status'][]> = {
      PLANNED: ['AWAITING_HUMAN', 'REJECTED'],
      AWAITING_HUMAN: ['IMPORTED', 'REJECTED'],
      IMPORTED: ['SELECTED', 'QA_PASS', 'QA_FAIL', 'REJECTED'],
      SELECTED: ['QA_PASS', 'QA_FAIL', 'REJECTED'],
      QA_PASS: ['QA_FAIL', 'REJECTED'],
      QA_FAIL: ['AWAITING_HUMAN', 'REJECTED'],
      REJECTED: ['AWAITING_HUMAN'],
    };
    if (!transitions[current].includes(next)) {
      throw new Error(`Invalid asset transition ${current} → ${next}.`);
    }
  }

  private assertAssetReadyForQa(projectRoot: string, asset: Asset): void {
    if (!asset.path || !asset.metadata) throw new Error(`Asset ${asset.id} needs imported media and probe metadata before QA_PASS.`);
    const mediaPath = path.resolve(projectRoot, ...asset.path.split('/'));
    if (!existsSync(mediaPath)) throw new Error(`Asset ${asset.id} media is missing at ${asset.path}.`);
    if ((asset.kind === 'IMAGE' || asset.kind === 'VIDEO') && (!asset.metadata.width || !asset.metadata.height)) {
      throw new Error(`Asset ${asset.id} has no readable width/height metadata.`);
    }
    if (asset.kind === 'VIDEO' && asset.metadata.durationSec === undefined) {
      throw new Error(`Asset ${asset.id} has no readable duration metadata.`);
    }
  }

  private validateProjectDirectory(projectRoot: string, projectId: string): ValidationReport {
    const checkedAt = isoNow();
    const issues: ValidationIssue[] = [];
    const targets = [
      {path: 'project.json', schema: ProjectSchema},
      ...JSON_ARTIFACTS,
    ];

    for (const target of targets) {
      const filePath = path.join(projectRoot, target.path);
      if (!existsSync(filePath)) {
        issues.push({
          severity: 'ERROR',
          file: target.path,
          path: '',
          message: 'Required artifact is missing.',
          suggestion: `Restore ${target.path} or recreate it from a valid Narra artifact.`,
        });
        continue;
      }

      try {
        const raw = readFileSync(filePath, 'utf8');
        const value = JSON.parse(raw) as unknown;
        const detectedVersion =
          value && typeof value === 'object' && 'schemaVersion' in value
            ? (value as {schemaVersion?: unknown}).schemaVersion
            : undefined;
        if (typeof detectedVersion === 'number' && detectedVersion > CURRENT_ARTIFACT_SCHEMA_VERSION) {
          issues.push({
            severity: 'ERROR',
            file: target.path,
            path: 'schemaVersion',
            message: `Artifact schema version ${detectedVersion} is newer than supported version ${CURRENT_ARTIFACT_SCHEMA_VERSION}.`,
            suggestion: 'Upgrade Narra Studio before opening this artifact; do not downgrade the file manually.',
          });
          continue;
        }

        const result = target.schema.safeParse(value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            issues.push({
              severity: 'ERROR',
              file: target.path,
              path: issue.path.join('.'),
              message: issue.message,
              suggestion: 'Regenerate this artifact with the current schema or correct the indicated field.',
            });
          }
          continue;
        }

        const artifactProjectId =
          target.path === 'project.json'
            ? (result.data as Project).id
            : (result.data as {projectId: string}).projectId;
        if (artifactProjectId !== projectId) {
          issues.push({
            severity: 'ERROR',
            file: target.path,
            path: target.path === 'project.json' ? 'id' : 'projectId',
            message: `Artifact belongs to project ${artifactProjectId}, expected ${projectId}.`,
            suggestion: 'Move the artifact to its original project or regenerate it for this project.',
          });
          continue;
        }

        const hash = contentHash(raw);
        const previous = this.database
          .prepare('SELECT content_hash FROM artifact_versions WHERE project_id = ? AND artifact_path = ?')
          .get(projectId, toPortablePath(target.path)) as {content_hash: string} | undefined;
        this.database
          .prepare(
            `INSERT INTO artifact_versions (
              project_id, artifact_path, schema_version, content_hash, updated_at, stale
            ) VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(project_id, artifact_path) DO UPDATE SET
              schema_version = excluded.schema_version,
              content_hash = excluded.content_hash,
              updated_at = excluded.updated_at`,
          )
          .run(projectId, toPortablePath(target.path), CURRENT_ARTIFACT_SCHEMA_VERSION, hash, checkedAt);
        if (previous && previous.content_hash !== hash) {
          if (target.path === 'storyboard/scenes.json') {
            this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], 'Scenes changed on disk');
          } else if (target.path === 'storyboard/shots.json') {
            this.markScopes(projectId, ['ASSETS', 'RENDER'], 'Shots changed on disk');
          } else if (target.path === 'assets/manifest.json') {
            this.markScopes(projectId, ['RENDER'], 'Asset manifest changed on disk');
          } else if (target.path === 'audio/narration/segments.json') {
            this.markScopes(projectId, ['CAPTIONS', 'RENDER'], 'Narration segments changed on disk');
          } else if (target.path === 'captions/captions.json') {
            this.markScopes(projectId, ['RENDER'], 'Captions changed on disk');
          }
        }
      } catch (error) {
        issues.push({
          severity: 'ERROR',
          file: target.path,
          path: '',
          message: error instanceof Error ? error.message : 'Artifact could not be read.',
          suggestion: 'Ensure the file contains valid UTF-8 JSON and is not locked by another process.',
        });
      }
    }

    try {
      const aiWorkspace = AiWorkspaceBundleSchema.safeParse({
        settings: AiProjectSettingsSchema.parse(parseJson(path.join(projectRoot, 'ai/settings.json'))),
        runs: AiRunCollectionSchema.parse(parseJson(path.join(projectRoot, 'ai/runs.json'))).items,
        searchActivities: AiSearchActivityCollectionSchema.parse(parseJson(path.join(projectRoot, 'ai/search_activity.json'))).items,
        sourceCards: AiSourceCardCollectionSchema.parse(parseJson(path.join(projectRoot, 'ai/source_cards.json'))).items,
        topicCandidates: TopicCandidateCollectionSchema.parse(parseJson(path.join(projectRoot, 'research/topic_candidates.json'))).items,
        thesisCandidates: ThesisCandidateCollectionSchema.parse(parseJson(path.join(projectRoot, 'thesis/thesis_candidates.json'))).items,
        outlineSections: OutlineSectionCollectionSchema.parse(parseJson(path.join(projectRoot, 'script/outline.json'))).items,
      });
      if (!aiWorkspace.success) {
        for (const issue of aiWorkspace.error.issues) {
          issues.push({
            severity: 'ERROR',
            file: 'ai/workspace',
            path: issue.path.join('.'),
            message: issue.message,
            suggestion: 'Repair the AI run relationship or regenerate the affected structured output.',
          });
        }
      }
    } catch {
      // Per-file schema errors above already provide the actionable details.
    }

    try {
      const scenes = SceneCollectionSchema.parse(parseJson(path.join(projectRoot, 'storyboard/scenes.json')));
      const shots = ShotCollectionSchema.parse(parseJson(path.join(projectRoot, 'storyboard/shots.json')));
      const assets = AssetCollectionSchema.parse(parseJson(path.join(projectRoot, 'assets/manifest.json')));
      const segments = NarrationSegmentCollectionSchema.parse(parseJson(path.join(projectRoot, 'audio/narration/segments.json')));
      const captions = CaptionCollectionSchema.parse(parseJson(path.join(projectRoot, 'captions/captions.json')));
      const sceneIds = new Set(scenes.items.map(({id}) => id));
      const shotIds = new Set(shots.items.map(({id}) => id));
      const assetIds = new Set(assets.items.map(({id}) => id));
      const segmentIds = new Set(segments.items.map(({id}) => id));
      for (const shot of shots.items) {
        if (!sceneIds.has(shot.sceneId)) {
          issues.push({
            severity: 'ERROR', file: 'storyboard/shots.json', path: `${shot.id}.sceneId`,
            message: `Shot ${shot.id} references unknown scene ${shot.sceneId}.`,
            suggestion: 'Import the matching scene or correct the shot sceneId.',
          });
        }
        if (shot.assetId && !assetIds.has(shot.assetId)) {
          issues.push({
            severity: 'ERROR', file: 'storyboard/shots.json', path: `${shot.id}.assetId`,
            message: `Shot ${shot.id} references unknown asset ${shot.assetId}.`,
            suggestion: 'Create the asset task or remove the stale assetId.',
          });
        }
      }
      for (const asset of assets.items) {
        if (!shotIds.has(asset.shotId)) {
          issues.push({
            severity: 'ERROR', file: 'assets/manifest.json', path: `${asset.id}.shotId`,
            message: `Asset ${asset.id} references unknown shot ${asset.shotId}.`,
            suggestion: 'Restore the shot or move the asset task to an existing shot.',
          });
        }
      }
      for (const segment of segments.items) {
        if (!sceneIds.has(segment.sceneId)) {
          issues.push({
            severity: 'ERROR', file: 'audio/narration/segments.json', path: `${segment.id}.sceneId`,
            message: `Narration segment ${segment.id} references unknown scene ${segment.sceneId}.`,
            suggestion: 'Sync narration segments from the current storyboard.',
          });
        }
      }
      for (const caption of captions.items) {
        if (caption.segmentId && !segmentIds.has(caption.segmentId)) {
          issues.push({
            severity: 'ERROR', file: 'captions/captions.json', path: `${caption.id}.segmentId`,
            message: `Caption ${caption.id} references unknown narration segment ${caption.segmentId}.`,
            suggestion: 'Import captions for the current narration segment set.',
          });
        }
      }
    } catch {
      // Per-file schema errors above already provide the actionable details.
    }

    return {status: issues.some(({severity}) => severity === 'ERROR') ? 'INVALID' : 'VALID', checkedAt, issues};
  }

  private rewriteJsonTree(directory: string, previousId: string, nextId: string, now: string): void {
    for (const entry of readdirSync(directory)) {
      const entryPath = path.join(directory, entry);
      if (statSync(entryPath).isDirectory()) {
        this.rewriteJsonTree(entryPath, previousId, nextId, now);
        continue;
      }
      if (!entry.endsWith('.json')) continue;
      const replaced = replaceProjectId(parseJson(entryPath), previousId, nextId);
      if (replaced && typeof replaced === 'object' && 'updatedAt' in replaced) {
        (replaced as {updatedAt: string}).updatedAt = now;
      }
      atomicWriteJson(entryPath, replaced);
    }
  }
}
