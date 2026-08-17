import { getElectronApi } from "@/services/electron-api/client";
import { aiProviderApi } from "@/services/electron-api/ai-providers";

export interface EditorProjectMeta extends Record<string, unknown> {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  aspectRatio?: string;
}
export interface EditorClip extends Record<string, unknown> {
  id: string;
  path: string;
  name: string;
  duration: number;
  sourceStart?: number;
  sourceEnd?: number;
  speed?: number;
  speedCurve?: string;
  speedCurveKeyframes?: EditorSpeedKeyframe[];
  changeAudioPitch?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  transitionOut?: EditorTransition;
  textOverlays?: EditorTextOverlay[];
  fadeIn?: number;
  fadeOut?: number;
  stickerOverlays?: EditorStickerOverlay[];
  effects?: EditorEffect[];
  trackType?: "audio" | "image" | "video";
  volume?: number;
  muted?: boolean;
  scale?: number;
  scaleY?: number;
  uniformScale?: boolean;
  posX?: number;
  posY?: number;
  rotation?: number;
  opacity?: number;
  blendEnabled?: boolean;
  blendMode?: string;
  flipH?: boolean;
  flipV?: boolean;
  crop?: EditorCrop;
  trackId?: string;
  startTime?: number;
  removeFlickers?: boolean;
  removeFlickersCfg?: {
    mode: "flashlight" | "timelapse";
    level: "weak" | "recommended" | "strong";
  };
  lipSync?: boolean;
  lipSyncCfg?: Record<string, unknown>;
}
export interface EditorTrack extends Record<string, unknown> {
  id: string;
  name: string;
  trackType: "audio" | "effect" | "sticker" | "text" | "video";
  hidden?: boolean;
  locked?: boolean;
  muted?: boolean;
}
export interface EditorSpeedKeyframe {
  t: number;
  s: number;
}
export interface EditorCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}
export interface EditorTransition {
  libraryId: string;
  name: string;
  type: string;
  duration: number;
}
export interface EditorTextOverlay {
  text: string;
  fontSize: number;
  color: string;
  position: "bottom" | "center" | "top";
  startTime: number;
  endTime: number;
}
export interface EditorStickerOverlay extends Record<string, unknown> {
  format: "emoji" | "image" | "gif" | "template";
  emoji?: string;
  src?: string;
  filePath?: string;
  templateSvg?: string;
  scale: number;
  posX: number;
  posY: number;
  rotation: number;
  opacity: number;
  startTime: number;
  endTime: number;
}
export interface EditorEffect {
  libraryId: string;
  name: string;
  type: string;
  params: Record<string, number>;
  startTime: number;
  endTime: number;
}
export interface EditorProject extends EditorProjectMeta {
  clips: EditorClip[];
  tracks?: EditorTrack[];
  state?: Record<string, unknown>;
}
export interface EditorDeflickerSuggestion {
  mode: "flashlight" | "timelapse";
  level: "weak" | "recommended" | "strong";
  confidence: number;
  reason: string;
  model?: string;
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const asMeta = (value: unknown): EditorProjectMeta | undefined => {
  const item = object(value);
  if (typeof item.id !== "string" || typeof item.name !== "string")
    return undefined;
  return {
    ...item,
    id: item.id,
    name: item.name,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
    duration: typeof item.duration === "number" ? item.duration : 0,
    ...(typeof item.aspectRatio === "string"
      ? { aspectRatio: item.aspectRatio }
      : {}),
  };
};
const asTransition = (value: unknown): EditorTransition | undefined => {
  const item = object(value);
  if (
    typeof item.libraryId !== "string" ||
    typeof item.name !== "string" ||
    typeof item.type !== "string" ||
    typeof item.duration !== "number"
  )
    return undefined;
  return {
    libraryId: item.libraryId,
    name: item.name,
    type: item.type,
    duration: item.duration,
  };
};
const asTextOverlays = (value: unknown): EditorTextOverlay[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = object(entry);
    if (typeof item.text !== "string" || !item.text.trim()) return [];
    const position =
      item.position === "top" || item.position === "bottom"
        ? item.position
        : "center";
    return [
      {
        text: item.text,
        fontSize: typeof item.fontSize === "number" ? item.fontSize : 32,
        color: typeof item.color === "string" ? item.color : "#ffffff",
        position,
        startTime: typeof item.startTime === "number" ? item.startTime : 0,
        endTime: typeof item.endTime === "number" ? item.endTime : 0,
      },
    ];
  });
const asStickerOverlays = (value: unknown): EditorStickerOverlay[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = object(entry);
    const format =
      item.format === "image" ||
      item.format === "gif" ||
      item.format === "template"
        ? item.format
        : "emoji";
    const hasEmoji =
      format === "emoji" &&
      typeof item.emoji === "string" &&
      Boolean(item.emoji);
    const hasFile =
      (format === "image" || format === "gif") &&
      (typeof item.filePath === "string" || typeof item.src === "string");
    const hasTemplate =
      format === "template" && typeof item.templateSvg === "string";
    if (!hasEmoji && !hasFile && !hasTemplate) return [];
    return [
      {
        ...item,
        format,
        ...(typeof item.emoji === "string" ? { emoji: item.emoji } : {}),
        ...(typeof item.src === "string" ? { src: item.src } : {}),
        ...(typeof item.filePath === "string"
          ? { filePath: item.filePath }
          : {}),
        ...(typeof item.templateSvg === "string"
          ? { templateSvg: item.templateSvg }
          : {}),
        scale: typeof item.scale === "number" ? item.scale : 1,
        posX: typeof item.posX === "number" ? item.posX : 0,
        posY: typeof item.posY === "number" ? item.posY : 0,
        rotation: typeof item.rotation === "number" ? item.rotation : 0,
        opacity: typeof item.opacity === "number" ? item.opacity : 1,
        startTime: typeof item.startTime === "number" ? item.startTime : 0,
        endTime: typeof item.endTime === "number" ? item.endTime : 0,
      },
    ];
  });
const asEffects = (value: unknown): EditorEffect[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const item = object(entry);
    const rawParams = object(item.params);
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(
        (pair): pair is [string, number] => typeof pair[1] === "number",
      ),
    );
    if (
      typeof item.libraryId !== "string" ||
      typeof item.name !== "string" ||
      typeof item.type !== "string"
    )
      return [];
    return [
      {
        libraryId: item.libraryId,
        name: item.name,
        type: item.type,
        params,
        startTime: typeof item.startTime === "number" ? item.startTime : 0,
        endTime: typeof item.endTime === "number" ? item.endTime : 0,
      },
    ];
  });
const asClip = (value: unknown): EditorClip | undefined => {
  const item = object(value);
  const path =
    typeof item.path === "string"
      ? item.path
      : typeof item.src === "string"
        ? item.src
        : undefined;
  if (!path) return undefined;
  const preserved = { ...item };
  for (const key of [
    "id",
    "path",
    "src",
    "name",
    "duration",
    "sourceStart",
    "sourceEnd",
    "speed",
    "speedCurve",
    "speedCurveKeyframes",
    "changeAudioPitch",
    "brightness",
    "contrast",
    "saturation",
    "fadeIn",
    "fadeOut",
    "transitionOut",
    "textOverlays",
    "stickerOverlays",
    "effects",
    "trackType",
    "volume",
    "muted",
    "scale",
    "scaleY",
    "uniformScale",
    "posX",
    "posY",
    "rotation",
    "opacity",
    "blendEnabled",
    "blendMode",
    "flipH",
    "flipV",
    "crop",
    "trackId",
    "startTime",
    "removeFlickers",
    "removeFlickersCfg",
  ])
    delete preserved[key];
  const transitionOut = asTransition(item.transitionOut);
  const textOverlays = asTextOverlays(item.textOverlays);
  const stickerOverlays = asStickerOverlays(item.stickerOverlays);
  const effects = asEffects(item.effects);
  return {
    ...preserved,
    id: typeof item.id === "string" ? item.id : `clip-${crypto.randomUUID()}`,
    path,
    name:
      typeof item.name === "string"
        ? item.name
        : decodeURIComponent(path.split("/").pop() || "Media"),
    duration: typeof item.duration === "number" ? item.duration : 0,
    ...(typeof item.sourceStart === "number"
      ? { sourceStart: item.sourceStart }
      : {}),
    ...(typeof item.sourceEnd === "number"
      ? { sourceEnd: item.sourceEnd }
      : {}),
    ...(typeof item.speed === "number" ? { speed: item.speed } : {}),
    ...(typeof item.speedCurve === "string"
      ? { speedCurve: item.speedCurve }
      : {}),
    ...(Array.isArray(item.speedCurveKeyframes)
      ? {
          speedCurveKeyframes: item.speedCurveKeyframes.flatMap((entry) => {
            const keyframe = object(entry);
            return typeof keyframe.t === "number" &&
              typeof keyframe.s === "number"
              ? [{ t: keyframe.t, s: keyframe.s }]
              : [];
          }),
        }
      : {}),
    ...(typeof item.changeAudioPitch === "boolean"
      ? { changeAudioPitch: item.changeAudioPitch }
      : {}),
    ...(typeof item.brightness === "number"
      ? { brightness: item.brightness }
      : {}),
    ...(typeof item.contrast === "number" ? { contrast: item.contrast } : {}),
    ...(typeof item.saturation === "number"
      ? { saturation: item.saturation }
      : {}),
    ...(typeof item.fadeIn === "number" ? { fadeIn: item.fadeIn } : {}),
    ...(typeof item.fadeOut === "number" ? { fadeOut: item.fadeOut } : {}),
    ...(item.trackType === "audio" ||
    item.trackType === "image" ||
    item.trackType === "video"
      ? { trackType: item.trackType }
      : {}),
    ...(typeof item.volume === "number" ? { volume: item.volume } : {}),
    ...(typeof item.muted === "boolean" ? { muted: item.muted } : {}),
    ...(typeof item.scale === "number" ? { scale: item.scale } : {}),
    ...(typeof item.scaleY === "number" ? { scaleY: item.scaleY } : {}),
    ...(typeof item.uniformScale === "boolean"
      ? { uniformScale: item.uniformScale }
      : {}),
    ...(typeof item.posX === "number" ? { posX: item.posX } : {}),
    ...(typeof item.posY === "number" ? { posY: item.posY } : {}),
    ...(typeof item.rotation === "number" ? { rotation: item.rotation } : {}),
    ...(typeof item.opacity === "number" ? { opacity: item.opacity } : {}),
    ...(typeof item.blendEnabled === "boolean"
      ? { blendEnabled: item.blendEnabled }
      : {}),
    ...(typeof item.blendMode === "string"
      ? { blendMode: item.blendMode }
      : {}),
    ...(typeof item.flipH === "boolean" ? { flipH: item.flipH } : {}),
    ...(typeof item.flipV === "boolean" ? { flipV: item.flipV } : {}),
    ...(typeof item.crop === "object" && item.crop !== null
      ? {
          crop: {
            x: Number(object(item.crop).x) || 0,
            y: Number(object(item.crop).y) || 0,
            width: Number(object(item.crop).width) || 100,
            height: Number(object(item.crop).height) || 100,
            rotation: Number(object(item.crop).rotation) || 0,
          },
        }
      : {}),
    ...(typeof item.trackId === "string" ? { trackId: item.trackId } : {}),
    ...(typeof item.startTime === "number"
      ? { startTime: Math.max(0, item.startTime) }
      : {}),
    ...(typeof item.removeFlickers === "boolean"
      ? { removeFlickers: item.removeFlickers }
      : {}),
    ...(typeof item.removeFlickersCfg === "object" &&
    item.removeFlickersCfg !== null
      ? {
          removeFlickersCfg: {
            mode:
              object(item.removeFlickersCfg).mode === "timelapse"
                ? "timelapse"
                : "flashlight",
            level:
              object(item.removeFlickersCfg).level === "weak" ||
              object(item.removeFlickersCfg).level === "strong"
                ? (object(item.removeFlickersCfg).level as "weak" | "strong")
                : "recommended",
          },
        }
      : {}),
    ...(transitionOut ? { transitionOut } : {}),
    ...(textOverlays.length ? { textOverlays } : {}),
    ...(stickerOverlays.length ? { stickerOverlays } : {}),
    ...(effects.length ? { effects } : {}),
  };
};

export const editorClipDuration = (clip: EditorClip) => {
  const sourceDuration = Math.max(
    0,
    (clip.sourceEnd ?? clip.duration) - (clip.sourceStart ?? 0),
  );
  const keyframes = clip.speedCurveKeyframes
    ?.filter((item) => Number.isFinite(item.t) && Number.isFinite(item.s))
    .map((item) => ({
      t: Math.max(0, Math.min(1, item.t)),
      s: Math.max(0.0625, Math.min(16, item.s)),
    }))
    .sort((a, b) => a.t - b.t);
  if (
    clip.speedCurve &&
    clip.speedCurve !== "none" &&
    keyframes &&
    keyframes.length >= 2 &&
    sourceDuration > 0
  ) {
    let effective = (keyframes[0]!.t * sourceDuration) / keyframes[0]!.s;
    for (let index = 0; index < keyframes.length - 1; index += 1) {
      const start = keyframes[index]!;
      const end = keyframes[index + 1]!;
      const segment = (end.t - start.t) * sourceDuration;
      if (segment <= 0) continue;
      effective +=
        Math.abs(start.s - end.s) < 0.001
          ? segment / start.s
          : (segment * Math.log(end.s / start.s)) / (end.s - start.s);
    }
    const last = keyframes[keyframes.length - 1]!;
    effective += ((1 - last.t) * sourceDuration) / last.s;
    return Math.max(0, effective);
  }
  return sourceDuration / Math.max(0.25, clip.speed ?? 1);
};

export const editorApi = {
  async listProjects(): Promise<EditorProjectMeta[]> {
    const value = await getElectronApi().projectsList();
    return (Array.isArray(value) ? value : [])
      .map(asMeta)
      .filter((item): item is EditorProjectMeta => Boolean(item));
  },
  async getProject(id: string): Promise<EditorProject | undefined> {
    const value = await getElectronApi().projectsGet(id);
    const meta = asMeta(value);
    if (!meta) return undefined;
    const item = object(value);
    const state = object(item.state);
    const values = Array.isArray(item.clips)
      ? item.clips
      : Array.isArray(state.clips)
        ? state.clips
        : [];
    const tracks: EditorTrack[] = (
      Array.isArray(item.tracks)
        ? item.tracks
        : Array.isArray(state.tracks)
          ? state.tracks
          : []
    ).flatMap((entry): EditorTrack[] => {
      const track = object(entry);
      const trackType: EditorTrack["trackType"] =
        track.trackType === "audio" ||
        track.trackType === "effect" ||
        track.trackType === "sticker" ||
        track.trackType === "text"
          ? track.trackType
          : "video";
      return typeof track.id === "string"
        ? [
            {
              ...track,
              id: track.id,
              name: typeof track.name === "string" ? track.name : trackType,
              trackType,
              ...(typeof track.hidden === "boolean"
                ? { hidden: track.hidden }
                : {}),
              ...(typeof track.locked === "boolean"
                ? { locked: track.locked }
                : {}),
              ...(typeof track.muted === "boolean"
                ? { muted: track.muted }
                : {}),
            },
          ]
        : [];
    });
    return {
      ...meta,
      state,
      clips: values
        .map(asClip)
        .filter((entry): entry is EditorClip => Boolean(entry)),
      ...(tracks.length ? { tracks } : {}),
    };
  },
  saveProject(project: EditorProject) {
    return getElectronApi().projectsSave({
      ...project,
      state: {
        ...project.state,
        clips: project.clips,
        ...(project.tracks ? { tracks: project.tracks } : {}),
      },
    });
  },
  renameProject: (id: string, name: string) =>
    getElectronApi().projectsRename(id, name),
  deleteProject: (id: string) => getElectronApi().projectsDelete(id),
  duplicateProject: (id: string, name: string) =>
    getElectronApi().projectsDuplicate(id, name),
  async selectMedia(): Promise<string[]> {
    const value = await getElectronApi().selectMediaFiles();
    return (Array.isArray(value) ? value : value ? [value] : []).filter(
      (item): item is string => typeof item === "string",
    );
  },
  async selectSticker(): Promise<string | undefined> {
    const values = await this.selectMedia();
    return values.find((path) => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path));
  },
  async duration(path: string): Promise<number> {
    const value = await getElectronApi().getVideoDuration({ filePath: path });
    if (typeof value === "number") return value;
    const result = object(value);
    return typeof result.duration === "number" ? result.duration : 0;
  },
  async extractAudio(path: string): Promise<string> {
    const value = await getElectronApi().extractAudio({
      filePath: path,
      format: "wav",
    });
    if (typeof value === "string") return value;
    const result = object(value);
    const output =
      typeof result.outputPath === "string"
        ? result.outputPath
        : typeof result.path === "string"
          ? result.path
          : undefined;
    if (!output) throw new Error("Không nhận được đường dẫn audio đã tách.");
    return output;
  },
  async aiProviderReady(): Promise<boolean> {
    const { profiles } = await aiProviderApi.list();
    return profiles.some((profile) => profile.hasApiKey && Boolean(profile.model));
  },
  async suggestDeflicker(clip: EditorClip): Promise<EditorDeflickerSuggestion> {
    const value = object(
      await getElectronApi().aiSuggestDeflicker({
        videoPath: clip.path,
        startTime: clip.sourceStart ?? 0,
        endTime: clip.sourceEnd ?? clip.duration,
      }),
    );
    const mode = value.mode === "timelapse" ? "timelapse" : "flashlight";
    const level =
      value.level === "weak" || value.level === "strong"
        ? value.level
        : "recommended";
    return {
      mode,
      level,
      confidence: typeof value.confidence === "number" ? value.confidence : 0,
      reason: typeof value.reason === "string" ? value.reason : "",
      ...(typeof value.model === "string" ? { model: value.model } : {}),
    };
  },
  async textToSpeech(text: string, voiceId: string): Promise<string> {
    const value = object(
      await getElectronApi().textToSpeech({
        text,
        voiceId,
        stability: 50,
        language: "vi",
        provider: "local-piper",
        model: "piper",
        progressTag: "sourceCapcutLipVoice",
      }),
    );
    const output =
      typeof value.audio_path === "string"
        ? value.audio_path
        : typeof value.audio_url === "string"
          ? value.audio_url
          : typeof value.outputPath === "string"
            ? value.outputPath
            : typeof value.path === "string"
              ? value.path
              : undefined;
    if (!output) throw new Error("Không nhận được audio từ bộ đọc giọng.");
    return output;
  },
  cancelTextToSpeech: () =>
    getElectronApi().textToSpeechCancel({
      progressTag: "sourceCapcutLipVoice",
    }),
  async lipSync(
    clip: EditorClip,
    audio: string,
    keepBgSound: boolean,
  ): Promise<string> {
    const value = object(
      await getElectronApi().lipSyncVideo({
        videoPath: clip.path,
        ...(audio.startsWith("http")
          ? { audioUrl: audio }
          : { audioPath: audio }),
        startTime: clip.sourceStart ?? 0,
        endTime: clip.sourceEnd ?? clip.duration,
        outputName: `lip-sync-${Date.now()}.mp4`,
        keepBgSound,
        model: "sync-3",
        progressTag: "sourceCapcutLipSync",
      }),
    );
    const output =
      typeof value.outputPath === "string"
        ? value.outputPath
        : typeof value.outputUrl === "string"
          ? value.outputUrl
          : undefined;
    if (!output) throw new Error("Không nhận được video Lip sync.");
    return output;
  },
  showInFolder: (path: string) => getElectronApi().showInFolder(path),
  async export(clips: EditorClip[], outputName: string, aspectRatio = "16:9") {
    const [canvasWidth, canvasHeight] =
      aspectRatio === "9:16"
        ? [1080, 1920]
        : aspectRatio === "1:1"
          ? [1080, 1080]
          : [1920, 1080];
    const processed: Array<{
      path: string;
      duration: number;
      transitionToNext: { type: string; duration: number } | null;
    }> = [];
    for (const [index, item] of clips.entries()) {
      const output = await getElectronApi().applyVideoFilters({
        filePath: item.path,
        startTime: item.sourceStart ?? 0,
        endTime: item.sourceEnd ?? item.duration,
        filters: {
          brightness: item.brightness ?? 0,
          contrast: item.contrast ?? 1,
          saturation: item.saturation ?? 1,
          speed: {
            rate: item.speed ?? 1,
            changeAudioPitch: item.changeAudioPitch ?? false,
          },
          speedCurve:
            item.speedCurve &&
            item.speedCurve !== "none" &&
            item.speedCurveKeyframes &&
            item.speedCurveKeyframes.length >= 2
              ? {
                  keyframes: item.speedCurveKeyframes,
                  sourceLength: Math.max(
                    0,
                    (item.sourceEnd ?? item.duration) - (item.sourceStart ?? 0),
                  ),
                }
              : undefined,
          deflicker: item.removeFlickers
            ? {
                enabled: true,
                mode: item.removeFlickersCfg?.mode ?? "flashlight",
                level: item.removeFlickersCfg?.level ?? "recommended",
              }
            : undefined,
          textOverlays: item.textOverlays ?? [],
          stickerOverlays: item.stickerOverlays ?? [],
          effects: item.effects ?? [],
          audio: { volume: item.volume ?? 100 },
          layout: {
            canvasWidth,
            canvasHeight,
            scaleX: (item.scale ?? 100) / 100,
            scaleY:
              (item.uniformScale === false
                ? (item.scaleY ?? item.scale ?? 100)
                : (item.scale ?? 100)) / 100,
            posX: item.posX ?? 0,
            posY: item.posY ?? 0,
            rotate: (item.rotation ?? 0) + (item.crop?.rotation ?? 0),
            flipH: item.flipH ?? false,
            flipV: item.flipV ?? false,
            opacity: item.blendEnabled ? (item.opacity ?? 100) / 100 : 1,
            blendMode: item.blendEnabled
              ? (item.blendMode ?? "normal")
              : "normal",
            crop:
              item.crop &&
              (item.crop.x !== 0 ||
                item.crop.y !== 0 ||
                item.crop.width !== 100 ||
                item.crop.height !== 100)
                ? item.crop
                : null,
          },
        },
        muteAudio: item.muted || item.volume === 0,
        fadeIn: item.fadeIn ?? 0,
        fadeOut: item.fadeOut ?? 0,
        outputName:
          clips.length === 1
            ? outputName
            : `_source-edit-part-${index}-${Date.now()}.mp4`,
      });
      if (typeof output !== "string")
        throw new Error(`Không xuất được clip ${item.name}.`);
      processed.push({
        path: output,
        duration: editorClipDuration(item),
        transitionToNext:
          index < clips.length - 1 && item.transitionOut
            ? {
                type: item.transitionOut.type,
                duration: item.transitionOut.duration,
              }
            : null,
      });
    }
    return processed.length === 1
      ? processed[0]?.path
      : getElectronApi().concatVideosWithTransitions({
          clips: processed,
          outputName,
        });
  },
};
