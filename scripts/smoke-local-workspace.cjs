'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const register = require('../apps/desktop/src/electron/ipc/collaboration-local');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'narra-local-workspace-smoke-'));
const handlers = new Map();
const ipcMain = {
  handle(name, handler) { handlers.set(name, handler); },
  on() {},
};
const call = (name, payload) => handlers.get(name)({}, payload);

try {
  register({
    app: {getPath: () => temporary}, fs, path, ipcMain, pathToFileURL, crypto,
    runtime: {mainWindow: null},
  });
  const {workspace} = call('team-workspace-create', {name: 'Local smoke'});
  assert.equal(workspace.membershipStatus, 'owner');
  const {canvas} = call('team-canvas-create', {workspaceId: workspace.id, title: 'Episode 1', snapshot: {runItems: []}});
  const synced = call('team-canvas-sync', {id: canvas.id, snapshot: {runItems: [{id: 'task-1'}]}});
  assert.equal(synced.canvas.snapshot.runItems.length, 1);
  const {asset} = call('team-workspace-asset-upsert', {workspaceId: workspace.id, asset: {name: 'Frame', kind: 'image'}});
  assert.equal(asset.workspaceId, workspace.id);
  assert.equal(call('team-workspace-list').workspaces.length, 1);
  assert.equal(call('team-canvas-list', {workspaceId: workspace.id}).canvases.length, 1);
  console.log('Local workspace IPC smoke test passed.');
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
