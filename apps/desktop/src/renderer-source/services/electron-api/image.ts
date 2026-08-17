import { getElectronApi } from "@/services/electron-api/client";

export interface ImageGenerationRequest {
  aspect: string;
  model: string;
  prompt: string;
  providerId: "avis" | "veo3";
  referenceImage?: File;
  requestId?: string;
  resolution?: string;
  seed: number;
  watermark?: boolean;
}
export interface ImageModel {
  label: string;
  value: string;
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
const findImageUrl = (value: unknown, depth = 0): string | undefined => {
  if (depth > 5) return undefined;
  if (
    typeof value === "string" &&
    (value.startsWith("https://") || value.startsWith("data:image/"))
  )
    return value;
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  for (const key of ["fifeUrl", "imageUrl", "url", "thumbnailUrl"]) {
    const candidate = item[key];
    if (
      typeof candidate === "string" &&
      (candidate.startsWith("https://") || candidate.startsWith("data:image/"))
    )
      return candidate;
  }
  for (const nested of Object.values(item)) {
    const candidate = findImageUrl(nested, depth + 1);
    if (candidate) return candidate;
  }
  return undefined;
};

const generateViaFlowPage = async (
  request: ImageGenerationRequest,
): Promise<{ mediaId: string | null; src: string }> => {
  await getElectronApi()
    .selectModelOnWebview({ model: request.model })
    .catch(() => undefined);
  await getElectronApi()
    .selectQuantityOnWebview({ quantity: 1 })
    .catch(() => undefined);
  await getElectronApi()
    .selectAspectOnWebview({ aspect: request.aspect })
    .catch(() => undefined);
  const referenceFilePaths = request.referenceImage
    ? [getElectronApi().getFilePath(request.referenceImage)]
    : [];
  const submitted = data(
    await getElectronApi().generateViaPage({
      prompt: request.prompt,
      type: "image",
      referenceFilePaths,
      referenceImageUrls: [],
    }),
  );
  const requestId =
    typeof submitted.requestId === "string" ? submitted.requestId : undefined;
  const response = data(
    await getElectronApi().waitPageGenResult({
      timeoutMs: 300_000,
      ...(requestId ? { requestId } : {}),
    }),
  );
  const src = findImageUrl(response);
  if (!src) throw new Error("Google Flow không trả về hình ảnh hợp lệ.");
  const media = Array.isArray(response.media) ? record(response.media[0]) : {};
  const workflow = Array.isArray(response.workflows)
    ? record(response.workflows[0])
    : {};
  const primaryMediaId = record(workflow.metadata).primaryMediaId;
  return {
    mediaId:
      typeof media.name === "string"
        ? media.name
        : typeof primaryMediaId === "string"
          ? primaryMediaId
          : null,
    src,
  };
};

export const imageApi = {
  async listAvisModels(): Promise<ImageModel[]> {
    const response = record(await getElectronApi().avisListModels());
    return (Array.isArray(response.models) ? response.models : [])
      .map(record)
      .flatMap((model) => {
        const output = Array.isArray(model.outputModalities)
          ? model.outputModalities.map(String)
          : [];
        if (
          typeof model.modelId !== "string" ||
          model.isActive === false ||
          !output.includes("image")
        )
          return [];
        return [
          {
            value: model.modelId,
            label: typeof model.name === "string" ? model.name : model.modelId,
          },
        ];
      });
  },
  async generate(
    request: ImageGenerationRequest,
  ): Promise<{ mediaId: string | null; src: string }> {
    if (request.providerId === "avis") {
      let images: string[] = [];
      if (request.referenceImage) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(request.referenceImage!);
        });
        const uploaded = record(
          await getElectronApi().avisUploadReference({
            dataUrl,
            fileName: request.referenceImage.name,
            mimeType: request.referenceImage.type || "image/png",
          }),
        );
        if (typeof uploaded.url !== "string")
          throw new Error("External AI không trả URL ảnh tham chiếu.");
        images = [uploaded.url];
      }
      const size =
        request.aspect === "9:16"
          ? "1152x2048"
          : request.aspect === "1:1"
            ? "2048x2048"
            : "2048x1152";
      const response = record(
        await getElectronApi().avisGenerateImage({
          requestId:
            request.requestId ||
            `avis-image-${Date.now()}-${crypto.randomUUID()}`,
          prompt: request.prompt,
          model: request.model,
          n: 1,
          size,
          watermark: request.watermark ?? false,
          images,
          responseFormat: "b64_json",
        }),
      );
      const outputImages = Array.isArray(response.images)
        ? response.images
        : [];
      const first = record(outputImages[0]);
      const src =
        typeof first.url === "string"
          ? first.url
          : typeof first.b64 === "string"
            ? `data:image/png;base64,${first.b64}`
            : "";
      if (!src) throw new Error("External AI không trả về hình ảnh.");
      return { mediaId: null, src };
    }
    const bridge = record(await getElectronApi().getCaptchaBridgeStatus());
    if (bridge.connected !== true) return generateViaFlowPage(request);
    const slot = record(await getElectronApi().pickRandomSlot());
    const slotId = typeof slot.slotId === "number" ? slot.slotId : 0;
    let referenceImageName: string | null = null;
    if (request.referenceImage) {
      const filePath = getElectronApi().getFilePath(request.referenceImage);
      const uploaded = record(
        await getElectronApi().uploadImageFromPath({
          filePath,
          fileName: request.referenceImage.name,
          mimeType: request.referenceImage.type || "image/png",
          slotId,
        }),
      );
      const uploadedMedia = record(record(uploaded.data).media);
      if (typeof uploadedMedia.name !== "string")
        throw new Error("Không thể tải ảnh tham chiếu lên Google Flow.");
      referenceImageName = uploadedMedia.name;
    }
    const response = data(
      await getElectronApi().generateImage({
        prompt: request.prompt,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        model: request.model,
        aspectRatio: request.aspect,
        seed: request.seed,
        count: 1,
        referenceImageName,
        ...(referenceImageName
          ? { referenceImageNames: [referenceImageName] }
          : {}),
        slotId,
      }),
    );
    const media = Array.isArray(response.media)
      ? record(response.media[0])
      : {};
    const image = record(media.image);
    const generated = record(image.generatedImage);
    const src = typeof generated.fifeUrl === "string" ? generated.fifeUrl : "";
    if (!src) throw new Error("VEO3 không trả về hình ảnh hợp lệ.");
    return { mediaId: typeof media.name === "string" ? media.name : null, src };
  },
  cancelAvisGeneration: (requestId: string) =>
    getElectronApi().avisCancelImageGeneration({ requestId }),
  async editVeoImage(
    request: ImageEditRequest,
  ): Promise<{ mediaId: string | null; src: string }> {
    const bridge = record(await getElectronApi().getCaptchaBridgeStatus());
    if (bridge.connected !== true)
      throw new Error("CAPTCHA bridge chưa kết nối.");
    const imageBytes = request.dataUrl.split(",")[1];
    if (!imageBytes) throw new Error("Dữ liệu ảnh chỉnh sửa không hợp lệ.");
    const upload = record(
      await getElectronApi().uploadImage({
        imageBytes,
        fileName: `edit-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      }),
    );
    const uploadData = record(upload.data);
    const uploadedMedia = record(uploadData.media);
    const baseMediaId =
      typeof uploadedMedia.name === "string"
        ? uploadedMedia.name
        : typeof uploadData.name === "string"
          ? uploadData.name
          : "";
    if (!baseMediaId)
      throw new Error("Google Flow không trả media ID cho ảnh đã tải lên.");
    const response = record(
      await getElectronApi().editImage({
        prompt: request.prompt,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        baseMediaId,
      }),
    );
    const responseData = record(response.data);
    const media = Array.isArray(responseData.media)
      ? record(responseData.media[0])
      : {};
    const generated = record(record(media.image).generatedImage);
    const mediaId = typeof media.name === "string" ? media.name : null;
    let src = typeof generated.fifeUrl === "string" ? generated.fifeUrl : "";
    if (!src && mediaId) {
      const resolved = await getElectronApi().resolveVideoUrl({
        url: `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaId}`,
      });
      if (typeof resolved === "string") src = resolved;
    }
    if (!src) throw new Error("Google Flow không trả ảnh chỉnh sửa hợp lệ.");
    return { mediaId, src };
  },
  async save(src: string) {
    const result = await getElectronApi().saveImageLocally({
      src,
      fileName: `img-${Date.now()}.png`,
    });
    return typeof result === "string" ? result : "";
  },
  async crop(
    mediaId: string,
    cropCoordinates: ImageCropCoordinates,
  ): Promise<{ mediaId: string; src: string }> {
    const response = record(
      await getElectronApi().transformImage({ mediaId, cropCoordinates }),
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
    });
    if (typeof resolved !== "string" || !resolved)
      throw new Error("Google Flow không trả URL ảnh đã crop.");
    const saved = await getElectronApi().saveImageLocally({
      src: resolved,
      fileName: `crop-${Date.now()}.png`,
    });
    return {
      mediaId: transformedMediaId,
      src: typeof saved === "string" && saved ? saved : resolved,
    };
  },
  async upscale(mediaId: string, resolution: "2K" | "4K"): Promise<string> {
    const response = record(
      await getElectronApi().upscaleImage({
        mediaId,
        captchaToken: `EXTENSION_PLACEHOLDER_${Date.now()}`,
        targetResolution: `UPSAMPLE_IMAGE_RESOLUTION_${resolution}`,
      }),
    );
    const encodedImage = record(response.data).encodedImage;
    if (typeof encodedImage !== "string" || !encodedImage)
      throw new Error("Google Flow không trả ảnh upscale.");
    const src = `data:image/jpeg;base64,${encodedImage}`;
    await getElectronApi().saveImageLocally({
      src,
      fileName: `upscaled-${resolution}-${Date.now()}.jpg`,
    });
    return src;
  },
};
