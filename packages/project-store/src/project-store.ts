import {
  AssetCollectionSchema,
  AssetSchema,
  ClaimCollectionSchema,
  FactCollectionSchema,
  ProjectBundleSchema,
  ProjectSchema,
  SceneCollectionSchema,
  ShotCollectionSchema,
  SourceCollectionSchema,
  type Asset,
  type Project,
  type ShotCollection,
} from '@narra/contracts';
import {createHash, randomUUID} from 'node:crypto';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {
  COLLECTION_ARTIFACTS,
  CURRENT_ARTIFACT_SCHEMA_VERSION,
  PROJECT_DIRECTORIES,
} from './artifact-layout.js';
import {openWorkspaceDatabase} from './database.js';
import type {
  CreateProjectInput,
  AssetStatusInput,
  CreateAssetTaskInput,
  ProjectDetail,
  ProjectRecord,
  StaleScope,
  StoryboardWorkspace,
  ValidationIssue,
  ValidationReport,
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

const atomicWriteJson = (filePath: string, value: unknown): void => {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
};

const contentHash = (content: string): string =>
  createHash('sha256').update(content).digest('hex');

const parseJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

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
      jobs: [],
      approvals: [],
    });
    const outputPath = path.join(project.rootPath, 'renders/rough/storyboard-input.json');
    atomicWriteJson(outputPath, {bundle});
    return outputPath;
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
      ...COLLECTION_ARTIFACTS,
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
      const scenes = SceneCollectionSchema.parse(parseJson(path.join(projectRoot, 'storyboard/scenes.json')));
      const shots = ShotCollectionSchema.parse(parseJson(path.join(projectRoot, 'storyboard/shots.json')));
      const assets = AssetCollectionSchema.parse(parseJson(path.join(projectRoot, 'assets/manifest.json')));
      const sceneIds = new Set(scenes.items.map(({id}) => id));
      const shotIds = new Set(shots.items.map(({id}) => id));
      const assetIds = new Set(assets.items.map(({id}) => id));
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
