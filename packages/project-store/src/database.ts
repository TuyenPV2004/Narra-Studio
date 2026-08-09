import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const DATABASE_VERSION = 1;

export const openWorkspaceDatabase = (workspaceRoot: string): DatabaseSync => {
  const stateDirectory = path.join(workspaceRoot, '.narra');
  mkdirSync(stateDirectory, {recursive: true});

  const database = new DatabaseSync(path.join(stateDirectory, 'workspace.sqlite'), {
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

  return database;
};
