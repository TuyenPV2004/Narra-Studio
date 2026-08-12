'use strict';

module.exports = function registerLocalWorkspaceIpc({app, fs, path, ipcMain, pathToFileURL, crypto, runtime}) {
  const storeFile = path.join(app.getPath('userData'), 'narra-local-workspaces.json');
  const mediaRoot = path.join(app.getPath('userData'), 'narra-local-media');
  const emptyStore = () => ({workspaces: [], canvases: [], assets: [], toolboxes: []});
  const readStore = () => {
    try {
      if (!fs.existsSync(storeFile)) return emptyStore();
      return {...emptyStore(), ...JSON.parse(fs.readFileSync(storeFile, 'utf8'))};
    } catch (error) {
      console.warn('[LOCAL-WORKSPACE] Cannot read store:', error.message);
      return emptyStore();
    }
  };
  const writeStore = (store) => {
    fs.mkdirSync(path.dirname(storeFile), {recursive: true});
    const temporary = `${storeFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
    fs.renameSync(temporary, storeFile);
  };
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const workspaceById = (store, workspaceId) => store.workspaces.find(item => item.id === workspaceId);
  const canvasById = (store, canvasId) => store.canvases.find(item => item.id === canvasId);
  const requireItem = (item, label) => {
    if (!item) throw new Error(`${label} không tồn tại trong dữ liệu local.`);
    return item;
  };
  const workspaceView = workspace => ({...workspace, role: 'owner', membershipStatus: 'owner', members: []});

  ipcMain.handle('team-workspace-list', () => {
    const store = readStore();
    return {workspaces: store.workspaces.map(workspaceView).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))};
  });
  ipcMain.handle('team-workspace-create', (_event, params = {}) => {
    const store = readStore();
    const timestamp = now();
    const workspace = {
      id: id(),
      name: String(params.name || 'Narra workspace').trim(),
      description: String(params.description || '').trim(),
      originProvider: String(params.originProvider || 'narra-local'),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.workspaces.push(workspace);
    writeStore(store);
    return {workspace: workspaceView(workspace)};
  });
  ipcMain.handle('team-workspace-get', (_event, {id: workspaceId}) => {
    const store = readStore();
    return {workspace: workspaceView(requireItem(workspaceById(store, workspaceId), 'Workspace'))};
  });
  ipcMain.handle('team-workspace-activity', () => ({activities: []}));
  ipcMain.handle('team-workspace-accept', (_event, {id: workspaceId}) => {
    const store = readStore();
    return {workspace: workspaceView(requireItem(workspaceById(store, workspaceId), 'Workspace'))};
  });
  ipcMain.handle('team-workspace-rename', (_event, {id: workspaceId, name, description}) => {
    const store = readStore();
    const workspace = requireItem(workspaceById(store, workspaceId), 'Workspace');
    workspace.name = String(name || workspace.name).trim();
    workspace.description = String(description ?? workspace.description);
    workspace.updatedAt = now();
    writeStore(store);
    return {workspace: workspaceView(workspace)};
  });
  ipcMain.handle('team-workspace-delete', (_event, {id: workspaceId}) => {
    const store = readStore();
    const canvasIds = new Set(store.canvases.filter(item => item.workspaceId === workspaceId).map(item => item.id));
    store.workspaces = store.workspaces.filter(item => item.id !== workspaceId);
    store.canvases = store.canvases.filter(item => item.workspaceId !== workspaceId);
    store.assets = store.assets.filter(item => item.workspaceId !== workspaceId && !canvasIds.has(item.sourceCanvasId));
    store.toolboxes = store.toolboxes.filter(item => item.workspaceId !== workspaceId);
    writeStore(store);
    return {success: true};
  });
  for (const channel of ['team-workspace-invite', 'team-workspace-remove-member', 'team-workspace-member-role', 'team-workspace-transfer-owner']) {
    ipcMain.handle(channel, () => ({localOnly: true, members: []}));
  }

  ipcMain.handle('team-canvas-list', (_event, params = {}) => {
    const store = readStore();
    const canvases = store.canvases
      .filter(item => item.workspaceId === params.workspaceId && (params.includeArchived || !item.archived))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {canvases, hasMore: false, nextCursor: null};
  });
  ipcMain.handle('team-canvas-create', (_event, params = {}) => {
    const store = readStore();
    requireItem(workspaceById(store, params.workspaceId), 'Workspace');
    const timestamp = now();
    const canvas = {
      id: id(), workspaceId: params.workspaceId,
      title: String(params.title || 'Canvas').trim(),
      snapshot: params.snapshot || {}, version: 1, revisions: [], archived: false,
      createdAt: timestamp, updatedAt: timestamp,
    };
    store.canvases.push(canvas);
    writeStore(store);
    return {canvas};
  });
  ipcMain.handle('team-canvas-get', (_event, {id: canvasId}) => {
    const store = readStore();
    return {canvas: requireItem(canvasById(store, canvasId), 'Canvas')};
  });
  ipcMain.handle('team-canvas-sync', (_event, {id: canvasId, snapshot}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    canvas.revisions = [...(canvas.revisions || []), {version: canvas.version, snapshot: canvas.snapshot, createdAt: canvas.updatedAt}].slice(-20);
    canvas.snapshot = snapshot || {};
    canvas.version = Number(canvas.version || 0) + 1;
    canvas.updatedAt = now();
    writeStore(store);
    return {canvas, version: canvas.version};
  });
  ipcMain.handle('team-canvas-rename', (_event, {id: canvasId, title}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    canvas.title = String(title || canvas.title).trim();
    canvas.updatedAt = now();
    writeStore(store);
    return {canvas};
  });
  ipcMain.handle('team-canvas-episode-update', (_event, {id: canvasId, ...patch}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    Object.assign(canvas, patch, {updatedAt: now()});
    writeStore(store);
    return {canvas};
  });
  ipcMain.handle('team-canvas-episodes-reorder', (_event, {workspaceId, ids = []}) => {
    const store = readStore();
    ids.forEach((canvasId, index) => {
      const canvas = store.canvases.find(item => item.id === canvasId && item.workspaceId === workspaceId);
      if (canvas) canvas.episodeOrder = index;
    });
    writeStore(store);
    return {success: true};
  });
  ipcMain.handle('team-canvas-archive', (_event, {id: canvasId}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    canvas.archived = true;
    canvas.updatedAt = now();
    writeStore(store);
    return {canvas};
  });
  ipcMain.handle('team-canvas-delete', (_event, {id: canvasId}) => {
    const store = readStore();
    store.canvases = store.canvases.filter(item => item.id !== canvasId);
    store.assets = store.assets.filter(item => item.sourceCanvasId !== canvasId);
    writeStore(store);
    return {success: true};
  });
  ipcMain.handle('team-canvas-revisions', (_event, {id: canvasId}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    return {revisions: canvas.revisions || []};
  });
  ipcMain.handle('team-canvas-restore', (_event, {id: canvasId, version}) => {
    const store = readStore();
    const canvas = requireItem(canvasById(store, canvasId), 'Canvas');
    const revision = requireItem((canvas.revisions || []).find(item => item.version === version), 'Revision');
    canvas.snapshot = revision.snapshot;
    canvas.version = Number(canvas.version || 0) + 1;
    canvas.updatedAt = now();
    writeStore(store);
    return {canvas};
  });
  ipcMain.handle('team-node-audit-append', () => ({success: true}));
  ipcMain.handle('team-node-audit-list', () => ({audits: []}));
  ipcMain.handle('team-node-lock', () => ({locked: true, localOnly: true}));
  ipcMain.handle('team-node-complete', () => ({completed: true, localOnly: true}));
  ipcMain.handle('team-node-release', () => ({released: true, localOnly: true}));

  ipcMain.handle('team-workspace-asset-list', (_event, params = {}) => {
    const store = readStore();
    return {assets: store.assets.filter(item => item.workspaceId === params.workspaceId && (params.includeArchived || !item.archived))};
  });
  ipcMain.handle('team-workspace-asset-upsert', (_event, params = {}) => {
    const store = readStore();
    const incoming = params.asset || params;
    let asset = incoming.id && store.assets.find(item => item.id === incoming.id);
    if (asset) Object.assign(asset, incoming, {updatedAt: now()});
    else {
      asset = {...incoming, id: incoming.id || id(), workspaceId: params.workspaceId || incoming.workspaceId, createdAt: now(), updatedAt: now()};
      store.assets.push(asset);
    }
    writeStore(store);
    return {asset};
  });
  ipcMain.handle('team-workspace-asset-clone-record', (_event, {id: assetId, ...params}) => {
    const store = readStore();
    const source = requireItem(store.assets.find(item => item.id === assetId), 'Asset');
    const asset = {...source, ...params, id: id(), createdAt: now(), updatedAt: now()};
    store.assets.push(asset);
    writeStore(store);
    return {asset};
  });
  ipcMain.handle('team-workspace-asset-archive', (_event, {id: assetId}) => {
    const store = readStore();
    const asset = requireItem(store.assets.find(item => item.id === assetId), 'Asset');
    asset.archived = true;
    writeStore(store);
    return {asset};
  });
  ipcMain.handle('team-workspace-toolbox-list', (_event, {workspaceId}) => {
    const store = readStore();
    return {toolboxes: store.toolboxes.filter(item => item.workspaceId === workspaceId)};
  });
  ipcMain.handle('team-workspace-toolbox-upsert', (_event, params = {}) => {
    const store = readStore();
    let toolbox = params.id && store.toolboxes.find(item => item.id === params.id);
    if (toolbox) Object.assign(toolbox, params, {updatedAt: now()});
    else {
      toolbox = {...params, id: params.id || id(), createdAt: now(), updatedAt: now()};
      store.toolboxes.push(toolbox);
    }
    writeStore(store);
    return {toolbox};
  });
  ipcMain.handle('team-workspace-toolbox-delete', (_event, {id: toolboxId}) => {
    const store = readStore();
    store.toolboxes = store.toolboxes.filter(item => item.id !== toolboxId);
    writeStore(store);
    return {success: true};
  });
  ipcMain.handle('team-media-upload', (_event, params = {}) => {
    const bytes = Buffer.from(String(params.data || '').replace(/^data:[^,]+,/, ''), 'base64');
    const safeName = path.basename(String(params.fileName || `${id()}.bin`)).replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.mkdirSync(mediaRoot, {recursive: true});
    const destination = path.join(mediaRoot, `${Date.now()}-${safeName}`);
    fs.writeFileSync(destination, bytes);
    return {url: pathToFileURL(destination).href, filePath: destination};
  });

  ipcMain.handle('team-presence-connect', () => ({connecting: false, connected: true, localOnly: true}));
  ipcMain.handle('team-presence-wal-status', () => ({count: 0, bytes: 0, localOnly: true}));
  ipcMain.handle('team-presence-wal-clear', () => ({success: true}));
  ipcMain.on('team-presence-cursor', () => {});
  ipcMain.on('team-presence-doc-update', (_event, update = {}) => {
    if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow.webContents.send('team-presence-event', {type: 'doc-ack', updateId: update.updateId, localOnly: true});
    }
  });
  ipcMain.on('team-presence-disconnect', () => {});
};
