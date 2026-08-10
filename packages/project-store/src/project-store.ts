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
  DiscoverOutputSchema,
  ResearchOutputSchema,
  ThesisOutputSchema,
  OutlineOutputSchema,
  ScriptOutputSchema,
  StoryboardOutputSchema,
  normalizeAiStageOutput,
  type AiStage,
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
  createReadStream,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
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
import {FlowAssistedProvider} from './flow-assisted-provider.js';
import {probeMedia} from './media-probe.js';
import {UnavailableVoiceProvider, type VoiceProvider} from './voice-provider.js';
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
  SelectTopicInput,
  SaveOutlineInput,
  PrepareFlowTaskInput,
  FlowCandidate,
  FlowCandidateStatus,
  FlowWorkspace,
  GenerateNarrationInput,
  GenerateNarrationBatchInput,
  TimelineWorkspace,
  TimelinePreflightIssue,
  UpdateCaptionCueInput,
  UpdateShotAudioInput,
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

type FlowCandidateRow = {
  id: string;
  project_id: string;
  source_path: string;
  file_name: string;
  fingerprint: string;
  kind: FlowCandidate['kind'];
  suggested_shot_id: string | null;
  status: FlowCandidateStatus;
  asset_id: string | null;
  file_size_bytes: number;
  metadata_json: string | null;
  detected_at: string;
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

const fileFingerprint = (filePath: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('error', reject);
  stream.once('end', () => resolve(hash.digest('hex')));
});

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
  private readonly voiceProvider: VoiceProvider;

  constructor(workspaceRoot: string, options: {voiceProvider?: VoiceProvider} = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.voiceProvider = options.voiceProvider ?? new UnavailableVoiceProvider();
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

  getFlowWorkspace(projectId: string): FlowWorkspace {
    const project = this.getProject(projectId).project;
    const setting = this.database.prepare('SELECT watch_directory FROM flow_watch_settings WHERE project_id = ?')
      .get(projectId) as {watch_directory: string} | undefined;
    const rows = this.database.prepare(
      `SELECT id, project_id, source_path, file_name, fingerprint, kind, suggested_shot_id,
              status, asset_id, file_size_bytes, metadata_json, detected_at, updated_at
       FROM flow_candidates WHERE project_id = ? ORDER BY detected_at DESC`,
    ).all(projectId) as FlowCandidateRow[];
    const assets = AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json'))).items;
    return {
      projectId,
      watchDirectory: setting?.watch_directory ?? null,
      flowUrl: 'https://labs.google/fx/tools/flow',
      promptPackages: assets.flatMap((asset) => asset.task?.provider === 'GOOGLE_FLOW' && asset.task.flow
        ? [{assetId: asset.id, shotId: asset.shotId, package: asset.task.flow}]
        : []),
      candidates: rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        fileName: row.file_name,
        kind: row.kind,
        suggestedShotId: row.suggested_shot_id,
        status: row.status,
        fingerprint: row.fingerprint,
        fileSizeBytes: row.file_size_bytes,
        detectedAt: row.detected_at,
        updatedAt: row.updated_at,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) as FlowCandidate['metadata'] : null,
      })),
    };
  }

  setFlowWatchDirectory(projectId: string, directory: string): FlowWorkspace {
    this.getProject(projectId);
    const resolved = path.resolve(directory);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`Flow watch directory was not found: ${resolved}`);
    this.database.prepare(
      `INSERT INTO flow_watch_settings (project_id, watch_directory, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET watch_directory = excluded.watch_directory, updated_at = excluded.updated_at`,
    ).run(projectId, resolved, isoNow());
    return this.getFlowWorkspace(projectId);
  }

  prepareFlowAssetTask(projectId: string, input: PrepareFlowTaskInput): StoryboardWorkspace {
    const project = this.getProject(projectId).project;
    this.ensureApprovalRows(projectId);
    const storyboardApproval = this.database.prepare("SELECT status FROM approvals WHERE project_id = ? AND gate = 'STORYBOARD'")
      .get(projectId) as {status: ApprovalRecord['status']} | undefined;
    if (storyboardApproval?.status !== 'APPROVED') throw new Error('STORYBOARD must be approved before preparing Google Flow assets.');
    this.assertGateWritable(projectId, 'ASSETS');
    const shotsPath = path.join(project.rootPath, 'storyboard/shots.json');
    const assetsPath = path.join(project.rootPath, 'assets/manifest.json');
    const scenes = SceneCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/scenes.json')));
    const shots = ShotCollectionSchema.parse(parseJson(shotsPath));
    const assets = AssetCollectionSchema.parse(parseJson(assetsPath));
    const shot = shots.items.find(({id}) => id === input.shotId);
    if (!shot) throw new Error(`Shot ${input.shotId} was not found.`);
    const scene = scenes.items.find(({id}) => id === shot.sceneId);
    if (!scene) throw new Error(`Scene ${shot.sceneId} was not found.`);
    const existing = shot.assetId ? assets.items.find(({id}) => id === shot.assetId) : undefined;
    if (existing?.path && input.kind && input.kind !== existing.kind) {
      throw new Error('Import a replacement task before changing the kind of an asset with media.');
    }
    const kind = input.kind ?? (shot.visualType === 'AI_VIDEO' ? 'VIDEO' : 'IMAGE');
    const version = (existing?.task?.flow?.version ?? 0) + 1;
    const provider = new FlowAssistedProvider();
    const flow = provider.createPromptPackage({
      project,
      scene,
      shot,
      version,
      ...(input.imageModel ? {imageModel: input.imageModel} : {}),
      ...(input.videoModel ? {videoModel: input.videoModel} : {}),
    });
    const now = isoNow();
    const assetId = existing?.id ?? `asset-${shot.id}-${randomUUID().slice(0, 6)}`;
    const nextAsset = AssetSchema.parse({
      ...(existing ?? {}),
      id: assetId,
      projectId,
      shotId: shot.id,
      kind,
      status: existing ? 'AWAITING_HUMAN' : 'PLANNED',
      rightsNote: existing?.rightsNote ?? 'Creator-generated in Google Flow; creator must confirm usage and documentary context.',
      task: {
        provider: 'GOOGLE_FLOW',
        brief: shot.visualPurpose,
        prompt: kind === 'VIDEO' ? flow.videoPrompt : flow.imagePrompt,
        negativePrompt: flow.negativeGuidance,
        createdAt: now,
        flow,
      },
    });
    atomicWriteJson(assetsPath, {
      ...assets,
      updatedAt: now,
      items: existing ? assets.items.map((asset) => asset.id === existing.id ? nextAsset : asset) : [...assets.items, nextAsset],
    });
    if (!existing) {
      atomicWriteJson(shotsPath, {
        ...shots, updatedAt: now,
        items: shots.items.map((item) => item.id === shot.id ? {...item, assetId} : item),
      });
    }
    this.revokeApprovalChain(projectId, 'ASSETS', 'Google Flow prompt package changed');
    this.markScopes(projectId, ['ASSETS', 'RENDER'], 'Google Flow prompt package changed');
    this.refreshProject(projectId);
    return this.getStoryboardWorkspace(projectId);
  }

  async scanFlowCandidates(projectId: string): Promise<FlowWorkspace> {
    const workspace = this.getFlowWorkspace(projectId);
    if (!workspace.watchDirectory) throw new Error('Choose a Google Flow download directory before scanning.');
    const directory = path.resolve(workspace.watchDirectory);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Flow watch directory is unavailable: ${directory}`);
    const extensions = new Map<string, FlowCandidate['kind']>([
      ['.png', 'IMAGE'], ['.jpg', 'IMAGE'], ['.jpeg', 'IMAGE'], ['.webp', 'IMAGE'],
      ['.mp4', 'VIDEO'], ['.mov', 'VIDEO'], ['.webm', 'VIDEO'], ['.mkv', 'VIDEO'],
    ]);
    const promptPackages = workspace.promptPackages;
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (!entry.isFile()) continue;
      const kind = extensions.get(path.extname(entry.name).toLowerCase());
      if (!kind) continue;
      const sourcePath = path.join(directory, entry.name);
      const fileSize = statSync(sourcePath).size;
      const unchanged = this.database.prepare(
        'SELECT 1 AS found FROM flow_candidates WHERE project_id = ? AND source_path = ? AND file_size_bytes = ?',
      ).get(projectId, sourcePath, fileSize) as {found: number} | undefined;
      if (unchanged) continue;
      const fingerprint = await fileFingerprint(sourcePath);
      const known = this.database.prepare('SELECT 1 AS found FROM flow_candidates WHERE project_id = ? AND fingerprint = ?')
        .get(projectId, fingerprint) as {found: number} | undefined;
      if (known) continue;
      const lowerName = entry.name.toLowerCase();
      const suggestedShotId = promptPackages.find(({package: promptPackage, shotId}) =>
        lowerName.includes(promptPackage.shotToken.toLowerCase()) || lowerName.includes(shotId.toLowerCase()),
      )?.shotId ?? null;
      const metadata = await probeMedia(sourcePath, kind);
      const now = isoNow();
      this.database.prepare(
        `INSERT INTO flow_candidates
         (id, project_id, source_path, file_name, fingerprint, kind, suggested_shot_id, status,
          asset_id, file_size_bytes, metadata_json, detected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'DETECTED', NULL, ?, ?, ?, ?)`,
      ).run(
        `flow-candidate-${randomUUID()}`, projectId, sourcePath, entry.name, fingerprint, kind,
        suggestedShotId, fileSize, JSON.stringify(metadata), now, now,
      );
    }
    return this.getFlowWorkspace(projectId);
  }

  async selectFlowCandidate(projectId: string, candidateId: string, assetId: string): Promise<StoryboardWorkspace> {
    const row = this.getFlowCandidateRow(projectId, candidateId);
    if (row.status === 'REJECTED') throw new Error('A rejected Flow candidate cannot be selected.');
    const project = this.getProject(projectId).project;
    const assetsPath = path.join(project.rootPath, 'assets/manifest.json');
    const before = AssetCollectionSchema.parse(parseJson(assetsPath));
    const asset = before.items.find(({id}) => id === assetId);
    if (!asset?.task?.flow || asset.task.provider !== 'GOOGLE_FLOW') throw new Error(`Asset ${assetId} is not a Google Flow task.`);
    if (asset.kind !== row.kind) throw new Error(`Flow candidate kind ${row.kind} does not match asset kind ${asset.kind}.`);
    if (asset.status !== 'AWAITING_HUMAN' && asset.status !== 'QA_FAIL' && asset.status !== 'IMPORTED' && asset.status !== 'SELECTED') {
      throw new Error(`Mark asset ${assetId} as awaiting creator output before selecting a Flow candidate.`);
    }
    await this.importAssetMedia(projectId, assetId, row.source_path);
    const imported = AssetCollectionSchema.parse(parseJson(assetsPath));
    const nextAssets = imported.items.map((item): Asset => item.id === assetId ? AssetSchema.parse({
      ...item,
      status: 'SELECTED',
      generation: {
        provider: 'GOOGLE_FLOW',
        candidateId,
        promptVersion: asset.task!.flow!.version,
        model: asset.kind === 'VIDEO' ? asset.task!.flow!.videoModel : asset.task!.flow!.imageModel,
        prompt: asset.kind === 'VIDEO' ? asset.task!.flow!.videoPrompt : asset.task!.flow!.imagePrompt,
        sourceFileName: row.file_name,
        importedAt: isoNow(),
      },
    }) : item);
    atomicWriteJson(assetsPath, {...imported, updatedAt: isoNow(), items: nextAssets});
    const now = isoNow();
    this.database.prepare("UPDATE flow_candidates SET status = 'REJECTED', updated_at = ? WHERE project_id = ? AND asset_id = ? AND id <> ?")
      .run(now, projectId, assetId, candidateId);
    this.database.prepare("UPDATE flow_candidates SET status = 'SELECTED', asset_id = ?, suggested_shot_id = ?, updated_at = ? WHERE project_id = ? AND id = ?")
      .run(assetId, asset.shotId, now, projectId, candidateId);
    this.refreshProject(projectId);
    this.markScopes(projectId, ['ASSETS', 'RENDER'], `Google Flow candidate selected for ${assetId}`);
    this.syncAssetScope(projectId);
    return this.getStoryboardWorkspace(projectId);
  }

  rejectFlowCandidate(projectId: string, candidateId: string): FlowWorkspace {
    const row = this.getFlowCandidateRow(projectId, candidateId);
    if (row.status === 'SELECTED') throw new Error('Selected Flow candidate must be replaced before it can be rejected.');
    this.database.prepare("UPDATE flow_candidates SET status = 'REJECTED', updated_at = ? WHERE project_id = ? AND id = ?")
      .run(isoNow(), projectId, candidateId);
    return this.getFlowWorkspace(projectId);
  }

  getFlowCandidateFilePath(projectId: string, candidateId: string): string {
    const row = this.getFlowCandidateRow(projectId, candidateId);
    const workspace = this.getFlowWorkspace(projectId);
    if (!workspace.watchDirectory) throw new Error('Flow watch directory is not configured.');
    const resolved = path.resolve(row.source_path);
    const directory = path.resolve(workspace.watchDirectory);
    if (!resolved.startsWith(`${directory}${path.sep}`) || !existsSync(resolved)) throw new Error('Flow candidate is outside the configured directory or no longer exists.');
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
      runtime: this.voiceProvider.getRuntimeStatus(),
      presets: this.voiceProvider.presets,
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

  getTimelineWorkspace(projectId: string): TimelineWorkspace {
    const project = this.getProject(projectId).project;
    const scenes = SceneCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/scenes.json'))).items;
    const shots = ShotCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/shots.json'))).items;
    const assets = AssetCollectionSchema.parse(parseJson(path.join(project.rootPath, 'assets/manifest.json'))).items;
    const segments = NarrationSegmentCollectionSchema.parse(parseJson(path.join(project.rootPath, 'audio/narration/segments.json'))).items;
    const captions = CaptionCollectionSchema.parse(parseJson(path.join(project.rootPath, 'captions/captions.json'))).items;
    const staleRows = this.database
      .prepare('SELECT scope, stale, reason, updated_at FROM stale_scopes WHERE project_id = ? ORDER BY scope')
      .all(projectId) as Array<{scope: StaleScope['scope']; stale: number; reason: string | null; updated_at: string}>;
    const durationSec = segments.reduce((total, segment) => total + (segment.durationSec ?? 0), 0)
      || scenes.reduce((total, scene) => total + scene.durationSec, 0);
    return {
      projectId,
      durationSec,
      scenes: [...scenes].sort((left, right) => left.order - right.order),
      shots: [...shots].sort((left, right) => left.order - right.order),
      assets,
      segments: [...segments].sort((left, right) => left.order - right.order),
      captions: [...captions].sort((left, right) => left.startMs - right.startMs),
      preflightIssues: this.getTimelinePreflightIssues(project.rootPath, scenes, shots, assets, segments, captions),
      staleScopes: staleRows.map((row) => ({scope: row.scope, stale: row.stale === 1, reason: row.reason, updatedAt: row.updated_at})),
    };
  }

  updateCaptionCue(projectId: string, captionId: string, input: UpdateCaptionCueInput): TimelineWorkspace {
    const project = this.getProject(projectId).project;
    const collectionPath = path.join(project.rootPath, 'captions/captions.json');
    const collection = CaptionCollectionSchema.parse(parseJson(collectionPath));
    if (!collection.items.some(({id}) => id === captionId)) throw new Error(`Caption ${captionId} was not found.`);
    const next = CaptionCueSchema.parse({...collection.items.find(({id}) => id === captionId), ...input, id: captionId, projectId, words: undefined});
    atomicWriteJson(collectionPath, {...collection, updatedAt: isoNow(), items: collection.items.map((cue) => cue.id === captionId ? next : cue)});
    this.refreshProject(projectId);
    this.setScope(projectId, 'CAPTIONS', false, null);
    this.markScopes(projectId, ['RENDER'], `Caption ${captionId} changed`);
    return this.getTimelineWorkspace(projectId);
  }

  updateShotAudio(projectId: string, shotId: string, input: UpdateShotAudioInput): TimelineWorkspace {
    const project = this.getProject(projectId).project;
    const collectionPath = path.join(project.rootPath, 'storyboard/shots.json');
    const collection = ShotCollectionSchema.parse(parseJson(collectionPath));
    if (!collection.items.some(({id}) => id === shotId)) throw new Error(`Shot ${shotId} was not found.`);
    const items = collection.items.map((shot) => shot.id === shotId
      ? {...shot, sourceAudioMode: input.sourceAudioMode, sourceAudioVolume: input.sourceAudioVolume}
      : shot);
    atomicWriteJson(collectionPath, {...collection, updatedAt: isoNow(), items});
    this.refreshProject(projectId);
    this.markScopes(projectId, ['RENDER'], `Source audio policy changed for ${shotId}`);
    return this.getTimelineWorkspace(projectId);
  }

  async importTimelineAudio(projectId: string, role: 'MUSIC' | 'SFX', sourcePath: string): Promise<TimelineWorkspace> {
    const project = this.getProject(projectId).project;
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error('Selected audio file was not found.');
    const shots = ShotCollectionSchema.parse(parseJson(path.join(project.rootPath, 'storyboard/shots.json'))).items;
    const shot = shots[0];
    if (!shot) throw new Error('Import a storyboard before adding music or SFX.');
    const metadata = await probeMedia(sourcePath, 'AUDIO');
    const extension = path.extname(sourcePath).toLowerCase();
    const id = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const relativePath = `audio/${role.toLowerCase()}/${id}${extension}`;
    mkdirSync(path.dirname(path.join(project.rootPath, relativePath)), {recursive: true});
    copyFileSync(sourcePath, path.join(project.rootPath, ...relativePath.split('/')));
    const manifestPath = path.join(project.rootPath, 'assets/manifest.json');
    const manifest = AssetCollectionSchema.parse(parseJson(manifestPath));
    const asset = AssetSchema.parse({
      id, projectId, shotId: shot.id, kind: 'AUDIO', status: 'QA_PASS', path: relativePath,
      rightsNote: 'Creator-imported local audio; rights review required before final export.', metadata,
      audioRole: role, volume: role === 'MUSIC' ? 0.12 : 0.35, duckUnderNarration: role === 'MUSIC',
    });
    atomicWriteJson(manifestPath, {...manifest, updatedAt: isoNow(), items: [...manifest.items, asset]});
    this.refreshProject(projectId);
    this.markScopes(projectId, ['RENDER'], `${role} layer imported`);
    return this.getTimelineWorkspace(projectId);
  }

  async generateNarrationSegment(projectId: string, input: GenerateNarrationInput): Promise<VoiceWorkspace> {
    const project = this.getProject(projectId).project;
    this.ensureApprovalRows(projectId);
    const storyboardApproval = this.database.prepare("SELECT status FROM approvals WHERE project_id = ? AND gate = 'STORYBOARD'")
      .get(projectId) as {status: ApprovalRecord['status']} | undefined;
    if (storyboardApproval?.status !== 'APPROVED') throw new Error('STORYBOARD must be approved before generating narration.');
    const segmentsPath = path.join(project.rootPath, 'audio/narration/segments.json');
    const before = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
    const segment = before.items.find(({id}) => id === input.segmentId);
    if (!segment) throw new Error(`Narration segment ${input.segmentId} was not found.`);
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'narra-voice-'));
    try {
      const result = await this.voiceProvider.synthesize({
        text: segment.text,
        presetId: input.presetId,
        speed: input.speed,
        ...(input.pronunciationNotes ? {pronunciationNotes: input.pronunciationNotes} : {}),
        outputDirectory: temporaryDirectory,
      });
      await this.importNarrationAudio(projectId, segment.id, result.outputPath);
      const imported = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
      atomicWriteJson(segmentsPath, {
        ...imported,
        updatedAt: isoNow(),
        items: imported.items.map((item) => item.id === segment.id ? NarrationSegmentSchema.parse({
          ...item,
          pronunciationNotes: input.pronunciationNotes?.trim() || undefined,
          generation: {
            provider: 'KOKORO_ONNX',
            model: 'Kokoro-82M',
            modelVersion: result.modelVersion,
            voice: result.preset.voice,
            language: result.preset.language,
            speed: input.speed,
            preset: result.preset.id,
            normalizedText: result.normalizedText,
            pronunciationDictionary: result.pronunciationDictionary,
            sampleRate: result.sampleRate,
            channels: result.channels,
            loudnessTargetLufs: result.loudnessTargetLufs,
            generationDurationMs: result.generationDurationMs,
            generatedAt: isoNow(),
          },
        }) : item),
      });
      this.refreshProject(projectId);
      return this.getVoiceWorkspace(projectId);
    } finally {
      rmSync(temporaryDirectory, {recursive: true, force: true});
    }
  }

  async generateMissingNarration(projectId: string, input: GenerateNarrationBatchInput): Promise<VoiceWorkspace> {
    let workspace = this.getVoiceWorkspace(projectId);
    for (const segment of workspace.segments.filter(({audioPath}) => !audioPath)) {
      workspace = await this.generateNarrationSegment(projectId, {
        segmentId: segment.id,
        presetId: input.presetId,
        speed: input.speed,
        ...(segment.pronunciationNotes ? {pronunciationNotes: segment.pronunciationNotes} : {}),
      });
    }
    return workspace;
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
          generation: existing?.generation,
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

  generateCaptionsFromNarration(projectId: string): TimelineWorkspace {
    const project = this.getProject(projectId).project;
    const segmentsPath = path.join(project.rootPath, 'audio/narration/segments.json');
    const segments = NarrationSegmentCollectionSchema.parse(parseJson(segmentsPath));
    if (segments.items.length === 0 || segments.items.some(({durationSec}) => !durationSec)) {
      throw new Error('Generate or import every narration segment before creating timed captions.');
    }
    const cues: CaptionCue[] = [];
    let timelineOffsetMs = 0;
    for (const segment of [...segments.items].sort((left, right) => left.order - right.order)) {
      const words = segment.text.trim().split(/\s+/);
      const chunks: string[][] = [];
      for (const word of words) {
        const current = chunks.at(-1);
        if (!current || current.length >= 8 || [...current, word].join(' ').length > 48) chunks.push([word]);
        else current.push(word);
      }
      const segmentDurationMs = Math.round((segment.durationSec ?? 0) * 1000);
      let consumedWords = 0;
      chunks.forEach((chunk) => {
        const startMs = timelineOffsetMs + Math.round(segmentDurationMs * consumedWords / words.length);
        consumedWords += chunk.length;
        const endMs = timelineOffsetMs + Math.round(segmentDurationMs * consumedWords / words.length);
        cues.push(CaptionCueSchema.parse({
          id: `caption-${cues.length + 1}`, projectId, segmentId: segment.id,
          startMs, endMs: Math.max(startMs + 1, endMs), text: chunk.join(' '),
        }));
      });
      timelineOffsetMs += segmentDurationMs;
    }
    const captionsPath = path.join(project.rootPath, 'captions/captions.json');
    const collection = CaptionCollectionSchema.parse(parseJson(captionsPath));
    atomicWriteJson(captionsPath, {...collection, updatedAt: isoNow(), items: cues});
    atomicWriteJson(segmentsPath, {...segments, updatedAt: isoNow(), items: segments.items.map((segment) => ({...segment, status: segment.audioPath ? 'READY' : segment.status}))});
    this.refreshProject(projectId);
    this.setScope(projectId, 'CAPTIONS', false, null);
    this.markScopes(projectId, ['RENDER'], 'Captions generated from narration timing');
    return this.getTimelineWorkspace(projectId);
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
      sourceCards: AiSourceCardCollectionSchema.parse(parseJson(path.join(project.rootPath, 'ai/source_cards.json'))).items,
      topicCandidates: TopicCandidateCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/topic_candidates.json'))).items,
      thesisCandidates: ThesisCandidateCollectionSchema.parse(parseJson(path.join(project.rootPath, 'thesis/thesis_candidates.json'))).items,
      outlineSections: OutlineSectionCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/outline.json'))).items
        .sort((left, right) => left.order - right.order),
      scriptQaReport: existsSync(path.join(project.rootPath, 'script/qa_report.md'))
        ? readFileSync(path.join(project.rootPath, 'script/qa_report.md'), 'utf8')
        : '',
    };
  }

  applyEditorialStageOutput(projectId: string, stage: AiStage, runId: string, output: unknown): void {
    const project = this.getProject(projectId).project;
    const run = this.getAiWorkspace(projectId).runs.find(({id}) => id === runId);
    if (!run || run.stage !== stage) throw new Error(`AI run ${runId} does not own stage ${stage}.`);
    const gate = this.gateForEditorialStage(stage);
    this.assertGateWritable(projectId, gate);
    const now = isoNow();
    const normalizedOutput = normalizeAiStageOutput(output);
    const collection = <T>(items: T[]) => ({schemaVersion: 1 as const, projectId, updatedAt: now, items});
    const assertOwners = (items: Array<{projectId: string; runId?: string}>) => {
      if (items.some((item) => item.projectId !== projectId || ('runId' in item && item.runId !== runId))) {
        throw new Error(`Structured ${stage} output contains a mismatched projectId or runId.`);
      }
    };

    if (stage === 'DISCOVER') {
      const value = DiscoverOutputSchema.parse(normalizedOutput);
      assertOwners(value.topicCandidates);
      atomicWriteJson(path.join(project.rootPath, 'research/topic_candidates.json'), collection(value.topicCandidates));
    } else if (stage === 'RESEARCH') {
      const value = ResearchOutputSchema.parse(normalizedOutput);
      assertOwners([...value.sources, ...value.facts, ...value.sourceCards]);
      const sourceIds = new Set(value.sources.map(({id}) => id));
      const factIds = new Set(value.facts.map(({id}) => id));
      for (const fact of value.facts) {
        if (fact.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Fact ${fact.id} references an unknown source.`);
      }
      for (const card of value.sourceCards) {
        if (card.sourceId && !sourceIds.has(card.sourceId)) throw new Error(`Source card ${card.id} references an unknown source.`);
        if (card.supportsFactIds.some((id) => !factIds.has(id))) throw new Error(`Source card ${card.id} references an unknown fact.`);
      }
      atomicWriteJson(path.join(project.rootPath, 'research/sources.json'), collection(value.sources));
      atomicWriteJson(path.join(project.rootPath, 'research/facts.json'), collection(value.facts));
      atomicWriteJson(path.join(project.rootPath, 'ai/source_cards.json'), collection(value.sourceCards));
      const checklist = value.evidenceChecklist.map((item) => `- [${item.passed ? 'x' : ' '}] ${item.label}: ${item.note}`).join('\n');
      const packet = [
        '# Research packet', '', '## Research questions', ...value.researchQuestions.map((item) => `- ${item}`), '',
        '## Summary', value.researchSummary, '', '## Counterpoints', ...value.counterpoints.map((item) => `- ${item}`), '',
        '## Open questions', ...value.openQuestions.map((item) => `- ${item}`), '', '## Evidence checklist', checklist, '',
        '## Source IDs', ...value.sources.map((item) => `- ${item.id}: ${item.title}`), '',
      ].join('\n');
      atomicWriteText(path.join(project.rootPath, 'research/research_packet.md'), packet);
    } else if (stage === 'THESIS') {
      const value = ThesisOutputSchema.parse(normalizedOutput);
      assertOwners(value.candidates);
      const factIds = new Set(FactCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/facts.json'))).items.map(({id}) => id));
      for (const candidate of value.candidates) {
        if (candidate.supportingFactIds.some((id) => !factIds.has(id))) throw new Error(`Thesis ${candidate.id} references an unknown fact.`);
      }
      atomicWriteJson(path.join(project.rootPath, 'thesis/thesis_candidates.json'), collection(value.candidates));
    } else if (stage === 'OUTLINE') {
      const value = OutlineOutputSchema.parse(normalizedOutput);
      assertOwners(value.sections);
      this.assertUniqueOrders(value.sections, 'Outline');
      atomicWriteJson(path.join(project.rootPath, 'script/outline.json'), collection(value.sections));
      this.writeOutlineMarkdown(project.rootPath, value.sections);
    } else if (stage === 'SCRIPT') {
      const value = ScriptOutputSchema.parse(normalizedOutput);
      assertOwners(value.claims);
      const factIds = new Set(FactCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/facts.json'))).items.map(({id}) => id));
      for (const claim of value.claims) {
        if (claim.factIds.some((id) => !factIds.has(id))) throw new Error(`Claim ${claim.id} references an unknown fact.`);
      }
      const claimIds = new Set(value.claims.map(({id}) => id));
      if (value.qa.unsupportedClaimIds.some((id) => !claimIds.has(id))) throw new Error('Script QA references an unknown claim.');
      atomicWriteText(path.join(project.rootPath, 'script/script_v1.md'), `${value.scriptMarkdown.trimEnd()}\n`);
      atomicWriteJson(path.join(project.rootPath, 'script/claims.json'), collection(value.claims));
      const report = [
        '# Script QA report', '', `Estimated duration: ${value.qa.estimatedDurationSec.toFixed(1)} seconds`, '',
        '## Unsupported claims', ...(value.qa.unsupportedClaimIds.length ? value.qa.unsupportedClaimIds.map((id) => `- ${id}`) : ['- None']), '',
        '## Warnings', ...(value.qa.warnings.length ? value.qa.warnings.map((item) => `- ${item}`) : ['- None']), '',
      ].join('\n');
      atomicWriteText(path.join(project.rootPath, 'script/qa_report.md'), report);
    } else {
      const value = StoryboardOutputSchema.parse(normalizedOutput);
      assertOwners([...value.scenes, ...value.shots]);
      this.assertUniqueOrders(value.scenes, 'Scene');
      const claimIds = new Set(ClaimCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/claims.json'))).items.map(({id}) => id));
      if (value.scenes.some((scene) => scene.claimIds.some((id) => !claimIds.has(id))) ||
          value.shots.some((shot) => shot.claimIds?.some((id) => !claimIds.has(id)))) {
        throw new Error('Storyboard references an unknown claim.');
      }
      atomicWriteJson(path.join(project.rootPath, 'storyboard/scenes.json'), collection(value.scenes));
      atomicWriteJson(path.join(project.rootPath, 'storyboard/shots.json'), collection(value.shots));
    }

    this.revokeApprovalChain(projectId, gate, `${stage.toLowerCase()} artifact changed`);
    if (stage === 'STORYBOARD') this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], 'Storyboard changed');
    else if (['SCRIPT', 'OUTLINE'].includes(stage)) this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], `${stage.toLowerCase()} changed`);
    else this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], `${stage.toLowerCase()} changed`);
    this.refreshProject(projectId);
  }

  selectTopicCandidate(projectId: string, candidateId: string, input: SelectTopicInput): EditorialWorkspace {
    this.assertGateWritable(projectId, 'TOPIC');
    const project = this.getProject(projectId).project;
    const filePath = path.join(project.rootPath, 'research/topic_candidates.json');
    const current = TopicCandidateCollectionSchema.parse(parseJson(filePath));
    if (!current.items.some(({id}) => id === candidateId)) throw new Error(`Topic candidate ${candidateId} was not found.`);
    const now = isoNow();
    const items = current.items.map((item) => item.id === candidateId
      ? {...item, ...input, selected: true}
      : {...item, selected: false});
    atomicWriteJson(filePath, TopicCandidateCollectionSchema.parse({...current, updatedAt: now, items}));
    this.revokeApprovalChain(projectId, 'TOPIC', 'Selected topic changed');
    this.refreshProject(projectId);
    return this.getEditorialWorkspace(projectId);
  }

  selectThesisCandidate(projectId: string, candidateId: string, statement: string): EditorialWorkspace {
    this.assertGateWritable(projectId, 'THESIS');
    const project = this.getProject(projectId).project;
    const candidates = ThesisCandidateCollectionSchema.parse(parseJson(path.join(project.rootPath, 'thesis/thesis_candidates.json'))).items;
    if (!candidates.some(({id}) => id === candidateId)) throw new Error(`Thesis candidate ${candidateId} was not found.`);
    const normalized = statement.trim();
    if (!normalized) throw new Error('Selected thesis cannot be empty.');
    atomicWriteJson(path.join(project.rootPath, 'thesis/thesis.json'), {
      schemaVersion: 1, projectId, updatedAt: isoNow(), statement: normalized,
    });
    this.revokeApprovalChain(projectId, 'THESIS', 'Selected thesis changed');
    this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], 'Selected thesis changed');
    this.refreshProject(projectId);
    return this.getEditorialWorkspace(projectId);
  }

  saveOutline(projectId: string, input: SaveOutlineInput): EditorialWorkspace {
    this.assertGateWritable(projectId, 'SCRIPT');
    const project = this.getProject(projectId).project;
    const current = OutlineSectionCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/outline.json')));
    const byId = new Map(current.items.map((item) => [item.id, item]));
    const items = input.map((item, order) => {
      const existing = byId.get(item.id);
      if (!existing) throw new Error(`Outline section ${item.id} was not found.`);
      return {...existing, ...item, order};
    });
    if (items.length !== current.items.length || new Set(items.map(({id}) => id)).size !== items.length) {
      throw new Error('Outline save must contain every section exactly once.');
    }
    const next = OutlineSectionCollectionSchema.parse({...current, updatedAt: isoNow(), items});
    atomicWriteJson(path.join(project.rootPath, 'script/outline.json'), next);
    this.writeOutlineMarkdown(project.rootPath, next.items);
    this.revokeApprovalChain(projectId, 'SCRIPT', 'Outline changed');
    this.markScopes(projectId, ['ASSETS', 'AUDIO', 'CAPTIONS', 'RENDER'], 'Outline changed');
    this.refreshProject(projectId);
    return this.getEditorialWorkspace(projectId);
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
    const preflightErrors = this.getTimelineWorkspace(projectId).preflightIssues.filter(({severity}) => severity === 'ERROR');
    if (preflightErrors.length > 0) {
      throw new Error(`Render preflight failed: ${preflightErrors.map(({message}) => message).join(' | ')}`);
    }
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

  private gateForEditorialStage(stage: AiStage): ApprovalGate {
    if (stage === 'DISCOVER' || stage === 'RESEARCH') return 'TOPIC';
    if (stage === 'THESIS') return 'THESIS';
    if (stage === 'OUTLINE' || stage === 'SCRIPT') return 'SCRIPT';
    return 'STORYBOARD';
  }

  private getFlowCandidateRow(projectId: string, candidateId: string): FlowCandidateRow {
    this.getProject(projectId);
    const row = this.database.prepare(
      `SELECT id, project_id, source_path, file_name, fingerprint, kind, suggested_shot_id,
              status, asset_id, file_size_bytes, metadata_json, detected_at, updated_at
       FROM flow_candidates WHERE project_id = ? AND id = ?`,
    ).get(projectId, candidateId) as FlowCandidateRow | undefined;
    if (!row) throw new Error(`Flow candidate ${candidateId} was not found.`);
    return row;
  }

  private assertGateWritable(projectId: string, gate: ApprovalGate): void {
    this.ensureApprovalRows(projectId);
    const row = this.database.prepare('SELECT status FROM approvals WHERE project_id = ? AND gate = ?')
      .get(projectId, gate) as {status: ApprovalRecord['status']} | undefined;
    if (row?.status === 'APPROVED') {
      throw new Error(`${gate} is approved. Revoke that approval before replacing its artifact.`);
    }
  }

  private assertUniqueOrders(items: Array<{order: number}>, label: string): void {
    const orders = items.map(({order}) => order);
    if (new Set(orders).size !== orders.length || [...orders].sort((a, b) => a - b).some((order, index) => order !== index)) {
      throw new Error(`${label} order must be unique and contiguous from zero.`);
    }
  }

  private writeOutlineMarkdown(projectRoot: string, sections: Array<{
    order: number;
    title: string;
    objective: string;
    claimIds: string[];
    sourceIds: string[];
    targetDurationSec: number;
    contentNotes?: string | undefined;
  }>): void {
    const markdown = [...sections].sort((left, right) => left.order - right.order).flatMap((section) => [
      `## ${section.order + 1}. ${section.title}`,
      '',
      `- Objective: ${section.objective}`,
      `- Target duration: ${section.targetDurationSec} seconds`,
      `- Claims: ${section.claimIds.join(', ') || 'None yet'}`,
      `- Sources: ${section.sourceIds.join(', ') || 'None yet'}`,
      ...(section.contentNotes ? ['', section.contentNotes] : []),
      '',
    ]).join('\n');
    atomicWriteText(path.join(projectRoot, 'script/outline.md'), `# Documentary outline\n\n${markdown}`);
  }

  private getGateReadiness(projectId: string, gate: ApprovalGate): {ready: boolean; message: string} {
    const project = this.getProject(projectId).project;
    this.ensurePhase5Artifacts(project.rootPath);
    if (gate === 'TOPIC') {
      const candidates = TopicCandidateCollectionSchema.parse(parseJson(path.join(project.rootPath, 'research/topic_candidates.json'))).items;
      const ready = candidates.length === 0 || candidates.filter(({selected}) => selected).length === 1;
      return {
        ready,
        message: ready
          ? candidates.length === 0 ? 'Documentary question is ready.' : 'One topic is selected and ready.'
          : 'Select exactly one topic before approval.',
      };
    }
    if (gate === 'THESIS') {
      const ready = ThesisSchema.parse(parseJson(path.join(project.rootPath, 'thesis/thesis.json'))).statement.trim().length > 0;
      return {ready, message: ready ? 'Thesis document is ready.' : 'Write and save the thesis before approval.'};
    }
    if (gate === 'SCRIPT') {
      const hasScript = readFileSync(path.join(project.rootPath, 'script/script_v1.md'), 'utf8').trim().length > 0;
      const claims = ClaimCollectionSchema.parse(parseJson(path.join(project.rootPath, 'script/claims.json'))).items;
      const unsupported = claims.filter(({status}) => status !== 'SUPPORTED');
      const ready = hasScript && unsupported.length === 0;
      return {
        ready,
        message: ready
          ? 'Script and claim mapping are ready.'
          : !hasScript ? 'Write and save the script before approval.' : `Resolve ${unsupported.length} unsupported claim(s) before approval.`,
      };
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

  private getTimelinePreflightIssues(
    projectRoot: string,
    scenes: ReturnType<typeof SceneCollectionSchema.parse>['items'],
    shots: ReturnType<typeof ShotCollectionSchema.parse>['items'],
    assets: ReturnType<typeof AssetCollectionSchema.parse>['items'],
    segments: ReturnType<typeof NarrationSegmentCollectionSchema.parse>['items'],
    captions: ReturnType<typeof CaptionCollectionSchema.parse>['items'],
  ): TimelinePreflightIssue[] {
    const issues: TimelinePreflightIssue[] = [];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const sceneIdsWithAudio = new Set(segments.filter(({audioPath, durationSec}) => audioPath && durationSec).map(({sceneId}) => sceneId));
    const durationMs = segments.reduce((total, segment) => total + (segment.durationSec ?? 0), 0) * 1000;
    const add = (issue: TimelinePreflightIssue): void => { issues.push(issue); };

    for (const scene of scenes) {
      if (!sceneIdsWithAudio.has(scene.id)) add({severity: 'ERROR', code: 'NARRATION_MISSING', subjectId: scene.id, message: `Scene ${scene.id} has no ready narration audio.`});
      const shotDuration = shots.filter(({sceneId}) => sceneId === scene.id).reduce((total, shot) => total + shot.durationSec, 0);
      if (Math.abs(shotDuration - scene.durationSec) > 0.02) add({severity: 'ERROR', code: 'TIMELINE_MISMATCH', subjectId: scene.id, message: `Scene ${scene.id} and its shots differ by ${Math.abs(shotDuration - scene.durationSec).toFixed(2)}s.`});
    }
    for (const shot of shots) {
      if (!shot.assetId) continue;
      const asset = assetsById.get(shot.assetId);
      if (!asset?.path || !existsSync(path.join(projectRoot, ...asset.path.split('/')))) add({severity: 'ERROR', code: 'ASSET_MISSING', subjectId: shot.id, message: `Shot ${shot.id} has no readable selected media file.`});
      else if (asset.status !== 'QA_PASS') add({severity: 'ERROR', code: 'ASSET_QA', subjectId: shot.id, message: `Asset ${asset.id} must pass QA before render.`});
      if (asset && !asset.rightsNote.trim()) add({severity: 'ERROR', code: 'RIGHTS_NOTE', subjectId: asset.id, message: `Asset ${asset.id} has no source or license note.`});
    }
    if (captions.length === 0) add({severity: 'ERROR', code: 'CAPTIONS_MISSING', subjectId: 'captions', message: 'No caption cues are available for the rough cut.'});
    captions.forEach((caption, index) => {
      if (caption.endMs > durationMs + 50) add({severity: 'ERROR', code: 'CAPTION_RANGE', subjectId: caption.id, message: `Caption ${caption.id} extends past the narration master clock.`});
      const durationSec = (caption.endMs - caption.startMs) / 1000;
      const wordsPerMinute = caption.text.trim().split(/\s+/).length / Math.max(durationSec / 60, 0.01);
      if (caption.text.length > 84 || wordsPerMinute > 210) add({severity: 'WARNING', code: 'CAPTION_READABILITY', subjectId: caption.id, message: `Caption ${caption.id} may be too dense for the title-safe caption area.`});
      const next = captions[index + 1];
      if (next && next.startMs < caption.endMs) add({severity: 'WARNING', code: 'CAPTION_OVERLAP', subjectId: caption.id, message: `Caption ${caption.id} overlaps ${next.id}.`});
    });
    for (const asset of assets.filter(({kind}) => kind === 'AUDIO')) {
      if (!asset.audioRole) add({severity: 'WARNING', code: 'AUDIO_ROLE', subjectId: asset.id, message: `Audio asset ${asset.id} has no MUSIC or SFX role and will not be mixed.`});
      if (asset.path && !existsSync(path.join(projectRoot, ...asset.path.split('/')))) add({severity: 'ERROR', code: 'AUDIO_MISSING', subjectId: asset.id, message: `Audio layer ${asset.id} is missing its local file.`});
    }
    return issues;
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
