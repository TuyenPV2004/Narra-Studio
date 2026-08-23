import { getElectronApi } from "@/services/electron-api/client";
import type { ProviderId } from "@/types/electron-api";

export type VideoMode =
  "charsync" | "editvideo" | "image" | "startend" | "text";
export interface VideoModel {
  durations: number[];
  id: string;
  label: string;
  resolutions: string[];
}

export const VIDEO_MODELS_BY_MODE: Record<VideoMode, VideoModel[]> = {
  text: [
    {
      id: "abra_t2v",
      label: "Google Abra T2V - Omini",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_t2v_lite",
      label: "VEO 3.1 Lite",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_t2v_fast",
      label: "VEO 3.1 Fast",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_t2v_quality",
      label: "VEO 3.1 Quality",
      durations: [4, 6, 8, 10],
      resolutions: ["1080p"],
    },
    {
      id: "veo_3_1_t2v_fast_ultra",
      label: "VEO 3.1 Fast (Ultra)",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_t2v_quality_ultra",
      label: "VEO 3.1 Quality (Ultra)",
      durations: [4, 6, 8, 10],
      resolutions: ["1080p"],
    },
  ],
  image: [
    {
      id: "abra_i2v",
      label: "Google Abra I2V - Omini",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_i2v_lite",
      label: "VEO 3.1 Lite (Tier Two)",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_i2v_fast",
      label: "VEO 3.1 Fast (Tier One)",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
  ],
  startend: [
    {
      id: "abra_i2v",
      label: "Google Abra Start/End - Omini",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_i2v_lite",
      label: "VEO 3.1 Interpolation Lite (Tier Two)",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_i2v_fast",
      label: "VEO 3.1 Interpolation Fast (Tier One)",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
  ],
  charsync: [
    {
      id: "abra_r2v",
      label: "Google Abra R2V - Omini",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
    {
      id: "veo_3_1_r2v_fast",
      label: "VEO 3.1 Reference Fast",
      durations: [4, 6, 8, 10],
      resolutions: ["720p"],
    },
  ],
  editvideo: [
    {
      id: "abra_edit",
      label: "Google Abra Edit",
      durations: [8],
      resolutions: ["720p"],
    },
  ],
};

export function getVideoModelsForMode(mode: VideoMode): VideoModel[] {
  return VIDEO_MODELS_BY_MODE[mode] || VIDEO_MODELS_BY_MODE.text;
}

export const DEFAULT_VIDEO_MODELS: VideoModel[] = VIDEO_MODELS_BY_MODE.text;
export interface VideoGenerationRequest {
  aspect: "landscape" | "portrait";
  duration: number;
  endImage?: File;
  editVideo?: File;
  mode: VideoMode;
  model: string;
  prompt: string;
  providerId: ProviderId;
  resolution: string;
  slotId?: number;
  startImage?: File;
  characterImages?: File[];
}
export interface VideoGenerationResult {
  downloadMediaName: string;
  jobId: string;
  slotId: number;
  src: string;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function resolveVideoModelKey(
  model: string,
  duration: number = 8,
  mode: VideoMode = "text",
): string {
  const dur = [4, 6, 8, 10].includes(duration) ? duration : 8;
  const isAbra = !model || model.startsWith("abra") || model === "default";

  if (mode === "editvideo") {
    return "abra_edit";
  }
  if (mode === "charsync") {
    if (isAbra) return `abra_r2v_${dur}s`;
    return model.replace("t2v", "r2v");
  }
  if (mode === "image" || mode === "startend") {
    if (isAbra) return `abra_i2v_${dur}s`;
    if (model.includes("t2v")) return model.replace("t2v", "i2v");
    return model;
  }
  if (isAbra) return `abra_t2v_${dur}s`;
  return model;
}

async function uploadFlowImage(file: File, slotId: number): Promise<string> {
  let filePath = "";
  try {
    filePath = await getElectronApi().authorizeFilePath(file);
  } catch {
    filePath = "";
  }

  if (filePath) {
    try {
      const response = record(
        await getElectronApi().uploadImageFromPath({
          filePath,
          fileName: file.name,
          mimeType: file.type || "image/jpeg",
          slotId,
        }),
      );
      const media = record(record(response.data).media);
      if (typeof media.name === "string" && media.name) {
        return media.name;
      }
    } catch (pathErr) {
      console.warn(
        `[UPLOAD-FLOW] uploadImageFromPath failed for ${file.name}, falling back to memory buffer:`,
        pathErr,
      );
    }
  }

  // Fallback: Read file bytes directly in renderer and upload via uploadImage
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  const imageBytes = btoa(binary);
  const response = record(
    await getElectronApi().uploadImage({
      imageBytes,
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      slotId,
    }),
  );
  const media = record(record(response.data).media);
  if (typeof media.name !== "string" || !media.name) {
    throw new Error(`Không thể tải ${file.name} lên Google Flow.`);
  }
  return media.name;
}

async function pollFlowVideo(
  mediaName: string,
  slotId: number,
): Promise<VideoGenerationResult> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(10_000);
    const response = record(
      record(
        await getElectronApi().pollVideoStatus({
          mediaName,
          projectId: null,
          slotId,
        }),
      ).data,
    );
    const media = Array.isArray(response.media)
      ? response.media.map(record)
      : [];
    for (const item of media) {
      const status = String(
        record(record(item.mediaMetadata).mediaStatus).mediaGenerationStatus ||
          "",
      );
      if (status.includes("SUCCESSFUL")) {
        await getElectronApi().queueVideoDownload({
          mediaName: String(item.name || mediaName),
          itemId: mediaName,
          slotId,
        });
        return {
          downloadMediaName: String(item.name || mediaName),
          jobId: mediaName,
          slotId,
          src: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(String(item.name || mediaName))}`,
        };
      }
      if (status.includes("FAIL") || status.includes("ERROR"))
        throw new Error(`Google Flow không thể tạo video (${status}).`);
    }
  }
  throw new Error("Hết thời gian chờ Google Flow tạo video.");
}

export const videoApi = {
  async createGif(mediaId: string, slotId = 0): Promise<void> {
    const response = record(
      await getElectronApi().generatePinholeGif({ mediaId, slotId }),
    );
    const encodedGif = record(response.data).encodedGif;
    if (typeof encodedGif !== "string" || !encodedGif)
      throw new Error("Google Flow không trả về dữ liệu GIF.");
    await getElectronApi().saveImageLocally({
      src: `data:image/gif;base64,${encodedGif}`,
      fileName: `video-gif-${Date.now()}.gif`,
      slotId,
    });
  },
  async upscale(
    mediaId: string,
    resolution: "1080p" | "4k",
    aspect: "landscape" | "portrait",
    slotId = 0,
  ): Promise<string> {
    const credits = record(await getElectronApi().getCredits({ slotId }));
    if (!isKnownPaygateTier(credits.tier)) {
      throw new Error(
        "Không xác định được gói tài khoản Google Flow. Vui lòng đồng bộ lại tài khoản trước khi upscale video.",
      );
    }
    const response = record(
      await getElectronApi().upscaleVideo({
        mediaId,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        resolution,
        aspectRatio: aspect,
        slotId,
      }),
    );
    const data = record(response.data);
    const firstMedia = Array.isArray(data.media) ? record(data.media[0]) : {};
    const initialName =
      typeof firstMedia.name === "string"
        ? firstMedia.name
        : typeof data.name === "string"
          ? data.name
          : typeof data.mediaName === "string"
            ? data.mediaName
            : "";
    if (!initialName)
      throw new Error("Google Flow không trả về media ID upscale.");

    let completedName = initialName;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(10_000);
      const polled = record(
        record(
          await getElectronApi().pollVideoStatus({
            mediaName: initialName,
            projectId: null,
            slotId,
          }),
        ).data,
      );
      const media = Array.isArray(polled.media) ? polled.media.map(record) : [];
      const item = media.find((candidate) => {
        const status = String(
          record(record(candidate.mediaMetadata).mediaStatus)
            .mediaGenerationStatus || "",
        );
        if (status.includes("FAIL") || status.includes("ERROR"))
          throw new Error(`Google Flow upscale thất bại (${status}).`);
        return status.includes("SUCCESSFUL");
      });
      if (item) {
        completedName = String(item.name || initialName);
        break;
      }
      if (attempt === 59)
        throw new Error("Hết thời gian chờ Google Flow upscale video.");
    }

    const downloadResult = await getElectronApi().downloadVideo({
      mediaName: completedName,
      slotId,
    });
    if (typeof downloadResult === "string" && downloadResult)
      return downloadResult;
    const downloaded = record(downloadResult);
    for (const value of [
      downloaded.path,
      downloaded.localPath,
      downloaded.url,
      record(downloaded.data).path,
      record(downloaded.data).localPath,
      record(downloaded.data).url,
    ]) {
      if (typeof value === "string" && value) return value;
    }
    return `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(completedName)}`;
  },
  async generate(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResult> {
    const bridge = record(await getElectronApi().getCaptchaBridgeStatus());
    if (bridge.connected !== true)
      throw new Error("CAPTCHA bridge chưa kết nối.");
    const slot =
      typeof request.slotId === "number"
        ? { slotId: request.slotId }
        : record(await getElectronApi().pickRandomSlot());
    const slotId = typeof slot.slotId === "number" ? slot.slotId : 0;
    // Refresh and cache the tier on the selected account slot before Main
    // resolves tier-dependent model keys. Credit lookup is read-only and the
    // Main handler degrades to null when the session cannot provide it.
    const credits = record(await getElectronApi().getCredits({ slotId }));
    if (isTierDependentRequest(request) && !isKnownPaygateTier(credits.tier)) {
      throw new Error(
        "Không xác định được gói tài khoản Google Flow. Vui lòng đồng bộ lại tài khoản trước khi tạo video.",
      );
    }
    const startMediaId = request.startImage
      ? await uploadFlowImage(request.startImage, slotId)
      : "";
    const endMediaId = request.endImage
      ? await uploadFlowImage(request.endImage, slotId)
      : "";
    const characterMediaIds = request.characterImages
      ? await Promise.all(
          request.characterImages.map((file) => uploadFlowImage(file, slotId)),
        )
      : [];
    const effectiveModelKey = resolveVideoModelKey(
      request.model,
      request.duration,
      request.mode,
    );
    const payload = {
      prompt: request.prompt,
      captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
      videoModelKey: effectiveModelKey,
      duration: request.duration,
      aspectRatio:
        request.aspect === "portrait"
          ? "VIDEO_ASPECT_RATIO_PORTRAIT"
          : "VIDEO_ASPECT_RATIO_LANDSCAPE",
      seed: Math.floor(Math.random() * 9_999_999),
      slotId,
    };
    let response: unknown;
    if (request.mode === "editvideo") {
      if (!request.editVideo) throw new Error("Cần chọn video đầu vào.");
      let filePath = "";
      if (
        typeof (request.editVideo as unknown as { path?: string }).path ===
        "string"
      ) {
        filePath = (request.editVideo as unknown as { path: string }).path;
      }
      if (
        !filePath &&
        typeof (request.editVideo as unknown as { url?: string }).url ===
          "string"
      ) {
        filePath = (request.editVideo as unknown as { url: string }).url;
      }
      if (!filePath) {
        try {
          filePath = await getElectronApi().authorizeFilePath(
            request.editVideo,
          );
        } catch {
          filePath = "";
        }
      }
      if (!filePath) {
        try {
          filePath = getElectronApi().getFilePath(request.editVideo);
        } catch {
          filePath = "";
        }
      }
      if (filePath) {
        const authorized = await getElectronApi().authorizeFilePath(filePath);
        if (authorized) filePath = authorized;
      }
      if (!filePath) {
        throw new Error(
          `Không thể cấp quyền đọc file video "${request.editVideo.name}". Vui lòng chọn lại video đầu vào.`,
        );
      }
      const uploaded = record(
        await getElectronApi().uploadOmniVideo({
          filePath,
          slotId,
        }),
      );
      if (typeof uploaded.mediaServerId !== "string")
        throw new Error("Không thể tải video đầu vào lên Google Flow.");
      response = await getElectronApi().generateVideoEditVideo({
        ...payload,
        videoInputMediaId: uploaded.mediaServerId,
        startFrameIndex: 0,
        endFrameIndex: 0,
        slotId,
        duration: `${request.duration}s`,
      });
    } else if (request.mode === "charsync") {
      if (!characterMediaIds.length)
        throw new Error("Cần ít nhất một ảnh nhân vật.");
      response = await getElectronApi().generateVideoReferenceImages({
        ...payload,
        referenceMediaIds: characterMediaIds,
      });
    } else
      response =
        request.mode === "startend"
          ? await getElectronApi().generateVideoStartEndImage({
              ...payload,
              startMediaId,
              endMediaId,
            })
          : request.mode === "image"
            ? await getElectronApi().generateVideoStartImage({
                ...payload,
                mediaId: startMediaId,
              })
            : await getElectronApi().generateVideo({
                ...payload,
                projectId: null,
              });
    const data = record(record(response).data);
    const media = Array.isArray(data.media) ? record(data.media[0]) : {};
    const mediaName =
      typeof media.name === "string"
        ? media.name
        : typeof data.name === "string"
          ? data.name
          : typeof data.mediaName === "string"
            ? data.mediaName
            : "";
    if (!mediaName) throw new Error("Google Flow không trả về media ID video.");
    return pollFlowVideo(mediaName, slotId);
  },
  onVideoDownloaded(
    callback: (payload: {
      itemId: string;
      localPath: string;
      thumbnailDataUrl?: string | null;
    }) => void,
  ): () => void {
    return getElectronApi().onVideoDownloaded(callback);
  },
  onVideoDownloadFailed(
    callback: (payload: { itemId: string; error: string }) => void,
  ): () => void {
    return getElectronApi().onVideoDownloadFailed(callback);
  },
  async resolveDownloadedVideo(mediaName: string): Promise<string | null> {
    const resolved = await getElectronApi().resolveDownloadedVideo(mediaName);
    return typeof resolved === "string" && resolved ? resolved : null;
  },
  async retryDownload(
    mediaName: string,
    itemId: string,
    slotId = 0,
  ): Promise<void> {
    await getElectronApi().queueVideoDownload({ mediaName, itemId, slotId });
  },
  async showInFolder(filePath: string): Promise<void> {
    await getElectronApi().showInFolder(filePath);
  },
};

const isKnownPaygateTier = (
  value: unknown,
): value is "PAYGATE_TIER_ONE" | "PAYGATE_TIER_TWO" =>
  value === "PAYGATE_TIER_ONE" || value === "PAYGATE_TIER_TWO";

const isTierDependentRequest = (request: VideoGenerationRequest): boolean =>
  request.mode === "editvideo" ||
  (request.model.startsWith("veo_") && request.mode !== "text");
