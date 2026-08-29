import { getElectronApi } from "@/services/electron-api/client";

export const MAX_REFERENCE_IMAGES = 5;

export type SaveImageResult =
  { path: string; saved: true } | { error: string; saved: false };

export interface ReferenceImageSnapshot {
  id: string;
  localPath: string;
  mediaId?: string | null;
  name: string;
  size: number;
  type: string;
}

export interface ImageGenerationRequest {
  aspect: string;
  model: string;
  prompt: string;
  providerId: "veo3";
  referenceImage?: File | undefined;
  referenceImages?: File[] | undefined;
  referenceImageSnapshots?: ReferenceImageSnapshot[] | undefined;
  resolution?: string | undefined;
  seed: number;
}
export interface ImageModel {
  label: string;
  maxImageInputs?: number;
  supportedAspectRatios?: string[];
  value: string;
}

export const DEFAULT_IMAGE_MODELS: Record<string, ImageModel[]> = {
  veo3: [
    { value: "NARWHAL", label: "Nano Banana 2 (Mặc định)" },
    { value: "GEM_PIX_2", label: "Nano Banana Pro" },
    { value: "HARBOR_SEAL", label: "Nano Banana 2 Lite" },
  ],
};

export function formatImageError(error: unknown): string {
  if (!error) return "Đã xảy ra lỗi không xác định.";
  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes("Bearer") ||
    msg.includes("401") ||
    msg.includes("auth") ||
    msg.includes("token")
  ) {
    return "Tài khoản chưa đăng nhập hoặc phiên làm việc đã hết hạn. Vui lòng đăng nhập lại Google Flow.";
  }
  if (msg.includes("CAPTCHA") || msg.includes("bridge")) {
    return "CAPTCHA bridge chưa sẵn sàng hoặc chưa giải xong. Vui lòng kiểm tra extension CAPTCHA.";
  }
  if (
    msg.includes("quota") ||
    msg.includes("429") ||
    msg.includes("Rate limit")
  ) {
    return "Tài khoản đã hết hạn mức (quota) hoặc bị giới hạn tần suất tạo ảnh. Vui lòng thử lại sau.";
  }
  if (
    msg.includes("network") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed")
  ) {
    return "Lỗi kết nối mạng đến Google Flow. Vui lòng kiểm tra lại đường truyền internet.";
  }
  if (msg.includes("Download") || msg.includes("save")) {
    return "Tạo ảnh thành công nhưng không thể lưu vào thư viện local.";
  }
  if (msg.includes("không hợp lệ") || msg.includes("không hỗ trợ")) {
    return msg;
  }
  return msg;
}
export interface ImageEditRequest {
  dataUrl: string;
  prompt: string;
}
export interface ImageCropCoordinates {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const data = (value: unknown): Record<string, unknown> =>
  record(record(value).data);

const imageModelLabels = new Map(
  Object.values(DEFAULT_IMAGE_MODELS)
    .flat()
    .map((model) => [model.value, model.label]),
);

function generatedImageResult(value: unknown): {
  mediaId: string | null;
  src: string;
} {
  const response = record(value);
  const media = Array.isArray(response.media) ? record(response.media[0]) : {};
  const generated = record(record(media.image).generatedImage);
  const mediaId =
    typeof media.name === "string" && media.name
      ? media.name
      : typeof generated.mediaId === "string" && generated.mediaId
        ? generated.mediaId
        : null;
  const remoteUrl =
    typeof generated.fifeUrl === "string" && generated.fifeUrl
      ? generated.fifeUrl
      : typeof generated.imageUri === "string" && generated.imageUri
        ? generated.imageUri
        : "";
  const src =
    remoteUrl ||
    (typeof generated.encodedImage === "string" && generated.encodedImage
      ? `data:image/jpeg;base64,${generated.encodedImage}`
      : "");
  return { mediaId, src };
}

function uploadedMediaId(value: unknown): string {
  const response = record(value);
  const responseData = record(response.data);
  const media = record(responseData.media);
  const nestedMediaId = record(responseData.mediaId);
  return typeof media.name === "string" && media.name
    ? media.name
    : typeof nestedMediaId.mediaId === "string" && nestedMediaId.mediaId
      ? nestedMediaId.mediaId
      : typeof responseData.name === "string" && responseData.name
        ? responseData.name
        : "";
}

export const imageApi = {
  async generate(
    request: ImageGenerationRequest & { slotId?: number },
  ): Promise<{ mediaId: string | null; slotId: number; src: string }> {
    const slot =
      typeof request.slotId === "number"
        ? {}
        : record(await getElectronApi().pickRandomSlot());
    const slotId =
      typeof request.slotId === "number"
        ? request.slotId
        : typeof slot.slotId === "number"
          ? slot.slotId
          : 0;

    type RefItem = { fileName: string; filePath: string; mimeType: string };
    const refItems: RefItem[] = [];

    if (
      request.referenceImageSnapshots &&
      request.referenceImageSnapshots.length > 0
    ) {
      for (const snap of request.referenceImageSnapshots.slice(
        0,
        MAX_REFERENCE_IMAGES,
      )) {
        if (!snap.localPath || !snap.localPath.trim()) {
          throw new Error(
            `Không thể xác định đường dẫn tệp tin tham chiếu "${snap.name}".`,
          );
        }
        refItems.push({
          fileName: snap.name,
          filePath: snap.localPath,
          mimeType: snap.type || "image/png",
        });
      }
    } else {
      const rawRefFiles =
        request.referenceImages && request.referenceImages.length > 0
          ? request.referenceImages
          : request.referenceImage
            ? [request.referenceImage]
            : [];
      for (const refFile of rawRefFiles.slice(0, MAX_REFERENCE_IMAGES)) {
        const filePath = getElectronApi().getFilePath(refFile);
        if (!filePath || !filePath.trim()) {
          throw new Error(
            `Không thể lấy đường dẫn tệp tin "${refFile.name}". Vui lòng chọn lại ảnh.`,
          );
        }
        refItems.push({
          fileName: refFile.name,
          filePath,
          mimeType: refFile.type || "image/png",
        });
      }
    }

    const referenceImageNames: string[] = [];
    const uploadedItems: Array<{ fileName: string; mediaId: string }> = [];

    for (const item of refItems) {
      try {
        const uploaded = record(
          await getElectronApi().uploadImageFromPath({
            filePath: item.filePath,
            fileName: item.fileName,
            mimeType: item.mimeType,
            slotId,
          }),
        );
        const mediaId = uploadedMediaId(uploaded);
        if (!mediaId) {
          throw new Error("Google Flow không trả về mediaId hợp lệ.");
        }
        referenceImageNames.push(mediaId);
        uploadedItems.push({
          fileName: item.fileName,
          mediaId,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (
          reason.includes("File không tồn tại") ||
          reason.includes("ENOENT")
        ) {
          throw new Error(
            `Không thể thử lại vì ảnh tham chiếu "${item.fileName}" không còn tồn tại trên máy (đường dẫn: ${item.filePath}).`,
          );
        }
        throw new Error(
          `Tải ảnh tham chiếu thất bại (${uploadedItems.length}/${refItems.length} ảnh đã tải). Ảnh "${item.fileName}" gặp lỗi: ${reason}`,
        );
      }
    }
    const referenceImageName = referenceImageNames[0] || null;
    const response = data(
      await getElectronApi().generateImage({
        prompt: request.prompt,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        model: request.model,
        aspectRatio: request.aspect,
        seed: request.seed,
        count: 1,
        referenceImageName,
        ...(referenceImageNames.length > 0 ? { referenceImageNames } : {}),
        slotId,
      }),
    );
    const generated = generatedImageResult(response);
    let src = generated.src;
    if (!src && generated.mediaId) {
      src = await imageApi.resolveMediaUrl(generated.mediaId, slotId);
    }
    if (!src) throw new Error("VEO3 không trả về hình ảnh hợp lệ.");
    return {
      mediaId: generated.mediaId,
      slotId,
      src,
    };
  },
  async editVeoImage(
    request: ImageEditRequest & { slotId?: number },
  ): Promise<{ mediaId: string | null; slotId: number; src: string }> {
    const slot =
      typeof request.slotId === "number"
        ? {}
        : record(await getElectronApi().pickRandomSlot());
    const slotId =
      typeof request.slotId === "number"
        ? request.slotId
        : typeof slot.slotId === "number"
          ? slot.slotId
          : 0;
    const imageBytes = request.dataUrl.split(",")[1];
    if (!imageBytes) throw new Error("Dữ liệu ảnh chỉnh sửa không hợp lệ.");
    const upload = record(
      await getElectronApi().uploadImage({
        imageBytes,
        fileName: `edit-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        slotId,
      }),
    );
    const baseMediaId = uploadedMediaId(upload);
    if (!baseMediaId)
      throw new Error("Google Flow không trả media ID cho ảnh đã tải lên.");
    const response = record(
      await getElectronApi().editImage({
        prompt: request.prompt,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        baseMediaId,
        slotId,
      }),
    );
    const generated = generatedImageResult(record(response).data);
    const mediaId = generated.mediaId;
    let src = generated.src;
    if (!src && mediaId) {
      const resolved = await getElectronApi().resolveVideoUrl({
        url: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`,
        slotId,
      });
      if (typeof resolved === "string") src = resolved;
    }
    if (!src) throw new Error("Google Flow không trả ảnh chỉnh sửa hợp lệ.");
    return { mediaId, slotId, src };
  },
  async save(src: string, slotId = 0): Promise<SaveImageResult> {
    try {
      const result = await getElectronApi().saveImageLocally({
        src,
        fileName: `img-${Date.now()}.png`,
        slotId,
      });
      if (typeof result === "string" && result.trim()) {
        return { path: result, saved: true };
      }
      return {
        error: "Không nhận được đường dẫn tệp tin sau khi lưu.",
        saved: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { error, saved: false };
    }
  },
  async crop(
    mediaId: string,
    cropCoordinates: ImageCropCoordinates,
    slotId = 0,
  ): Promise<{ mediaId: string; slotId: number; src: string }> {
    const response = record(
      await getElectronApi().transformImage({
        mediaId,
        cropCoordinates,
        slotId,
      }),
    );
    const responseData = record(response.data);
    const mediaValue = responseData.media;
    const media = Array.isArray(mediaValue)
      ? record(mediaValue[0])
      : record(mediaValue);
    const workflow = record(responseData.workflow);
    const workflows = Array.isArray(responseData.workflows)
      ? record(responseData.workflows[0])
      : {};
    const transformedMediaId =
      typeof media.name === "string"
        ? media.name
        : typeof record(workflow.metadata).primaryMediaId === "string"
          ? String(record(workflow.metadata).primaryMediaId)
          : typeof record(workflows.metadata).primaryMediaId === "string"
            ? String(record(workflows.metadata).primaryMediaId)
            : mediaId;
    const resolved = await getElectronApi().resolveVideoUrl({
      url: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${transformedMediaId}`,
      slotId,
    });
    if (typeof resolved !== "string" || !resolved)
      throw new Error("Google Flow không trả URL ảnh đã crop.");
    const saved = await getElectronApi().saveImageLocally({
      src: resolved,
      fileName: `crop-${Date.now()}.png`,
      slotId,
    });
    return {
      mediaId: transformedMediaId,
      slotId,
      src: typeof saved === "string" && saved ? saved : resolved,
    };
  },
  async upscale(
    mediaId: string,
    resolution: "2K" | "4K",
    slotId = 0,
  ): Promise<string> {
    const response = record(
      await getElectronApi().upscaleImage({
        mediaId,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        targetResolution: `UPSAMPLE_IMAGE_RESOLUTION_${resolution}`,
        slotId,
      }),
    );
    const encodedImage = record(response.data).encodedImage;
    if (typeof encodedImage !== "string" || !encodedImage)
      throw new Error("Google Flow không trả ảnh upscale.");
    const src = `data:image/jpeg;base64,${encodedImage}`;
    await getElectronApi().saveImageLocally({
      src,
      fileName: `upscaled-${resolution}-${Date.now()}.jpg`,
      slotId,
    });
    return src;
  },
  getModels(providerId: string = "veo3"): ImageModel[] {
    return DEFAULT_IMAGE_MODELS[providerId] || DEFAULT_IMAGE_MODELS.veo3 || [];
  },
  async getModelsForSlot(
    slotId: number,
    providerId: string = "veo3",
  ): Promise<ImageModel[]> {
    try {
      const project = record(
        await getElectronApi().getFlowProjectInitialData({ slotId }),
      );
      const pricing = Array.isArray(project.modelPricing)
        ? project.modelPricing.map(record)
        : [];
      const discovered = new Map<string, ImageModel>();
      for (const item of pricing) {
        if (item.kind !== "image" || item.cost === "UNAVAILABLE") continue;
        const value =
          typeof item.usageKey === "string" ? item.usageKey.trim() : "";
        if (!value || discovered.has(value)) continue;
        const familyName =
          typeof item.familyName === "string" ? item.familyName.trim() : "";
        discovered.set(value, {
          value,
          label: imageModelLabels.get(value) || familyName || value,
          ...(typeof item.maxImageInputs === "number"
            ? { maxImageInputs: item.maxImageInputs }
            : {}),
          ...(Array.isArray(item.supportedAspectRatios)
            ? {
                supportedAspectRatios: item.supportedAspectRatios.filter(
                  (aspect): aspect is string => typeof aspect === "string",
                ),
              }
            : {}),
        });
      }
      if (discovered.size > 0) return [...discovered.values()];
    } catch {}
    return imageApi.getModels(providerId);
  },
  async resolveMediaUrl(mediaId: string, slotId = 0): Promise<string> {
    const resolved = await getElectronApi().resolveVideoUrl({
      url: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`,
      slotId,
    });
    return typeof resolved === "string" ? resolved : "";
  },
};
