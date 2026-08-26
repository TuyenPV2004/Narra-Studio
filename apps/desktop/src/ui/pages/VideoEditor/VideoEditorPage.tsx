import {
  ArrowLeft,
  Download,
  Film,
  FolderOpen,
  GripVertical,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  emptyVideoEditorProject,
  type VideoEditorClip,
  type VideoEditorProject,
  videoEditorApi,
} from "@/services/electron-api/video-editor";
import { VideoEditorInspector } from "@/pages/VideoEditor/VideoEditorInspector";
import { VideoEditorProjectList } from "@/pages/VideoEditor/VideoEditorProjectList";

const fileName = (path: string) =>
  decodeURIComponent(path.split("/").pop() || "Video");
const selectedPaths = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(
    (item): item is string => typeof item === "string",
  );

export function VideoEditorPage() {
  const [projects, setProjects] = useState<
    Awaited<ReturnType<typeof videoEditorApi.listProjects>>
  >([]);
  const [project, setProject] = useState<VideoEditorProject>();
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [output, setOutput] = useState("");
  const refresh = useCallback(
    async () => setProjects(await videoEditorApi.listProjects()),
    [],
  );
  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
  }, [refresh]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await operation();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<VideoEditorProject>) =>
    setProject((current) => (current ? { ...current, ...patch } : current));
  const openProject = (id: string) =>
    void run(async () => {
      setProject(await videoEditorApi.loadProject(id));
      setOutput("");
    });
  const deleteProject = (id: string) =>
    void run(async () => {
      await videoEditorApi.deleteProject(id);
      await refresh();
    });
  const save = () =>
    project &&
    void run(async () => {
      const id = await videoEditorApi.saveProject(project);
      setProject({ ...project, id });
      await refresh();
      setStatus("Đã lưu project.");
    });
  const selectPrimaryVideo = () =>
    project &&
    void run(async () => {
      const path = selectedPaths(await videoEditorApi.selectVideos())[0];
      if (!path) return;
      const info = await videoEditorApi.videoInfo(path);
      update({
        videoSrc: path,
        videoName: fileName(path),
        trimStart: 0,
        trimEnd: info.duration || 10,
      });
    });
  const addTimelineClips = () =>
    project &&
    void run(async () => {
      const paths = selectedPaths(await videoEditorApi.selectVideos());
      const clips = await Promise.all(
        paths.map(async (path): Promise<VideoEditorClip> => {
          const info = await videoEditorApi.videoInfo(path);
          return {
            filePath: path,
            name: fileName(path),
            duration: info.duration,
            startTime: 0,
            endTime: info.duration,
          };
        }),
      );
      update({
        timelineClips: [...project.timelineClips, ...clips],
        timelineTransitions: [
          ...project.timelineTransitions,
          ...clips
            .slice(project.timelineClips.length ? 0 : 1)
            .map(() => ({ type: "dissolve", duration: 0.5 })),
        ],
      });
    });
  const moveClip = (index: number, delta: number) => {
    if (!project) return;
    const target = index + delta;
    if (target < 0 || target >= project.timelineClips.length) return;
    const clips = [...project.timelineClips];
    const [clip] = clips.splice(index, 1);
    if (!clip) return;
    clips.splice(target, 0, clip);
    update({ timelineClips: clips });
  };
  const pickSubtitle = () =>
    project &&
    void run(async () => {
      const path = await videoEditorApi.selectSubtitle();
      if (typeof path === "string")
        update({ subtitlePath: path, subtitleName: fileName(path) });
    });
  const pickAudio = () =>
    project &&
    void run(async () => {
      const path = await videoEditorApi.selectAudio();
      if (typeof path === "string")
        update({ bgmPath: path, bgmName: fileName(path) });
    });
  const generateSubtitles = () =>
    project?.videoSrc &&
    void run(async () => {
      const value = await videoEditorApi.generateSubtitles(
        project.videoSrc,
        Math.max(0, project.trimEnd - project.trimStart),
        transcript,
      );
      update({
        subtitlePath: value.srtPath,
        subtitleName: "auto_subtitle.srt",
      });
      setStatus("Đã tạo phụ đề AI.");
    });
  const detectWatermark = () =>
    project?.videoSrc &&
    void run(async () => {
      update({
        delogoRegions: await videoEditorApi.detectWatermark(
          project.videoSrc,
          project.trimStart || 1,
        ),
      });
      setStatus("Đã quét watermark.");
    });
  const exportVideo = () =>
    project?.videoSrc &&
    void run(async () => {
      const value = await videoEditorApi.export(
        project,
        `${project.name || "edited-video"}.mp4`,
      );
      if (typeof value === "string") setOutput(value);
      setStatus("Đã xuất video.");
    });
  const mergeTimeline = () =>
    project &&
    project.timelineClips.length >= 2 &&
    void run(async () => {
      const folder = await videoEditorApi.selectOutputFolder();
      if (folder !== null && typeof folder !== "string") return;
      const value = await videoEditorApi.merge(
        project,
        typeof folder === "string" ? folder : undefined,
      );
      if (typeof value === "string") setOutput(value);
      setStatus("Đã ghép timeline.");
    });

  if (!project)
    return (
      <>
        <VideoEditorProjectList
          busy={busy}
          projects={projects}
          onCreate={() => setProject(emptyVideoEditorProject())}
          onDelete={deleteProject}
          onOpen={openProject}
        />
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
      </>
    );
  return (
    <section
      className="source-video-editor-page"
      aria-labelledby="video-editor-title"
    >
      <header>
        <div>
          <small>VIDEO EDITOR</small>
          <h1 id="video-editor-title">
            <Film size={22} />
            <input
              aria-label="Tên project video editor"
              value={project.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </h1>
          <p>Trim, subtitle, watermark, BGM và multi-clip transition.</p>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setProject(undefined)}>
            <ArrowLeft size={15} />
            Projects
          </Button>
          <Button disabled={busy || !project.name.trim()} onClick={save}>
            <Save size={15} />
            Lưu
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="source-generation-error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <div className="source-video-editor-layout">
        <section className="source-video-editor-preview narra-card">
          {project.videoSrc ? (
            <video
              controls
              src={project.videoSrc}
              style={{
                transform: `rotate(${project.rotate}deg) scaleX(${project.flipH ? -1 : 1}) scaleY(${project.flipV ? -1 : 1})`,
              }}
            />
          ) : (
            <div className="source-generation-empty">
              <Film size={30} />
              <p>Chọn video chính để bắt đầu.</p>
            </div>
          )}
          <Button variant="secondary" onClick={selectPrimaryVideo}>
            <Upload size={15} />
            Chọn video chính
          </Button>
        </section>
        <VideoEditorInspector
          busy={busy}
          project={project}
          transcript={transcript}
          onChange={update}
          onTranscriptChange={setTranscript}
          onPickSubtitle={pickSubtitle}
          onPickAudio={pickAudio}
          onGenerateSubtitles={generateSubtitles}
          onDetectWatermark={detectWatermark}
          onRemoveWatermark={(index) =>
            update({
              delogoRegions: project.delogoRegions.filter(
                (_item, itemIndex) => itemIndex !== index,
              ),
            })
          }
        />
      </div>
      <section className="source-video-editor-timeline narra-card">
        <header>
          <h2>Multi-clip timeline</h2>
          <div>
            <Button variant="secondary" onClick={addTimelineClips}>
              <FolderOpen size={15} />
              Thêm clips
            </Button>
            <Button
              disabled={busy || project.timelineClips.length < 2}
              onClick={mergeTimeline}
            >
              Ghép với transition
            </Button>
          </div>
        </header>
        {project.timelineClips.map((clip, index) => (
          <article key={`${clip.filePath}-${index}`}>
            <GripVertical size={15} />
            <strong>{clip.name}</strong>
            <label>
              In
              <input
                type="number"
                min={0}
                step={0.1}
                value={clip.startTime}
                onChange={(event) =>
                  update({
                    timelineClips: project.timelineClips.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, startTime: Number(event.target.value) }
                          : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              Out
              <input
                type="number"
                min={0}
                step={0.1}
                value={clip.endTime}
                onChange={(event) =>
                  update({
                    timelineClips: project.timelineClips.map(
                      (item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, endTime: Number(event.target.value) }
                          : item,
                    ),
                  })
                }
              />
            </label>
            {index < project.timelineClips.length - 1 && (
              <label>
                Transition
                <select
                  aria-label={`Transition sau ${clip.name}`}
                  value={project.timelineTransitions[index]?.type ?? "none"}
                  onChange={(event) => {
                    const transitions = [...project.timelineTransitions];
                    transitions[index] = {
                      type: event.target.value,
                      duration: transitions[index]?.duration ?? 0.5,
                    };
                    update({ timelineTransitions: transitions });
                  }}
                >
                  <option value="none">Không</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="fade">Fade</option>
                  <option value="wipeleft">Wipe left</option>
                  <option value="slideleft">Slide left</option>
                </select>
              </label>
            )}
            <Button
              variant="ghost"
              aria-label={`Di chuyển ${clip.name} lên`}
              onClick={() => moveClip(index, -1)}
            >
              ←
            </Button>
            <Button
              variant="ghost"
              aria-label={`Di chuyển ${clip.name} xuống`}
              onClick={() => moveClip(index, 1)}
            >
              →
            </Button>
            <Button
              variant="ghost"
              aria-label={`Xóa ${clip.name}`}
              onClick={() =>
                update({
                  timelineClips: project.timelineClips.filter(
                    (_item, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </article>
        ))}
        {!project.timelineClips.length && (
          <p className="narra-helper-text">
            Thêm ít nhất hai clip để ghép chuyển cảnh.
          </p>
        )}
      </section>
      <footer className="source-video-editor-actions">
        <Button
          disabled={
            busy || !project.videoSrc || project.trimEnd <= project.trimStart
          }
          onClick={exportVideo}
        >
          <Download size={15} />
          Xuất video
        </Button>
        {output && (
          <Button
            variant="secondary"
            onClick={() => void videoEditorApi.showInFolder(output)}
          >
            Mở trong thư mục
          </Button>
        )}
      </footer>
    </section>
  );
}
