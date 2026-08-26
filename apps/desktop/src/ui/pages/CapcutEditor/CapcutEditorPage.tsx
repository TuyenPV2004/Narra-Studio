import {
  Copy,
  Film,
  FolderPlus,
  GripVertical,
  Pencil,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  editorApi,
  editorClipDuration,
  type EditorClip,
  type EditorProject,
  type EditorProjectMeta,
  type EditorTransition,
} from "@/services/electron-api/editor";
import {
  builtInEffects,
  builtInTransitions,
  ClipInspector,
} from "@/pages/CapcutEditor/ClipInspector";
import {
  userPresetApi,
  type UserPresetLibrary,
} from "@/services/electron-api/user-presets";
import {
  defaultEditorTracks,
  ensureTimelineProject,
  flattenVisibleVideoTimeline,
  projectTracks,
  timelineDuration,
} from "@/pages/CapcutEditor/editor-timeline";

const createProject = (): EditorProject => ({
  id: `proj-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`,
  name: "Project mới",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  duration: 0,
  aspectRatio: "16:9",
  clips: [],
  tracks: defaultEditorTracks(),
});
const mediaType = (path: string): NonNullable<EditorClip["trackType"]> =>
  /\.(?:aac|flac|m4a|mp3|ogg|wav)$/i.test(path)
    ? "audio"
    : /\.(?:avif|jpe?g|png|webp)$/i.test(path)
      ? "image"
      : "video";

export function CapcutEditorPage() {
  const [projects, setProjects] = useState<EditorProjectMeta[]>([]);
  const [project, setProject] = useState<EditorProject>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [draggedClipId, setDraggedClipId] = useState<string>();
  const draggedClipIdRef = useRef<string | undefined>(undefined);
  const [userPresets, setUserPresets] = useState<UserPresetLibrary>({
    version: 1,
    transitions: [],
    effects: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const duration = useMemo(
    () => timelineDuration(project?.clips ?? []),
    [project],
  );
  const tracks = useMemo(
    () => (project ? projectTracks(project) : []),
    [project],
  );
  const selectedClip =
    project?.clips.find((item) => item.id === selectedClipId) ??
    project?.clips[0];
  const selectedClipIndex =
    project && selectedClip
      ? project.clips.findIndex((item) => item.id === selectedClip.id)
      : -1;
  const transitions = useMemo(
    () => [
      ...builtInTransitions,
      ...userPresets.transitions.map((item) => ({
        libraryId: item.id,
        name: item.name,
        type: item.type,
        duration: item.defaultDuration,
      })),
    ],
    [userPresets.transitions],
  );
  const effects = useMemo(
    () => [
      ...builtInEffects,
      ...userPresets.effects.map((item) => ({
        libraryId: item.id,
        name: item.name,
        type: item.type,
        params: item.defaults,
        startTime: 0,
        endTime: 0,
      })),
    ],
    [userPresets.effects],
  );
  const updateSelectedClip = (patch: Partial<EditorClip>) =>
    setProject((current) =>
      current
        ? {
            ...current,
            clips: current.clips.map((item) =>
              item.id === selectedClip?.id ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  const updateSelectedTransition = (transition?: EditorTransition) =>
    setProject((current) =>
      current
        ? {
            ...current,
            clips: current.clips.map((item) => {
              if (item.id !== selectedClip?.id) return item;
              if (transition) return { ...item, transitionOut: transition };
              const { transitionOut: _removed, ...rest } = item;
              return rest;
            }),
          }
        : current,
    );
  const refresh = async () => setProjects(await editorApi.listProjects());
  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
    void userPresetApi
      .load()
      .then((value) => {
        setUserPresets(value);
        if (value.errors.length) setError(value.errors.join(" "));
      })
      .catch((value) => setError(String(value)));
  }, []);
  const open = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const value = await editorApi.getProject(id);
      if (value) setProject(ensureTimelineProject(value));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!project) return;
    setBusy(true);
    setError(undefined);
    try {
      await editorApi.saveProject({ ...project, duration });
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const importMedia = async () => {
    if (!project) return;
    const paths = await editorApi.selectMedia();
    const imported = await Promise.all(
      paths.map(async (path): Promise<EditorClip> => {
        const trackType = mediaType(path);
        const targetTrack =
          tracks.find((track) => track.trackType === trackType) ??
          tracks.find((track) => track.trackType === "video");
        return {
          id: `clip-${crypto.randomUUID()}`,
          path,
          name: decodeURIComponent(path.split("/").pop() || "Media"),
          duration: await editorApi.duration(path),
          trackType,
          ...(targetTrack ? { trackId: targetTrack.id } : {}),
          startTime: trackType === "audio" ? 0 : duration,
          volume: 100,
          scale: 100,
          opacity: 100,
        };
      }),
    );
    setProject((current) =>
      current
        ? { ...current, clips: [...current.clips, ...imported] }
        : current,
    );
  };
  const move = (index: number, delta: number) =>
    setProject((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.clips.length) return current;
      const clips = [...current.clips];
      const [item] = clips.splice(index, 1);
      if (!item) return current;
      clips.splice(target, 0, item);
      return { ...current, clips };
    });
  const dropClip = (targetId: string) => {
    const sourceId = draggedClipIdRef.current;
    if (!sourceId || sourceId === targetId) {
      draggedClipIdRef.current = undefined;
      return setDraggedClipId(undefined);
    }
    setProject((current) => {
      if (!current) return current;
      const clips = [...current.clips];
      const sourceIndex = clips.findIndex((clip) => clip.id === sourceId);
      const targetIndex = clips.findIndex((clip) => clip.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [moved] = clips.splice(sourceIndex, 1);
      if (!moved) return current;
      clips.splice(targetIndex, 0, moved);
      return { ...current, clips };
    });
    draggedClipIdRef.current = undefined;
    setDraggedClipId(undefined);
  };
  const removeProject = async (id: string) => {
    await editorApi.deleteProject(id);
    if (project?.id === id) setProject(undefined);
    await refresh();
  };
  const duplicate = async (item: EditorProjectMeta) => {
    await editorApi.duplicateProject(item.id, `${item.name} (bản sao)`);
    await refresh();
  };
  const renameProject = async (item: EditorProjectMeta) => {
    const name = window.prompt("Tên project", item.name)?.trim();
    if (!name || name === item.name) return;
    await editorApi.renameProject(item.id, name);
    await refresh();
  };
  const exportProject = async () => {
    if (!project) return;
    const videoClips = flattenVisibleVideoTimeline(project);
    if (!videoClips.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await editorApi.export(
        videoClips,
        `${project.name}.mp4`,
        project.aspectRatio,
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const addTrack = (trackType: "audio" | "video") =>
    setProject((current) =>
      current
        ? {
            ...current,
            tracks: [
              ...projectTracks(current),
              {
                id: `track-${trackType}-${crypto.randomUUID()}`,
                name: `${trackType === "video" ? "Video" : "Audio"} ${projectTracks(current).filter((track) => track.trackType === trackType).length + 1}`,
                trackType,
              },
            ],
          }
        : current,
    );
  const updateTrack = (id: string, patch: Record<string, unknown>) =>
    setProject((current) =>
      current
        ? {
            ...current,
            tracks: projectTracks(current).map((track) =>
              track.id === id ? { ...track, ...patch } : track,
            ),
          }
        : current,
    );
  const importPresets = async () => {
    const imported = await userPresetApi.import();
    if (!imported) return;
    if (imported.errors.length) throw new Error(imported.errors.join(" "));
    const merged = userPresetApi.merge(userPresets, imported);
    await userPresetApi.save(merged);
    setUserPresets(merged);
  };
  const clearPresets = async () => {
    const empty: UserPresetLibrary = {
      version: 1,
      transitions: [],
      effects: [],
    };
    await userPresetApi.save(empty);
    setUserPresets(empty);
  };

  if (!project)
    return (
      <section
        className="source-editor-projects"
        aria-labelledby="editor-projects-title"
      >
        <header>
          <div>
            <small>CHỈNH SỬA VIDEO</small>
            <h1 id="editor-projects-title">
              <Film size={22} />
              Studio dựng video
            </h1>
            <p>Project được lưu cục bộ và có thể mở lại đúng timeline.</p>
          </div>
          <Button onClick={() => setProject(createProject())}>
            <FolderPlus size={16} />
            Project mới
          </Button>
        </header>
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
        <div className="source-project-grid">
          {projects.map((item) => (
            <article key={item.id} className="narra-card">
              <button
                type="button"
                onClick={() => void open(item.id)}
                disabled={busy}
              >
                <Film size={24} />
                <strong>{item.name}</strong>
                <span>{Math.round(item.duration)} giây</span>
              </button>
              <div>
                <Button
                  variant="ghost"
                  aria-label={`Nhân bản ${item.name}`}
                  onClick={() => void duplicate(item)}
                >
                  <Copy size={15} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Đổi tên ${item.name}`}
                  onClick={() => void renameProject(item)}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Xóa ${item.name}`}
                  onClick={() => void removeProject(item.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </article>
          ))}
        </div>
        {!projects.length && (
          <div className="source-generation-empty">
            <Film size={30} />
            <p>Chưa có project. Tạo project đầu tiên để bắt đầu.</p>
          </div>
        )}
      </section>
    );

  const previewStyle = selectedClip
    ? {
        transform: `translate(${selectedClip.posX ?? 0}px, ${selectedClip.posY ?? 0}px) scale(${(selectedClip.scale ?? 100) / 100}) rotate(${selectedClip.rotation ?? 0}deg) scaleX(${selectedClip.flipH ? -1 : 1}) scaleY(${selectedClip.flipV ? -1 : 1})`,
        opacity: selectedClip.blendEnabled
          ? (selectedClip.opacity ?? 100) / 100
          : 1,
      }
    : undefined;
  const renderedLipSync = selectedClip?.lipSyncCfg?.renderOutputUrl;
  const previewVideoSrc =
    selectedClip?.lipSync && typeof renderedLipSync === "string"
      ? renderedLipSync
      : selectedClip?.path;
  return (
    <section className="source-capcut-page" aria-labelledby="capcut-title">
      <header>
        <div>
          <small>DỰNG VIDEO</small>
          <h1 id="capcut-title">
            <Film size={22} />
            <input
              aria-label="Tên project"
              value={project.name}
              onChange={(event) =>
                setProject({ ...project, name: event.target.value })
              }
            />
          </h1>
          <p>
            {project.clips.length} media · {tracks.length} tracks ·{" "}
            {duration.toFixed(1)} giây · {project.aspectRatio}
          </p>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setProject(undefined)}>
            Projects
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !project.name.trim()}
          >
            <Save size={16} />
            Lưu
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="source-generation-error">
          {error}
        </p>
      )}
      <div className="source-capcut-workspace">
        <aside className="narra-card">
          <h2>Media</h2>
          <Button onClick={() => void importMedia()}>
            <Upload size={16} />
            Import media
          </Button>
          <p>Video, hình ảnh và âm thanh được tham chiếu từ file gốc.</p>
          <details className="source-track-manager">
            <summary>Tracks ({tracks.length})</summary>
            <div>
              <Button variant="secondary" onClick={() => addTrack("video")}>
                + Video track
              </Button>
              <Button variant="secondary" onClick={() => addTrack("audio")}>
                + Audio track
              </Button>
            </div>
            {tracks.map((track) => (
              <article key={track.id}>
                <strong>{track.name}</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={track.hidden ?? false}
                    onChange={(event) =>
                      updateTrack(track.id, { hidden: event.target.checked })
                    }
                  />
                  Ẩn
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={track.locked ?? false}
                    onChange={(event) =>
                      updateTrack(track.id, { locked: event.target.checked })
                    }
                  />
                  Khóa
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={track.muted ?? false}
                    onChange={(event) =>
                      updateTrack(track.id, { muted: event.target.checked })
                    }
                  />
                  Tắt tiếng
                </label>
              </article>
            ))}
          </details>
        </aside>
        <section className="source-capcut-preview narra-card">
          {selectedClip ? (
            selectedClip.trackType === "audio" ? (
              <audio
                controls
                muted={selectedClip.muted}
                src={selectedClip.path}
              />
            ) : selectedClip.trackType === "image" ? (
              <img
                alt={selectedClip.name}
                src={selectedClip.path}
                style={previewStyle}
              />
            ) : (
              <video
                controls
                muted={selectedClip.muted}
                src={previewVideoSrc}
                style={previewStyle}
              />
            )
          ) : (
            <div className="source-generation-empty">
              <Film size={30} />
              <p>Import media để bắt đầu dựng.</p>
            </div>
          )}
        </section>
        <aside className="narra-card">
          <h2>Project</h2>
          <label>
            Tỷ lệ
            <select
              value={project.aspectRatio}
              onChange={(event) =>
                setProject({ ...project, aspectRatio: event.target.value })
              }
            >
              <option>16:9</option>
              <option>9:16</option>
              <option>1:1</option>
            </select>
          </label>
          <Button
            onClick={() => void exportProject()}
            disabled={busy || flattenVisibleVideoTimeline(project).length < 1}
          >
            Export video
          </Button>
          <details className="source-preset-library">
            <summary>
              User presets (
              {userPresets.transitions.length + userPresets.effects.length})
            </summary>
            <div>
              <Button
                variant="secondary"
                onClick={() =>
                  void importPresets().catch((value) => setError(String(value)))
                }
              >
                Import JSON
              </Button>
              <Button
                variant="ghost"
                onClick={() => void userPresetApi.exportTemplate("transition")}
              >
                Template transition
              </Button>
              <Button
                variant="ghost"
                onClick={() => void userPresetApi.exportTemplate("effect")}
              >
                Template effect
              </Button>
              <Button
                variant="danger"
                disabled={
                  !userPresets.transitions.length && !userPresets.effects.length
                }
                onClick={() =>
                  void clearPresets().catch((value) => setError(String(value)))
                }
              >
                Xóa presets
              </Button>
            </div>
          </details>
          {selectedClip && (
            <ClipInspector
              clip={selectedClip}
              effects={effects}
              hasNextClip={
                selectedClipIndex >= 0 &&
                selectedClipIndex < project.clips.length - 1
              }
              onChange={updateSelectedClip}
              onTransitionChange={updateSelectedTransition}
              transitions={transitions}
            />
          )}
        </aside>
      </div>
      <section
        className="source-capcut-timeline narra-card"
        aria-label="Timeline"
      >
        <header>
          <h2>Timeline</h2>
          <span>{duration.toFixed(1)}s</span>
        </header>
        {project.clips.map((item, index) => (
          <article
            key={item.id}
            draggable
            onDragStart={(event) => {
              draggedClipIdRef.current = item.id;
              setDraggedClipId(item.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropClip(item.id);
            }}
            onDragEnd={() => {
              draggedClipIdRef.current = undefined;
              setDraggedClipId(undefined);
            }}
            data-dragging={draggedClipId === item.id}
            data-track-type={item.trackType ?? "video"}
          >
            <GripVertical size={16} />
            <button
              type="button"
              onClick={() => move(index, -1)}
              aria-label={`Di chuyển ${item.name} sang trái`}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              aria-label={`Di chuyển ${item.name} sang phải`}
            >
              →
            </button>
            <button
              type="button"
              data-selected={selectedClip?.id === item.id}
              onClick={() => setSelectedClipId(item.id)}
            >
              <strong>{item.name}</strong>
              <small>
                {tracks.find((track) => track.id === item.trackId)?.name ??
                  item.trackType ??
                  "video"}
                {item.transitionOut
                  ? ` · ${item.transitionOut.name} · ${item.transitionOut.duration.toFixed(1)}s`
                  : ""}
              </small>
            </button>
            <label>
              Bắt đầu
              <input
                aria-label={`Bắt đầu timeline ${item.name}`}
                type="number"
                min={0}
                step={0.1}
                value={item.startTime ?? 0}
                onChange={(event) =>
                  setProject({
                    ...project,
                    clips: project.clips.map((clip) =>
                      clip.id === item.id
                        ? { ...clip, startTime: Number(event.target.value) }
                        : clip,
                    ),
                  })
                }
              />
            </label>
            <label>
              Track
              <select
                aria-label={`Track của ${item.name}`}
                value={item.trackId ?? tracks[0]?.id}
                onChange={(event) =>
                  setProject({
                    ...project,
                    clips: project.clips.map((clip) =>
                      clip.id === item.id
                        ? {
                            ...clip,
                            trackId: event.target.value,
                            trackType:
                              tracks.find(
                                (track) => track.id === event.target.value,
                              )?.trackType === "audio"
                                ? "audio"
                                : "video",
                          }
                        : clip,
                    ),
                  })
                }
              >
                {tracks
                  .filter(
                    (track) =>
                      track.trackType === "video" ||
                      track.trackType === "audio",
                  )
                  .map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
              </select>
            </label>
            <span>{editorClipDuration(item).toFixed(1)}s</span>
            <Button
              variant="ghost"
              aria-label={`Xóa ${item.name}`}
              onClick={() =>
                setProject({
                  ...project,
                  clips: project.clips.filter((clip) => clip.id !== item.id),
                })
              }
            >
              <Trash2 size={15} />
            </Button>
          </article>
        ))}
      </section>
    </section>
  );
}
