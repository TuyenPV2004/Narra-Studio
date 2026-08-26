import { getElectronApi } from "@/services/electron-api/client";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
}
export interface Canvas {
  id: string;
  workspaceId: string;
  title: string;
  snapshot: Record<string, unknown>;
  version: number;
  updatedAt: string;
  episodeOrder?: number;
  episodeStatus?: string;
}
export interface WorkspaceAsset {
  id: string;
  workspaceId: string;
  name: string;
  kind: string;
  src: string;
}
export interface CanvasRevision {
  version: number;
  snapshot: Record<string, unknown>;
  createdAt: string;
}
export interface WorkspacePackageResult {
  workspace: Workspace;
  episodeCount: number;
  assetCount: number;
}
export interface WorkspaceBackupVerification {
  episodeCount: number;
  verifiedMediaCount: number;
}
export interface WorkspaceToolbox {
  id: string;
  name: string;
  nodes: Record<string, unknown>[];
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const workspace = (value: unknown): Workspace | undefined => {
  const item = object(value);
  if (typeof item.id !== "string" || typeof item.name !== "string") return;
  return {
    id: item.id,
    name: item.name,
    description: typeof item.description === "string" ? item.description : "",
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
  };
};
const canvas = (value: unknown): Canvas | undefined => {
  const item = object(value);
  if (typeof item.id !== "string" || typeof item.workspaceId !== "string")
    return;
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    title: typeof item.title === "string" ? item.title : "Canvas",
    snapshot: object(item.snapshot),
    version: typeof item.version === "number" ? item.version : 1,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    ...(typeof item.episodeOrder === "number"
      ? { episodeOrder: item.episodeOrder }
      : {}),
    ...(typeof item.episodeStatus === "string"
      ? { episodeStatus: item.episodeStatus }
      : {}),
  };
};
const asset = (value: unknown): WorkspaceAsset | undefined => {
  const item = object(value);
  if (typeof item.id !== "string" || typeof item.workspaceId !== "string")
    return;
  const src =
    typeof item.src === "string"
      ? item.src
      : typeof item.filePath === "string"
        ? item.filePath
        : "";
  if (!src) return;
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    name: typeof item.name === "string" ? item.name : "Asset",
    kind: typeof item.kind === "string" ? item.kind : "media",
    src,
  };
};
const toolbox = (value: unknown): WorkspaceToolbox | undefined => {
  const outer = object(value);
  const nested = object(outer.template || outer.toolbox || outer);
  const id =
    typeof nested.id === "string"
      ? nested.id
      : typeof outer.id === "string"
        ? outer.id
        : "";
  if (!id || typeof nested.name !== "string" || !Array.isArray(nested.nodes))
    return;
  return {
    id,
    name: nested.name,
    nodes: nested.nodes.map(object),
  };
};
export const workspaceApi = {
  async verifyBackup(): Promise<WorkspaceBackupVerification | undefined> {
    const result = object(await getElectronApi().workspaceBackupVerify());
    if (result.valid !== true) return undefined;
    return {
      episodeCount: Number(result.episodeCount || 0),
      verifiedMediaCount: Number(result.verifiedMediaCount || 0),
    };
  },
  async list(): Promise<Workspace[]> {
    const result = object(await getElectronApi().teamWorkspaceList({}));
    return (Array.isArray(result.workspaces) ? result.workspaces : [])
      .map(workspace)
      .filter((item): item is Workspace => Boolean(item));
  },
  async create(name: string, description: string): Promise<Workspace> {
    const result = object(
      await getElectronApi().teamWorkspaceCreate({
        name,
        description,
        originProvider: "narra-local",
      }),
    );
    const value = workspace(result.workspace);
    if (!value) throw new Error("Workspace response không hợp lệ.");
    return value;
  },
  async rename(
    id: string,
    name: string,
    description: string,
  ): Promise<Workspace> {
    const result = object(
      await getElectronApi().teamWorkspaceRename({ id, name, description }),
    );
    const value = workspace(result.workspace);
    if (!value) throw new Error("Workspace response không hợp lệ.");
    return value;
  },
  delete: (id: string) => getElectronApi().teamWorkspaceDelete({ id }),
  async listCanvases(workspaceId: string): Promise<Canvas[]> {
    const result = object(
      await getElectronApi().teamCanvasList({ workspaceId }),
    );
    return (Array.isArray(result.canvases) ? result.canvases : [])
      .map(canvas)
      .filter((item): item is Canvas => Boolean(item));
  },
  async createCanvas(
    workspaceId: string,
    title: string,
    snapshot: Record<string, unknown> = {
      notes: "",
      runItems: [],
      messages: [],
      assets: [],
      canvasGroups: [],
    },
  ): Promise<Canvas> {
    const result = object(
      await getElectronApi().teamCanvasCreate({ workspaceId, title, snapshot }),
    );
    const value = canvas(result.canvas);
    if (!value) throw new Error("Canvas response không hợp lệ.");
    return value;
  },
  async getCanvas(id: string): Promise<Canvas> {
    const result = object(await getElectronApi().teamCanvasGet({ id }));
    const value = canvas(result.canvas);
    if (!value) throw new Error("Canvas không tồn tại.");
    return value;
  },
  syncCanvas: (id: string, snapshot: Record<string, unknown>) =>
    getElectronApi().teamCanvasSync({ id, snapshot }),
  renameCanvas: (id: string, title: string) =>
    getElectronApi().teamCanvasRename({ id, title }),
  async updateEpisode(
    id: string,
    patch: { episodeStatus?: string; title?: string },
  ): Promise<Canvas> {
    const result = object(
      await getElectronApi().teamCanvasEpisodeUpdate({ id, ...patch }),
    );
    const value = canvas(result.canvas);
    if (!value) throw new Error("Episode response không hợp lệ.");
    return value;
  },
  reorderEpisodes: (workspaceId: string, ids: string[]) =>
    getElectronApi().teamCanvasEpisodesReorder({ workspaceId, ids }),
  acquireNode: (canvasId: string, nodeId: string, idempotencyKey: string) =>
    getElectronApi().teamNodeLock({ id: canvasId, nodeId, idempotencyKey }),
  completeNode: (
    canvasId: string,
    nodeId: string,
    idempotencyKey: string,
    result: unknown,
  ) =>
    getElectronApi().teamNodeComplete({
      id: canvasId,
      nodeId,
      idempotencyKey,
      result,
    }),
  releaseNode: (canvasId: string, nodeId: string, idempotencyKey: string) =>
    getElectronApi().teamNodeRelease({ id: canvasId, nodeId, idempotencyKey }),
  async listRevisions(id: string): Promise<CanvasRevision[]> {
    const result = object(await getElectronApi().teamCanvasRevisions({ id }));
    return (Array.isArray(result.revisions) ? result.revisions : [])
      .map(object)
      .flatMap((item) =>
        typeof item.version === "number"
          ? [
              {
                version: item.version,
                snapshot: object(item.snapshot),
                createdAt:
                  typeof item.createdAt === "string" ? item.createdAt : "",
              },
            ]
          : [],
      );
  },
  async restoreRevision(id: string, version: number): Promise<Canvas> {
    const result = object(
      await getElectronApi().teamCanvasRestore({ id, version }),
    );
    const value = canvas(result.canvas);
    if (!value) throw new Error("Revision response không hợp lệ.");
    return value;
  },
  archiveCanvas: (id: string) => getElectronApi().teamCanvasArchive({ id }),
  deleteCanvas: (id: string) => getElectronApi().teamCanvasDelete({ id }),
  async listAssets(workspaceId: string): Promise<WorkspaceAsset[]> {
    const result = object(
      await getElectronApi().teamWorkspaceAssetList({ workspaceId }),
    );
    return (Array.isArray(result.assets) ? result.assets : [])
      .map(asset)
      .filter((item): item is WorkspaceAsset => Boolean(item));
  },
  async importAssets(
    workspaceId: string,
    sourceCanvasId?: string,
  ): Promise<WorkspaceAsset[]> {
    const selected = await getElectronApi().selectAgentCanvasMediaFiles();
    const files = Array.isArray(selected) ? selected : [];
    const imported: WorkspaceAsset[] = [];
    for (const value of files) {
      const file = object(value);
      if (typeof file.filePath !== "string") continue;
      const result = object(
        await getElectronApi().teamWorkspaceAssetUpsert({
          workspaceId,
          asset: {
            workspaceId,
            sourceCanvasId,
            name: typeof file.fileName === "string" ? file.fileName : "Media",
            kind: typeof file.kind === "string" ? file.kind : "media",
            src: file.filePath,
            filePath: file.filePath,
            mimeType: file.mimeType,
          },
        }),
      );
      const normalized = asset(result.asset);
      if (normalized) imported.push(normalized);
    }
    return imported;
  },
  archiveAsset: (id: string) =>
    getElectronApi().teamWorkspaceAssetArchive({ id }),
  cloneAssetRecord(
    id: string,
    destinationCanvasId: string,
    destinationNodeId: string,
  ) {
    return getElectronApi().teamWorkspaceAssetCloneRecord({
      id,
      destinationCanvasId,
      clones: [{ memberId: "", destinationNodeId }],
    });
  },
  async listToolboxes(workspaceId: string): Promise<WorkspaceToolbox[]> {
    const result = object(
      await getElectronApi().teamWorkspaceToolboxList({ workspaceId }),
    );
    return (Array.isArray(result.toolboxes) ? result.toolboxes : [])
      .map(toolbox)
      .filter((item): item is WorkspaceToolbox => Boolean(item));
  },
  async saveToolbox(
    workspaceId: string,
    value: WorkspaceToolbox,
  ): Promise<WorkspaceToolbox> {
    const result = object(
      await getElectronApi().teamWorkspaceToolboxUpsert({
        workspaceId,
        toolbox: value,
      }),
    );
    const normalized = toolbox(result.toolbox);
    if (!normalized) throw new Error("Toolbox response không hợp lệ.");
    return normalized;
  },
  deleteToolbox: (workspaceId: string, id: string) =>
    getElectronApi().teamWorkspaceToolboxDelete({ workspaceId, id }),
  async exportPackage(
    workspaceValue: Workspace,
    canvases: Canvas[],
    assets: WorkspaceAsset[],
    fullBackup = false,
  ) {
    const payload = {
      format: "genyu-workspace-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: workspaceValue,
      episodes: canvases,
      assets,
    };
    return fullBackup
      ? getElectronApi().workspaceBackupLocal({
          payload,
          suggestedName: workspaceValue.name,
        })
      : getElectronApi().workspaceExportJson({
          payload,
          suggestedName: workspaceValue.name,
        });
  },
  async importPackage(): Promise<WorkspacePackageResult | undefined> {
    const prepared = object(await getElectronApi().workspaceImportPrepare());
    if (!Object.keys(prepared).length) return undefined;
    const sessionId =
      typeof prepared.sessionId === "string" ? prepared.sessionId : "";
    try {
      const payload = object(prepared.payload);
      const workspaceInput = object(payload.workspace);
      const created = await this.create(
        typeof workspaceInput.name === "string"
          ? `${workspaceInput.name} (import)`
          : "Workspace import",
        typeof workspaceInput.description === "string"
          ? workspaceInput.description
          : "Imported workspace",
      );
      const episodes = Array.isArray(payload.episodes)
        ? payload.episodes.map(object)
        : [];
      const canvasIds = new Map<string, string>();
      for (const episode of episodes) {
        const imported = await this.createCanvas(
          created.id,
          typeof episode.title === "string" ? episode.title : "Canvas import",
          object(episode.snapshot),
        );
        if (typeof episode.id === "string")
          canvasIds.set(episode.id, imported.id);
      }
      const media = Array.isArray(prepared.media)
        ? prepared.media.map(object)
        : [];
      const embeddedMedia = new Map<string, string>();
      for (const [index, mediaItem] of media.entries()) {
        if (!sessionId || typeof mediaItem.sourceUrl !== "string") continue;
        const read = object(
          await getElectronApi().workspaceImportMediaRead({ sessionId, index }),
        );
        if (
          typeof read.data === "string" &&
          typeof read.mimeType === "string"
        ) {
          const uploaded = object(
            await getElectronApi().teamMediaUpload({
              workspaceId: created.id,
              fileName:
                typeof read.fileName === "string"
                  ? read.fileName
                  : `workspace-media-${index + 1}`,
              mimeType: read.mimeType,
              data: read.data,
            }),
          );
          if (typeof uploaded.url !== "string")
            throw new Error(
              "Không thể khôi phục media trong backup Workspace.",
            );
          embeddedMedia.set(mediaItem.sourceUrl, uploaded.url);
        }
      }
      const assetInputs = Array.isArray(payload.assets)
        ? payload.assets.map(object)
        : [];
      for (const assetInput of assetInputs) {
        const rawSrc =
          typeof assetInput.src === "string"
            ? assetInput.src
            : typeof assetInput.filePath === "string"
              ? assetInput.filePath
              : "";
        const src = embeddedMedia.get(rawSrc) || rawSrc;
        if (!src) continue;
        await getElectronApi().teamWorkspaceAssetUpsert({
          workspaceId: created.id,
          asset: {
            ...assetInput,
            id: undefined,
            workspaceId: created.id,
            sourceCanvasId:
              typeof assetInput.sourceCanvasId === "string"
                ? canvasIds.get(assetInput.sourceCanvasId)
                : undefined,
            src,
            filePath: src,
          },
        });
      }
      return {
        workspace: created,
        episodeCount: episodes.length,
        assetCount: assetInputs.length,
      };
    } finally {
      if (sessionId)
        await getElectronApi()
          .workspaceImportRelease({ sessionId })
          .catch(() => undefined);
    }
  },
};
