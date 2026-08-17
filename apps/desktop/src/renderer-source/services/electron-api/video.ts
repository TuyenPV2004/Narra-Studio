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
export interface VideoGenerationRequest {
  aspect: "landscape" | "portrait";
  duration: number;
  endImage?: File;
  editVideo?: File;
  generateAudio: boolean;
  mode: VideoMode;
  model: string;
  prompt: string;
  providerId: ProviderId;
  resolution: string;
  startImage?: File;
  characterImages?: File[];
}
export interface VideoGenerationResult {
  jobId: string;
  src: string;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function uploadFlowImage(file: File, slotId: number): Promise<string> {
  const filePath = getElectronApi().getFilePath(file);
  const response = record(
    await getElectronApi().uploadImageFromPath({
      filePath,
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      slotId,
    }),
  );
  const media = record(record(response.data).media);
  if (typeof media.name !== "string")
    throw new Error(`Không thể tải ${file.name} lên Google Flow.`);
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
          jobId: mediaName,
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
  async createGif(mediaId: string): Promise<void> {
    const response = record(
      await getElectronApi().generatePinholeGif({ mediaId }),
    );
    const encodedGif = record(response.data).encodedGif;
    if (typeof encodedGif !== "string" || !encodedGif)
      throw new Error("Google Flow không trả về dữ liệu GIF.");
    await getElectronApi().saveImageLocally({
      src: `data:image/gif;base64,${encodedGif}`,
      fileName: `video-gif-${Date.now()}.gif`,
    });
  },
  async upscale(
    mediaId: string,
    resolution: "1080p" | "4k",
    aspect: "landscape" | "portrait",
  ): Promise<string> {
    const response = record(
      await getElectronApi().upscaleVideo({
        mediaId,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        resolution,
        aspectRatio: aspect,
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
    const slot = record(await getElectronApi().pickRandomSlot());
    const slotId = typeof slot.slotId === "number" ? slot.slotId : 0;
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
    const payload = {
      prompt: request.prompt,
      captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
      videoModelKey: request.model,
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
      const uploaded = record(
        await getElectronApi().uploadOmniVideo({
          filePath: getElectronApi().getFilePath(request.editVideo),
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
};
