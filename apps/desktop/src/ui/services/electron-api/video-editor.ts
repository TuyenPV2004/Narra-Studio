import { getElectronApi } from "@/services/electron-api/client";

export interface VideoEditorProjectMeta extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  videoName: string;
}

export interface VideoEditorClip extends Record<string, unknown> {
  filePath: string;
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
}

export interface WatermarkRegion extends Record<string, unknown> {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface VideoEditorProject extends Record<string, unknown> {
  id?: string;
  name: string;
  description: string;
  videoSrc: string;
  videoName: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  volume: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  subtitlePath: string;
  subtitleName: string;
  bgmPath: string;
  bgmName: string;
  bgmVolume: number;
  fadeIn: number;
  fadeOut: number;
  delogoRegions: WatermarkRegion[];
  timelineClips: VideoEditorClip[];
  timelineTransitions: Array<{ type: string; duration: number }>;
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const boolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

export const emptyVideoEditorProject = (): VideoEditorProject => ({
  name: "Project mới",
  description: "",
  videoSrc: "",
  videoName: "",
  trimStart: 0,
  trimEnd: 10,
  speed: 1,
  volume: 1,
  rotate: 0,
  flipH: false,
  flipV: false,
  subtitlePath: "",
  subtitleName: "",
  bgmPath: "",
  bgmName: "",
  bgmVolume: 0.35,
  fadeIn: 0,
  fadeOut: 0,
  delogoRegions: [],
  timelineClips: [],
  timelineTransitions: [],
});

const normalizeRegion = (value: unknown): WatermarkRegion | undefined => {
  const item = object(value);
  if (
    ![item.x, item.y, item.w, item.h].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  )
    return undefined;
  return {
    ...item,
    x: item.x as number,
    y: item.y as number,
    w: item.w as number,
    h: item.h as number,
    ...(typeof item.label === "string" ? { label: item.label } : {}),
  };
};

const normalizeClip = (value: unknown): VideoEditorClip | undefined => {
  const item = object(value);
  const filePath = text(item.filePath);
  if (!filePath) return undefined;
  const duration = Math.max(0, number(item.duration));
  return {
    ...item,
    filePath,
    name: text(item.name, filePath.split(/[\\/]/).pop() || "Video"),
    duration,
    startTime: Math.max(0, number(item.startTime)),
    endTime: Math.max(0, number(item.endTime, duration)),
  };
};

export const normalizeVideoEditorProject = (
  value: unknown,
): VideoEditorProject => {
  const item = object(value);
  const fallback = emptyVideoEditorProject();
  return {
    ...item,
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    name: text(item.name, fallback.name),
    description: text(item.description),
    videoSrc: text(item.videoSrc),
    videoName: text(item.videoName),
    trimStart: Math.max(0, number(item.trimStart)),
    trimEnd: Math.max(0, number(item.trimEnd, fallback.trimEnd)),
    speed: Math.max(0.25, number(item.speed, 1)),
    volume: Math.max(0, number(item.volume, 1)),
    rotate: number(item.rotate),
    flipH: boolean(item.flipH),
    flipV: boolean(item.flipV),
    subtitlePath: text(item.subtitlePath),
    subtitleName: text(item.subtitleName),
    bgmPath: text(item.bgmPath),
    bgmName: text(item.bgmName),
    bgmVolume: Math.max(0, number(item.bgmVolume, fallback.bgmVolume)),
    fadeIn: Math.max(0, number(item.fadeIn)),
    fadeOut: Math.max(0, number(item.fadeOut)),
    delogoRegions: (Array.isArray(item.delogoRegions) ? item.delogoRegions : [])
      .map(normalizeRegion)
      .filter((entry): entry is WatermarkRegion => Boolean(entry)),
    timelineClips: (Array.isArray(item.timelineClips) ? item.timelineClips : [])
      .map(normalizeClip)
      .filter((entry): entry is VideoEditorClip => Boolean(entry)),
    timelineTransitions: (Array.isArray(item.timelineTransitions)
      ? item.timelineTransitions
      : []
    ).flatMap((entry) => {
      const transition = object(entry);
      return typeof transition.type === "string"
        ? [
            {
              type: transition.type,
              duration: Math.max(0, number(transition.duration, 0.5)),
            },
          ]
        : [];
    }),
  };
};

export const videoEditorApi = {
  async listProjects(): Promise<VideoEditorProjectMeta[]> {
    const value = await getElectronApi().listVideoProjects();
    return (Array.isArray(value) ? value : []).flatMap((entry) => {
      const item = object(entry);
      return typeof item.id === "string"
        ? [
            {
              ...item,
              id: item.id,
              name: text(item.name, item.id),
              description: text(item.description),
              updatedAt: text(item.updatedAt),
              videoName: text(item.videoName),
            },
          ]
        : [];
    });
  },
  async loadProject(id: string): Promise<VideoEditorProject> {
    return normalizeVideoEditorProject(
      await getElectronApi().loadVideoProject(id),
    );
  },
  async saveProject(project: VideoEditorProject): Promise<string> {
    const result = object(
      await getElectronApi().saveVideoProject({
        ...(project.id ? { id: project.id } : {}),
        data: project,
      }),
    );
    if (typeof result.id !== "string")
      throw new Error("Không nhận được mã project sau khi lưu.");
    return result.id;
  },
  deleteProject: (id: string) => getElectronApi().deleteVideoProject(id),
  selectVideos: () => getElectronApi().selectVideoFiles(),
  selectSubtitle: () => getElectronApi().selectSrtFile(),
  selectAudio: () => getElectronApi().selectAudioFile(),
  selectOutputFolder: () => getElectronApi().selectOutputFolder(),
  showInFolder: (path: string) => getElectronApi().showInFolder(path),
  async videoInfo(filePath: string): Promise<{ duration: number }> {
    const value = object(await getElectronApi().getVideoInfo({ filePath }));
    return { duration: Math.max(0, number(value.duration)) };
  },
  async generateSubtitles(
    filePath: string,
    duration: number,
    transcript: string,
  ): Promise<{ srtPath: string }> {
    const value = object(
      await getElectronApi().aiGenerateSubtitles({
        filePath,
        duration,
        ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
      }),
    );
    if (typeof value.srtPath !== "string")
      throw new Error("Không nhận được file phụ đề.");
    return { srtPath: value.srtPath };
  },
  async detectWatermark(
    filePath: string,
    timeSeconds: number,
  ): Promise<WatermarkRegion[]> {
    const value = object(
      await getElectronApi().aiDetectWatermark({ filePath, timeSeconds }),
    );
    return (Array.isArray(value.regions) ? value.regions : [])
      .map(normalizeRegion)
      .filter((entry): entry is WatermarkRegion => Boolean(entry));
  },
  export(project: VideoEditorProject, outputName: string) {
    return getElectronApi().applyVideoFilters({
      filePath: project.videoSrc,
      startTime: project.trimStart,
      endTime: project.trimEnd,
      filters: {
        speed: { rate: project.speed, changeAudioPitch: false },
        rotate: project.rotate,
        flipH: project.flipH,
        flipV: project.flipV,
        audio: { volume: project.volume },
      },
      subtitlePath: project.subtitlePath || undefined,
      bgmPath: project.bgmPath || undefined,
      bgmVolume: project.bgmVolume,
      fadeIn: project.fadeIn,
      fadeOut: project.fadeOut,
      delogoRegions: project.delogoRegions,
      outputName,
    });
  },
  merge(project: VideoEditorProject, outputDir?: string) {
    return getElectronApi().concatWithTransitions({
      clips: project.timelineClips.map((clip) => ({
        filePath: clip.filePath,
        startTime: clip.startTime,
        endTime: clip.endTime,
      })),
      transitions: project.timelineTransitions,
      crf: 18,
      ...(outputDir ? { outputDir } : {}),
    });
  },
};
