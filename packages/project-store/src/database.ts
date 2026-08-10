import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const DATABASE_VERSION = 5;

export const openWorkspaceDatabase = (databaseRoot: string): DatabaseSync => {
  mkdirSync(databaseRoot, {recursive: true});

  const database = new DatabaseSync(path.join(databaseRoot, 'workspace.sqlite'), {
    timeout: 5000,
  });
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  const version = database.prepare('PRAGMA user_version').get() as {user_version: number};
  if (version.user_version > DATABASE_VERSION) {
    database.close();
    throw new Error(
      `Workspace database version ${version.user_version} is newer than supported version ${DATABASE_VERSION}.`,
    );
  }

  if (version.user_version < 1) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        target_duration_sec INTEGER NOT NULL,
        language TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        validation_status TEXT,
        validation_checked_at TEXT,
        validation_issues_json TEXT
      ) STRICT;
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        gate TEXT NOT NULL,
        status TEXT NOT NULL,
        artifact_version INTEGER NOT NULL,
        approved_at TEXT,
        note TEXT
      ) STRICT;
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        input_snapshot_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE artifact_versions (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_path TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (project_id, artifact_path)
      ) STRICT;
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  if (version.user_version < 2) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE stale_scopes (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, scope)
      ) STRICT;
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  if (version.user_version < 3) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE jobs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE jobs ADD COLUMN target TEXT NOT NULL DEFAULT 'ROUGH';
      ALTER TABLE jobs ADD COLUMN log_path TEXT;
      ALTER TABLE jobs ADD COLUMN output_path TEXT;
      CREATE UNIQUE INDEX approvals_project_gate ON approvals(project_id, gate);
      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  if (version.user_version < 4) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN started_at TEXT;
      ALTER TABLE jobs ADD COLUMN finished_at TEXT;
      ALTER TABLE jobs ADD COLUMN error_message TEXT;
      ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;
      ALTER TABLE jobs ADD COLUMN temp_output_path TEXT;
      ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN scope TEXT NOT NULL DEFAULT 'FULL';
      ALTER TABLE jobs ADD COLUMN command_json TEXT;
      CREATE UNIQUE INDEX jobs_active_idempotency
        ON jobs(project_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL AND status IN ('QUEUED', 'RUNNING');
      PRAGMA user_version = 4;
      COMMIT;
    `);
  }

  if (version.user_version < 5) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE flow_watch_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        watch_directory TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE flow_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL,
        suggested_shot_id TEXT,
        status TEXT NOT NULL,
        asset_id TEXT,
        file_size_bytes INTEGER NOT NULL,
        metadata_json TEXT,
        detected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, fingerprint)
      ) STRICT;
      CREATE INDEX flow_candidates_project_status ON flow_candidates(project_id, status, detected_at);
      PRAGMA user_version = 5;
      COMMIT;
    `);
  }

  return database;
};
