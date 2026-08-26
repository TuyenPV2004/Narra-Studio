import { getElectronApi } from "@/services/electron-api/client";

export interface LocalVideoSource {
  fileName: string;
  filePath: string;
}
export interface LocalAudioSource {
  bitrate: number;
  channels: number;
  duration: number;
  fileName: string;
  filePath: string;
  sampleRate: number;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const mediaToolsApi = {
  async selectAudio(): Promise<LocalAudioSource | null> {
    const filePath = await getElectronApi().selectAudioFile();
    if (typeof filePath !== "string" || !filePath) return null;
    const info = asRecord(await getElectronApi().getAudioInfo({ filePath }));
    return {
      filePath,
      fileName: decodeURIComponent(filePath.split("/").pop() || "audio"),
      duration: Number(info.duration || 0),
      bitrate: Number(info.bitrate || 0),
      channels: Number(info.channels || 0),
      sampleRate: Number(info.sampleRate || 0),
    };
  },
  trimAudio(source: LocalAudioSource, startTime: number, endTime: number) {
    return getElectronApi().trimAudio({
      filePath: source.filePath,
      startTime,
      endTime,
      outputName: `trimmed-${source.fileName.replace(/\.[^.]+$/, "")}.mp3`,
    });
  },
  async selectVideo(): Promise<LocalVideoSource | null> {
    const selected = await getElectronApi().selectAgentCanvasMediaFiles();
    if (!Array.isArray(selected)) return null;
    const video = selected.map(asRecord).find((item) => item.kind === "video");
    return typeof video?.filePath === "string"
      ? {
          filePath: video.filePath,
          fileName:
            typeof video.fileName === "string" ? video.fileName : "video",
        }
      : null;
  },
  crop(
    source: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    return getElectronApi().cropVideo({ filePath: source, ...bounds });
  },
  depth(
    source: string,
    options: {
      outputStyle: "grayscale" | "heatmap" | "side-by-side";
      modelSize: "small" | "base";
    },
    jobId = `source-depth-${Date.now()}`,
  ) {
    return getElectronApi().depthAnythingVideo({
      source,
      inputKind: "video",
      processingFps: "source",
      jobId,
      ...options,
    });
  },
  demux(source: string, jobId = `source-demux-${Date.now()}`) {
    return getElectronApi().demuxVideoAudio({
      source,
      jobId,
      audioFormat: "mp3",
    });
  },
  separateStems(
    source: string,
    role: "background" | "vocals",
    operationId = `source-stems-${Date.now()}`,
  ) {
    return getElectronApi().separateVideoAudioStems({
      source,
      operationId,
      format: "wav",
      role,
    });
  },
  cancel(action: "demux" | "depth" | "stems", id: string) {
    return action === "depth"
      ? getElectronApi().cancelDepthAnythingVideo({ jobId: id })
      : action === "demux"
        ? getElectronApi().cancelVideoAudioDemux({ jobId: id })
        : getElectronApi().cancelVideoAudioSeparation({ operationId: id });
  },
  subscribeProgress(
    callback: (payload: Record<string, unknown>) => void,
  ): () => void {
    const forward = (payload: unknown) => callback(asRecord(payload));
    const cleanups = [
      getElectronApi().onDepthAnythingProgress(forward),
      getElectronApi().onVideoAudioDemuxProgress(forward),
      getElectronApi().onVideoAudioSeparationProgress(forward),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  },
};
