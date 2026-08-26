import { Archive, Download, History, RotateCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  workspaceApi,
  type Canvas,
  type CanvasRevision,
} from "@/services/electron-api/workspace";

interface CanvasRevisionPanelProps {
  canvas: Canvas;
  onRestore: (canvas: Canvas) => void;
}

export function CanvasRevisionPanel({
  canvas,
  onRestore,
}: CanvasRevisionPanelProps) {
  const [revisions, setRevisions] = useState<CanvasRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const refresh = async () =>
    setRevisions(await workspaceApi.listRevisions(canvas.id));

  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
  }, [canvas.id, canvas.version]);
  const restore = async (version: number) => {
    setBusy(true);
    setError(undefined);
    try {
      onRestore(await workspaceApi.restoreRevision(canvas.id, version));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const exportWorkspace = async (fullBackup: boolean) => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const workspaces = await workspaceApi.list();
      const workspace = workspaces.find(
        (item) => item.id === canvas.workspaceId,
      );
      if (!workspace) throw new Error("Workspace không còn tồn tại.");
      const [canvases, assets] = await Promise.all([
        workspaceApi.listCanvases(workspace.id),
        workspaceApi.listAssets(workspace.id),
      ]);
      const result = await workspaceApi.exportPackage(
        workspace,
        canvases,
        assets,
        fullBackup,
      );
      if (result)
        setStatus(
          fullBackup
            ? "Đã tạo backup Workspace trong thư mục đã chọn."
            : "Đã xuất Workspace JSON.",
        );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const importWorkspace = async () => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const result = await workspaceApi.importPackage();
      if (result)
        setStatus(
          `Đã nhập “${result.workspace.name}”: ${result.episodeCount} Episode, ${result.assetCount} asset. Mở lại tab Workspace để làm mới danh sách.`,
        );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <details className="source-canvas-revisions">
        <summary>
          <History size={15} />
          Lịch sử phiên bản ({revisions.length})
        </summary>
        {revisions.length ? (
          <div>
            {[...revisions].reverse().map((revision) => (
              <article key={revision.version}>
                <div>
                  <strong>Phiên bản {revision.version}</strong>
                  <small>
                    {revision.createdAt
                      ? new Date(revision.createdAt).toLocaleString("vi-VN")
                      : "Local revision"}
                  </small>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void restore(revision.version)}
                >
                  <RotateCcw size={14} />
                  Khôi phục
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <p className="narra-helper-text">
            Lịch sử được tạo sau mỗi lần lưu canvas.
          </p>
        )}
      </details>
      <details className="source-canvas-revisions">
        <summary>
          <Archive size={15} />
          Gói Workspace
        </summary>
        <div className="source-workspace-package-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void exportWorkspace(false)}
          >
            <Download size={14} />
            Xuất JSON
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void exportWorkspace(true)}
          >
            <Archive size={14} />
            Backup thư mục
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void importWorkspace()}
          >
            <Upload size={14} />
            Nhập Workspace
          </Button>
        </div>
        {status && (
          <p role="status" className="narra-helper-text">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
      </details>
    </>
  );
}
