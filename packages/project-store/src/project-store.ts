import {
  ProjectSchema,
  type Project,
} from '@narra/contracts';
import {createHash, randomUUID} from 'node:crypto';
import {
  cpSync,
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
  ProjectDetail,
  ProjectRecord,
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
          .run(projectId, toPortablePath(target.path), CURRENT_ARTIFACT_SCHEMA_VERSION, contentHash(raw), checkedAt);
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
