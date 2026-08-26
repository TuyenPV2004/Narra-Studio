import {
  CopyPlus,
  Image,
  Music2,
  Play,
  StickyNote,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";

export type CanvasNodeKind = "audio" | "image" | "note" | "video";
export interface CanvasNode extends Record<string, unknown> {
  id: string;
  kind: string;
  displayTitle: string;
  prompt: string;
  status: string;
  isManualDraft: boolean;
  isManualNode: boolean;
  canvasPosition: { x: number; y: number };
  dependsOnSceneId?: string | undefined;
  canvasGroupId?: string | undefined;
}

const kinds: Array<{ kind: CanvasNodeKind; label: string }> = [
  { kind: "note", label: "Ghi chú" },
  { kind: "image", label: "Image" },
  { kind: "video", label: "Video" },
  { kind: "audio", label: "Audio" },
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
export const readCanvasNodes = (value: unknown): CanvasNode[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    if (!isObject(entry) || typeof entry.id !== "string") return [];
    const position = isObject(entry.canvasPosition) ? entry.canvasPosition : {};
    return [
      {
        ...entry,
        id: entry.id,
        kind: typeof entry.kind === "string" ? entry.kind : "note",
        displayTitle:
          typeof entry.displayTitle === "string"
            ? entry.displayTitle
            : "Canvas node",
        prompt: typeof entry.prompt === "string" ? entry.prompt : "",
        status: typeof entry.status === "string" ? entry.status : "queued",
        isManualDraft: entry.isManualDraft !== false,
        isManualNode: entry.isManualNode !== false,
        canvasPosition: {
          x: typeof position.x === "number" ? position.x : 0,
          y: typeof position.y === "number" ? position.y : 0,
        },
        ...(typeof entry.dependsOnSceneId === "string"
          ? { dependsOnSceneId: entry.dependsOnSceneId }
          : {}),
        ...(typeof entry.canvasGroupId === "string"
          ? { canvasGroupId: entry.canvasGroupId }
          : {}),
      },
    ];
  });

export function CanvasGraphPanel({
  nodes,
  onChange,
  onRun,
}: {
  nodes: CanvasNode[];
  onChange: (nodes: CanvasNode[]) => void;
  onRun: (node: CanvasNode) => void;
}) {
  const [batchNodeIds, setBatchNodeIds] = useState<string[]>([]);
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);
  const groups = useMemo(
    () => [
      ...new Set(
        nodes
          .map((node) => node.canvasGroupId?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ],
    [nodes],
  );
  useEffect(() => {
    if (!batchNodeIds.length) return;
    const batch = nodes.filter((node) => batchNodeIds.includes(node.id));
    if (batch.some((node) => node.status === "processing")) return;
    if (batch.some((node) => node.status === "error")) {
      setBatchNodeIds([]);
      return;
    }
    const remaining = batch.filter((node) => node.status !== "done");
    if (!remaining.length) {
      setBatchNodeIds([]);
      return;
    }
    const ready = remaining.find(
      (node) =>
        !node.dependsOnSceneId ||
        nodes.find((item) => item.id === node.dependsOnSceneId)?.status ===
          "done",
    );
    if (!ready) {
      setBatchNodeIds([]);
      return;
    }
    onRunRef.current(ready);
  }, [batchNodeIds, nodes]);
  const add = (kind: CanvasNodeKind) =>
    onChange([
      ...nodes,
      {
        id: `source-node-${crypto.randomUUID()}`,
        kind,
        displayTitle:
          kind === "note"
            ? "Ghi chú mới"
            : kind === "image"
              ? "Image node"
              : kind === "video"
                ? "Video node"
                : "Audio node",
        prompt: "",
        status: "queued",
        isManualDraft: true,
        isManualNode: true,
        canvasPosition: {
          x: 80 + (nodes.length % 3) * 260,
          y: 80 + Math.floor(nodes.length / 3) * 210,
        },
      },
    ]);
  const update = (id: string, patch: Partial<CanvasNode>) =>
    onChange(
      nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    );
  const duplicate = (node: CanvasNode) =>
    onChange([
      ...nodes,
      {
        ...node,
        id: `source-node-${crypto.randomUUID()}`,
        displayTitle: `${node.displayTitle} copy`,
        canvasPosition: {
          x: node.canvasPosition.x + 32,
          y: node.canvasPosition.y + 32,
        },
      },
    ]);
  return (
    <section
      className="source-canvas-graph"
      aria-labelledby="canvas-graph-title"
    >
      <header>
        <div>
          <small>NODE CANVAS</small>
          <h3 id="canvas-graph-title">Creative graph ({nodes.length})</h3>
        </div>
        <div>
          {groups.map((group) => (
            <Button
              key={group}
              type="button"
              variant="secondary"
              disabled={batchNodeIds.length > 0}
              onClick={() =>
                setBatchNodeIds(
                  nodes
                    .filter(
                      (node) =>
                        node.canvasGroupId === group &&
                        (node.kind === "image" ||
                          node.kind === "video" ||
                          node.kind === "audio") &&
                        node.status !== "done",
                    )
                    .map((node) => node.id),
                )
              }
            >
              <Play size={14} />
              Chạy nhóm {group}
            </Button>
          ))}
          {kinds.map(({ kind, label }) => (
            <Button
              key={kind}
              type="button"
              variant="secondary"
              onClick={() => add(kind)}
            >
              {kind === "note" ? (
                <StickyNote size={14} />
              ) : kind === "image" ? (
                <Image size={14} />
              ) : kind === "audio" ? (
                <Music2 size={14} />
              ) : (
                <Video size={14} />
              )}
              {label}
            </Button>
          ))}
        </div>
      </header>
      {nodes.length ? (
        <div className="source-canvas-graph__grid">
          {nodes.map((node) => (
            <article key={node.id} data-kind={node.kind}>
              <header>
                <span>
                  {node.kind === "note" ? (
                    <StickyNote size={15} />
                  ) : node.kind === "image" ? (
                    <Image size={15} />
                  ) : node.kind === "audio" ? (
                    <Music2 size={15} />
                  ) : (
                    <Video size={15} />
                  )}
                  {node.kind}
                </span>
                <div>
                  {(node.kind === "image" ||
                    node.kind === "video" ||
                    node.kind === "audio" ||
                    node.kind === "note") && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Chạy ${node.displayTitle}`}
                      disabled={
                        !node.prompt.trim() || node.status === "processing"
                      }
                      onClick={() => onRun(node)}
                    >
                      <Play size={13} />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Nhân bản ${node.displayTitle}`}
                    onClick={() => duplicate(node)}
                  >
                    <CopyPlus size={13} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Xóa ${node.displayTitle}`}
                    onClick={() =>
                      onChange(nodes.filter((item) => item.id !== node.id))
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </header>
              <label>
                Tiêu đề
                <input
                  aria-label="Tiêu đề node"
                  value={node.displayTitle}
                  onChange={(event) =>
                    update(node.id, { displayTitle: event.target.value })
                  }
                />
              </label>
              <label>
                Prompt
                <textarea
                  aria-label="Prompt node"
                  rows={3}
                  value={node.prompt}
                  onChange={(event) =>
                    update(node.id, { prompt: event.target.value })
                  }
                />
              </label>
              <label>
                Phụ thuộc
                <Select
                  value={node.dependsOnSceneId || "none"}
                  onValueChange={(val) =>
                    update(node.id, {
                      dependsOnSceneId: val === "none" ? undefined : val,
                    })
                  }
                >
                  <SelectTrigger
                    aria-label={`Node phụ thuộc của ${node.displayTitle}`}
                  >
                    <SelectValue placeholder="Không phụ thuộc" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Không phụ thuộc</SelectItem>
                    {nodes
                      .filter((item) => item.id !== node.id)
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.displayTitle}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
              <label>
                Nhóm
                <input
                  aria-label={`Nhóm của ${node.displayTitle}`}
                  value={node.canvasGroupId || ""}
                  placeholder="Ví dụ: Scene 1"
                  onChange={(event) =>
                    update(node.id, {
                      canvasGroupId: event.target.value || undefined,
                    })
                  }
                />
              </label>
              {node.status !== "queued" && (
                <small role={node.status === "error" ? "alert" : "status"}>
                  {node.status === "processing"
                    ? "Đang chạy..."
                    : node.status === "done"
                      ? "Hoàn tất"
                      : String(node.error || node.status)}
                </small>
              )}
              {typeof node.src === "string" &&
                node.src &&
                (node.kind === "image" ? (
                  <img src={node.src} alt={node.displayTitle} />
                ) : node.kind === "audio" ? (
                  <audio controls src={node.src} preload="metadata" />
                ) : (
                  <video controls src={node.src} preload="metadata" />
                ))}
              {typeof node.textOutput === "string" && node.textOutput && (
                <pre className="source-canvas-node__text-output">
                  {node.textOutput}
                </pre>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="source-canvas-graph__empty">
          Thêm node thủ công để xây shot, prompt hoặc ghi chú. Node được lưu
          trong snapshot tương thích của Episode.
        </p>
      )}
    </section>
  );
}
