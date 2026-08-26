import { PackagePlus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CanvasNode } from "@/pages/AIAgent/components/CanvasGraphPanel";
import {
  workspaceApi,
  type WorkspaceToolbox,
} from "@/services/electron-api/workspace";

export function WorkspaceToolboxPanel({
  workspaceId,
  nodes,
  onInsert,
}: {
  workspaceId: string;
  nodes: CanvasNode[];
  onInsert: (nodes: CanvasNode[]) => void;
}) {
  const [toolboxes, setToolboxes] = useState<WorkspaceToolbox[]>([]);
  const [error, setError] = useState<string>();
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
  const refresh = useCallback(
    () =>
      workspaceApi
        .listToolboxes(workspaceId)
        .then(setToolboxes)
        .catch((value) =>
          setError(value instanceof Error ? value.message : String(value)),
        ),
    [workspaceId],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const saveGroup = async (group: string) => {
    const name = window.prompt("Tên toolbox", group)?.trim();
    if (!name) return;
    const value = await workspaceApi.saveToolbox(workspaceId, {
      id: `toolbox-${crypto.randomUUID()}`,
      name,
      nodes: nodes.filter((node) => node.canvasGroupId === group),
    });
    setToolboxes((items) => [
      value,
      ...items.filter((item) => item.id !== value.id),
    ]);
  };
  const insert = (item: WorkspaceToolbox) => {
    const idMap = new Map(
      item.nodes.flatMap((node) =>
        typeof node.id === "string"
          ? [[node.id, `source-node-${crypto.randomUUID()}`] as const]
          : [],
      ),
    );
    const groupId = `${item.name}-${Date.now()}`;
    const inserted = item.nodes.flatMap<CanvasNode>((raw, index) => {
      if (typeof raw.id !== "string") return [];
      const position =
        typeof raw.canvasPosition === "object" && raw.canvasPosition !== null
          ? (raw.canvasPosition as Record<string, unknown>)
          : {};
      const id = idMap.get(raw.id);
      if (!id) return [];
      return [
        {
          ...raw,
          id,
          kind: typeof raw.kind === "string" ? raw.kind : "note",
          displayTitle:
            typeof raw.displayTitle === "string"
              ? raw.displayTitle
              : `${item.name} ${index + 1}`,
          prompt: typeof raw.prompt === "string" ? raw.prompt : "",
          status: "queued",
          isManualDraft: true,
          isManualNode: true,
          canvasGroupId: groupId,
          canvasPosition: {
            x: Number(position.x || 0) + 40,
            y: Number(position.y || 0) + 40,
          },
          ...(typeof raw.dependsOnSceneId === "string" &&
          idMap.has(raw.dependsOnSceneId)
            ? { dependsOnSceneId: idMap.get(raw.dependsOnSceneId) }
            : { dependsOnSceneId: undefined }),
        },
      ];
    });
    onInsert(inserted);
  };
  const remove = async (item: WorkspaceToolbox) => {
    if (!window.confirm(`Xóa toolbox “${item.name}”?`)) return;
    await workspaceApi.deleteToolbox(workspaceId, item.id);
    setToolboxes((items) => items.filter((value) => value.id !== item.id));
  };
  return (
    <details className="source-workspace-toolbox">
      <summary>
        <PackagePlus size={15} /> Toolbox ({toolboxes.length})
      </summary>
      <div>
        {groups.map((group) => (
          <Button
            key={group}
            type="button"
            variant="secondary"
            onClick={() =>
              void saveGroup(group).catch((value) =>
                setError(
                  value instanceof Error ? value.message : String(value),
                ),
              )
            }
          >
            <Save size={14} /> Lưu nhóm {group}
          </Button>
        ))}
        {!groups.length && (
          <small>Gán tên nhóm cho node để lưu template.</small>
        )}
      </div>
      {toolboxes.map((item) => (
        <article key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <small>{item.nodes.length} node</small>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => insert(item)}
          >
            Chèn
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-label={`Xóa toolbox ${item.name}`}
            onClick={() =>
              void remove(item).catch((value) =>
                setError(
                  value instanceof Error ? value.message : String(value),
                ),
              )
            }
          >
            <Trash2 size={14} />
          </Button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
