import {
  Archive,
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  FolderPlus,
  ImagePlus,
  PackagePlus,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  workspaceApi,
  type Canvas,
  type Workspace,
  type WorkspaceAsset,
} from "@/services/electron-api/workspace";
import { CanvasRevisionPanel } from "@/pages/AIAgent/components/CanvasRevisionPanel";
import {
  CanvasGraphPanel,
  readCanvasNodes,
  type CanvasNode,
} from "@/pages/AIAgent/components/CanvasGraphPanel";
import { imageApi } from "@/services/electron-api/image";
import { videoApi } from "@/services/electron-api/video";
import { agentApi } from "@/services/electron-api/agent";
import type { ProviderId } from "@/types/electron-api";
import { WorkspaceToolboxPanel } from "@/pages/AIAgent/components/WorkspaceToolboxPanel";

export function WorkspacePanel({ providerId }: { providerId: ProviderId }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>();
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [activeCanvas, setActiveCanvas] = useState<Canvas>();
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [notes, setNotes] = useState("");
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const refresh = async () => {
    const values = await workspaceApi.list();
    setWorkspaces(values);
    setActiveWorkspace((current) =>
      current && values.some((item) => item.id === current)
        ? current
        : values[0]?.id,
    );
  };
  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
  }, []);
  useEffect(() => {
    if (!activeWorkspace) {
      setCanvases([]);
      setAssets([]);
      return;
    }
    void Promise.all([
      workspaceApi.listCanvases(activeWorkspace),
      workspaceApi.listAssets(activeWorkspace),
    ])
      .then(([nextCanvases, nextAssets]) => {
        setCanvases(nextCanvases);
        setAssets(nextAssets);
      })
      .catch((value) => setError(String(value)));
  }, [activeWorkspace]);
  const createWorkspace = async () => {
    const value = await workspaceApi.create(
      `Workspace ${workspaces.length + 1}`,
      "Không gian sáng tạo local",
    );
    await refresh();
    setActiveWorkspace(value.id);
    setStatus("Đã tạo workspace.");
  };
  const renameWorkspace = async (item: Workspace) => {
    const name = window.prompt("Tên workspace", item.name)?.trim();
    if (!name || name === item.name) return;
    const updated = await workspaceApi.rename(item.id, name, item.description);
    setWorkspaces((values) =>
      values.map((value) => (value.id === updated.id ? updated : value)),
    );
  };
  const removeWorkspace = async (item: Workspace) => {
    if (
      !window.confirm(`Xóa workspace “${item.name}” và toàn bộ Episode local?`)
    )
      return;
    await workspaceApi.delete(item.id);
    if (activeWorkspace === item.id) {
      setActiveWorkspace(undefined);
      setActiveCanvas(undefined);
    }
    await refresh();
  };
  const createCanvas = async () => {
    if (!activeWorkspace) return;
    const value = await workspaceApi.createCanvas(
      activeWorkspace,
      `Canvas ${canvases.length + 1}`,
    );
    setCanvases((items) => [value, ...items]);
    setActiveCanvas(value);
    setNotes("");
    setNodes([]);
  };
  const openCanvas = async (id: string) => {
    const value = await workspaceApi.getCanvas(id);
    setActiveCanvas(value);
    setNotes(
      typeof value.snapshot.notes === "string" ? value.snapshot.notes : "",
    );
    setNodes(readCanvasNodes(value.snapshot.runItems));
  };
  const renameCanvas = async (item: Canvas) => {
    const title = window.prompt("Tên Episode", item.title)?.trim();
    if (!title || title === item.title) return;
    await workspaceApi.renameCanvas(item.id, title);
    setCanvases((values) =>
      values.map((value) =>
        value.id === item.id ? { ...value, title } : value,
      ),
    );
    setActiveCanvas((value) =>
      value?.id === item.id ? { ...value, title } : value,
    );
  };
  const save = async () => {
    if (!activeCanvas) return;
    await workspaceApi.syncCanvas(activeCanvas.id, {
      ...activeCanvas.snapshot,
      notes,
      runItems: nodes,
    });
    const updated = await workspaceApi.getCanvas(activeCanvas.id);
    setActiveCanvas(updated);
    setNodes(readCanvasNodes(updated.snapshot.runItems));
    setStatus("Canvas đã được lưu cục bộ.");
  };
  const removeCanvas = async (id: string) => {
    await workspaceApi.deleteCanvas(id);
    setCanvases((items) => items.filter((item) => item.id !== id));
    if (activeCanvas?.id === id) setActiveCanvas(undefined);
  };
  const archiveCanvas = async (id: string) => {
    await workspaceApi.archiveCanvas(id);
    setCanvases((items) => items.filter((item) => item.id !== id));
    if (activeCanvas?.id === id) setActiveCanvas(undefined);
  };
  const importAssets = async () => {
    if (!activeWorkspace) return;
    const imported = await workspaceApi.importAssets(
      activeWorkspace,
      activeCanvas?.id,
    );
    setAssets((items) => [...imported, ...items]);
  };
  const archiveAsset = async (id: string) => {
    await workspaceApi.archiveAsset(id);
    setAssets((items) => items.filter((item) => item.id !== id));
  };
  const refreshAssets = async () => {
    if (!activeWorkspace) return;
    setAssets(await workspaceApi.listAssets(activeWorkspace));
  };
  const addAssetToCanvas = async (item: WorkspaceAsset) => {
    if (!activeCanvas) return;
    const kind =
      item.kind === "audio" || item.kind === "video" ? item.kind : "image";
    const node: CanvasNode = {
      id: `source-node-${crypto.randomUUID()}`,
      kind,
      displayTitle: item.name,
      prompt: "",
      status: "done",
      src: item.src,
      isManualDraft: false,
      isManualNode: true,
      isReference: true,
      sourceWorkspaceAssetId: item.id,
      canvasPosition: {
        x: 80 + (nodes.length % 3) * 260,
        y: 80 + Math.floor(nodes.length / 3) * 210,
      },
    };
    const nextNodes = [...nodes, node];
    await workspaceApi.cloneAssetRecord(item.id, activeCanvas.id, node.id);
    await workspaceApi.syncCanvas(activeCanvas.id, {
      ...activeCanvas.snapshot,
      notes,
      runItems: nextNodes,
    });
    const updated = await workspaceApi.getCanvas(activeCanvas.id);
    setActiveCanvas(updated);
    setNodes(readCanvasNodes(updated.snapshot.runItems));
    setStatus(`Đã đưa “${item.name}” vào canvas.`);
  };
  const orderedCanvases = [...canvases].sort(
    (left, right) =>
      (left.episodeOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.episodeOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const moveCanvas = async (id: string, direction: -1 | 1) => {
    if (!activeWorkspace) return;
    const index = orderedCanvases.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedCanvases.length) return;
    const next = [...orderedCanvases];
    [next[index], next[target]] = [next[target]!, next[index]!];
    await workspaceApi.reorderEpisodes(
      activeWorkspace,
      next.map((item) => item.id),
    );
    setCanvases(next.map((item, episodeOrder) => ({ ...item, episodeOrder })));
    setStatus("Đã cập nhật thứ tự Episode.");
  };
  const updateEpisodeStatus = async (episodeStatus: string) => {
    if (!activeCanvas) return;
    const updated = await workspaceApi.updateEpisode(activeCanvas.id, {
      episodeStatus,
    });
    setActiveCanvas(updated);
    setCanvases((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    setStatus("Đã cập nhật trạng thái Episode.");
  };
  const exportWorkspace = async (fullBackup: boolean) => {
    const selected = workspaces.find((item) => item.id === activeWorkspace);
    if (!selected) return;
    await workspaceApi.exportPackage(selected, canvases, assets, fullBackup);
    setStatus(
      fullBackup ? "Đã xuất backup workspace." : "Đã xuất workspace JSON.",
    );
  };
  const importWorkspace = async () => {
    const imported = await workspaceApi.importPackage();
    if (!imported) return;
    await refresh();
    setActiveWorkspace(imported.workspace.id);
    setStatus(
      `Đã import ${imported.episodeCount} Episode và ${imported.assetCount} asset.`,
    );
  };
  const verifyBackup = async () => {
    const result = await workspaceApi.verifyBackup();
    if (!result) return;
    setStatus(
      `Backup hợp lệ · ${result.episodeCount} Episode · ${result.verifiedMediaCount} media đã xác minh.`,
    );
  };
  const runNode = async (node: CanvasNode) => {
    if (!activeCanvas || !node.prompt.trim()) return;
    if (
      node.kind !== "image" &&
      node.kind !== "video" &&
      node.kind !== "audio" &&
      node.kind !== "note"
    )
      return;
    const dependency = node.dependsOnSceneId
      ? nodes.find((item) => item.id === node.dependsOnSceneId)
      : undefined;
    if (dependency && dependency.status !== "done") {
      setError(
        `Node “${node.displayTitle}” đang chờ “${dependency.displayTitle}” hoàn tất.`,
      );
      return;
    }
    const idempotencyKey = `source-node-${crypto.randomUUID()}`;
    const updateNode = (patch: Partial<CanvasNode>) =>
      setNodes((items) =>
        items.map((item) =>
          item.id === node.id ? { ...item, ...patch } : item,
        ),
      );
    updateNode({ status: "processing", error: undefined });
    setError(undefined);
    try {
      await workspaceApi.acquireNode(activeCanvas.id, node.id, idempotencyKey);
      let result: {
        jobId?: string;
        mediaId?: string | null;
        src?: string;
        textOutput?: string;
      };
      if (node.kind === "image") {
        result = await imageApi.generate({
          providerId,
          prompt: node.prompt,
          model: "NARWHAL",
          aspect: "IMAGE_ASPECT_RATIO_LANDSCAPE",
          resolution: "2k",
          seed: Math.floor(Math.random() * 9_999_999),
        });
      } else if (node.kind === "video") {
        result = await videoApi.generate({
          providerId,
          prompt: node.prompt,
          model: "abra_t2v_8s",
          aspect: "landscape",
          duration: 8,
          resolution: "720p",
          mode: "text",
        });
      } else if (node.kind === "audio") {
        result = await agentApi.generateAudio(node.prompt);
      } else {
        result = { textOutput: await agentApi.generateNote(node.prompt) };
      }
      const completed = {
        ...node,
        ...result,
        status: "done",
        error: undefined,
      };
      const nextNodes = nodes.map((item) =>
        item.id === node.id ? completed : item,
      );
      setNodes(nextNodes);
      await workspaceApi.completeNode(
        activeCanvas.id,
        node.id,
        idempotencyKey,
        result,
      );
      await workspaceApi.syncCanvas(activeCanvas.id, {
        ...activeCanvas.snapshot,
        notes,
        runItems: nextNodes,
      });
      const updated = await workspaceApi.getCanvas(activeCanvas.id);
      setActiveCanvas(updated);
      setNodes(readCanvasNodes(updated.snapshot.runItems));
    } catch (value) {
      const message = value instanceof Error ? value.message : String(value);
      updateNode({ status: "error", error: message });
      setError(message);
      await workspaceApi
        .releaseNode(activeCanvas.id, node.id, idempotencyKey)
        .catch(() => undefined);
    }
  };
  return (
    <section
      className="source-workspace-panel"
      aria-label="Workspace và canvas"
    >
      <aside>
        <header>
          <h2>Workspaces</h2>
          <Button
            variant="ghost"
            aria-label="Tạo workspace"
            onClick={() =>
              void createWorkspace().catch((value) => setError(String(value)))
            }
          >
            <FolderPlus size={16} />
          </Button>
        </header>
        <div className="source-workspace-package-actions">
          <Button
            variant="secondary"
            aria-label="Import workspace"
            onClick={() =>
              void importWorkspace().catch((value) => setError(String(value)))
            }
          >
            <Upload size={14} /> Import
          </Button>
          <Button
            variant="ghost"
            disabled={!activeWorkspace}
            aria-label="Export workspace JSON"
            onClick={() =>
              void exportWorkspace(false).catch((value) =>
                setError(String(value)),
              )
            }
          >
            <Download size={14} /> JSON
          </Button>
          <Button
            variant="ghost"
            disabled={!activeWorkspace}
            aria-label="Backup workspace"
            onClick={() =>
              void exportWorkspace(true).catch((value) =>
                setError(String(value)),
              )
            }
          >
            Backup
          </Button>
          <Button
            variant="ghost"
            aria-label="Verify workspace backup"
            onClick={() =>
              void verifyBackup().catch((value) => setError(String(value)))
            }
          >
            Xác minh
          </Button>
        </div>
        {workspaces.map((item) => (
          <div className="source-workspace-row" key={item.id}>
            <button
              type="button"
              data-active={activeWorkspace === item.id}
              onClick={() => {
                setActiveWorkspace(item.id);
                setActiveCanvas(undefined);
              }}
            >
              {item.name}
              <small>{item.description}</small>
            </button>
            <Button
              variant="ghost"
              aria-label={`Đổi tên ${item.name}`}
              onClick={() =>
                void renameWorkspace(item).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <Pencil size={13} />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Xóa ${item.name}`}
              onClick={() =>
                void removeWorkspace(item).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        {!workspaces.length && <p>Chưa có workspace local.</p>}
      </aside>
      <aside>
        <header>
          <h2>Episodes</h2>
          <Button
            variant="ghost"
            aria-label="Tạo canvas"
            disabled={!activeWorkspace}
            onClick={() =>
              void createCanvas().catch((value) => setError(String(value)))
            }
          >
            <FilePlus2 size={16} />
          </Button>
        </header>
        {orderedCanvases.map((item, index) => (
          <div className="source-episode-row" key={item.id}>
            <button
              type="button"
              data-active={activeCanvas?.id === item.id}
              onClick={() =>
                void openCanvas(item.id).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              {item.title}
              <small>
                {item.episodeStatus || "draft"} · v{item.version}
              </small>
            </button>
            <Button
              variant="ghost"
              aria-label={`Di chuyển ${item.title} lên`}
              disabled={index === 0}
              onClick={() =>
                void moveCanvas(item.id, -1).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <ArrowUp size={13} />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Di chuyển ${item.title} xuống`}
              disabled={index === orderedCanvases.length - 1}
              onClick={() =>
                void moveCanvas(item.id, 1).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <ArrowDown size={13} />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Đổi tên ${item.title}`}
              onClick={() =>
                void renameCanvas(item).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <Pencil size={13} />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Lưu trữ ${item.title}`}
              onClick={() =>
                void archiveCanvas(item.id).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <Archive size={13} />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Xóa ${item.title}`}
              onClick={() =>
                void removeCanvas(item.id).catch((value) =>
                  setError(String(value)),
                )
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {!canvases.length && <p>Chưa có Episode.</p>}
      </aside>
      <main data-canvas-id={activeCanvas?.id}>
        {activeCanvas ? (
          <>
            <header>
              <div>
                <small>CANVAS LOCAL</small>
                <h2>{activeCanvas.title}</h2>
              </div>
              <div className="source-workspace-canvas-actions">
                <label>
                  Trạng thái
                  <select
                    aria-label="Trạng thái Episode"
                    value={activeCanvas.episodeStatus || "draft"}
                    onChange={(event) =>
                      void updateEpisodeStatus(event.target.value).catch(
                        (value) => setError(String(value)),
                      )
                    }
                  >
                    <option value="draft">Bản nháp</option>
                    <option value="ready">Sẵn sàng</option>
                    <option value="published">Hoàn tất</option>
                  </select>
                </label>
                <Button
                  onClick={() =>
                    void save().catch((value) => setError(String(value)))
                  }
                >
                  <Save size={16} />
                  Lưu canvas
                </Button>
              </div>
            </header>
            <label htmlFor="canvas-notes">Ghi chú sáng tạo</label>
            <textarea
              id="canvas-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ý tưởng, shot list, prompt hoặc ghi chú sản xuất..."
            />
            <CanvasGraphPanel
              nodes={nodes}
              onChange={setNodes}
              onRun={(node) => void runNode(node)}
            />
            <WorkspaceToolboxPanel
              workspaceId={activeCanvas.workspaceId}
              nodes={nodes}
              onInsert={(inserted) =>
                setNodes((items) => [...items, ...inserted])
              }
            />
            <CanvasRevisionPanel
              canvas={activeCanvas}
              onRestore={(restored) => {
                setActiveCanvas(restored);
                setNotes(
                  typeof restored.snapshot.notes === "string"
                    ? restored.snapshot.notes
                    : "",
                );
                setNodes(readCanvasNodes(restored.snapshot.runItems));
                setStatus(`Đã khôi phục phiên bản ${restored.version}.`);
              }}
            />
            {status && <p role="status">{status}</p>}
            <section className="source-workspace-assets">
              <header>
                <h3>Assets ({assets.length})</h3>
                <div>
                  <Button
                    variant="ghost"
                    aria-label="Làm mới workspace assets"
                    onClick={() =>
                      void refreshAssets().catch((value) =>
                        setError(String(value)),
                      )
                    }
                  >
                    <RefreshCw size={15} />
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void importAssets().catch((value) =>
                        setError(String(value)),
                      )
                    }
                  >
                    <ImagePlus size={15} />
                    Thêm media
                  </Button>
                </div>
              </header>
              {assets.map((item) => (
                <article key={item.id}>
                  <span>{item.kind}</span>
                  <strong>{item.name}</strong>
                  <Button
                    variant="secondary"
                    aria-label={`Đưa ${item.name} vào canvas`}
                    onClick={() =>
                      void addAssetToCanvas(item).catch((value) =>
                        setError(String(value)),
                      )
                    }
                  >
                    <PackagePlus size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Lưu trữ ${item.name}`}
                    onClick={() =>
                      void archiveAsset(item.id).catch((value) =>
                        setError(String(value)),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </article>
              ))}
            </section>
          </>
        ) : (
          <div className="source-generation-empty">
            <FilePlus2 size={28} />
            <p>Chọn hoặc tạo canvas để bắt đầu.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
      </main>
    </section>
  );
}
