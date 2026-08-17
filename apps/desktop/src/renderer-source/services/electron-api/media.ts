import { getElectronApi } from "@/services/electron-api/client";

export interface LocalMedia {
  name: string;
  path: string;
  size: number;
  time: number;
  type: "image" | "video";
}
export interface CloudMedia {
  createdAt: string;
  generationId: string;
  kind: "image" | "video";
  model: string;
  prompt: string;
  src: string;
  status: string;
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const normalize = (value: unknown, type: LocalMedia["type"]): LocalMedia[] =>
  (Array.isArray(value) ? value : []).map(record).flatMap((item) => {
    if (typeof item.path !== "string") return [];
    return [
      {
        name:
          typeof item.name === "string"
            ? item.name
            : item.path.split(/[\\/]/).pop() || type,
        path: item.path,
        size: typeof item.size === "number" ? item.size : 0,
        time: typeof item.time === "number" ? item.time : 0,
        type,
      },
    ];
  });

export const mediaApi = {
  downloadCloud(item: CloudMedia) {
    const safeName = `${item.model || item.generationId || "cloud-media"}`
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 80);
    return item.kind === "video"
      ? getElectronApi().downloadAvisVideo({
          url: item.src,
          fileName: `${safeName || "cloud-video"}.mp4`,
        })
      : getElectronApi().saveImageLocally({
          src: item.src,
          fileName: `${safeName || "cloud-image"}.png`,
        });
  },
  async listCloud(
    offset = 0,
    limit = 40,
  ): Promise<{
    configured: boolean;
    items: CloudMedia[];
    total: number;
  }> {
    const response = record(
      await getElectronApi().avisListGenerations({ offset, limit }),
    );
    if (typeof response.error === "string" && response.error)
      throw new Error(response.error);
    const generations = Array.isArray(response.results)
      ? response.results.map(record)
      : [];
    const items = generations.flatMap<CloudMedia>((generation) => {
      const output = record(generation.output);
      const input = record(generation.input);
      const base = {
        createdAt:
          typeof generation.createdAt === "string" ? generation.createdAt : "",
        generationId: typeof generation.id === "string" ? generation.id : "",
        model: typeof generation.model === "string" ? generation.model : "",
        prompt: typeof input.prompt === "string" ? input.prompt : "",
        status: typeof generation.status === "string" ? generation.status : "",
      };
      const images = Array.isArray(output.images)
        ? output.images.map(record)
        : [];
      if (images.length)
        return images.flatMap((image) => {
          const src =
            typeof image.url === "string"
              ? image.url
              : typeof image.downloadUrl === "string"
                ? image.downloadUrl
                : "";
          return src ? [{ ...base, kind: "image" as const, src }] : [];
        });
      const src =
        typeof output.videoUrl === "string"
          ? output.videoUrl
          : typeof output.downloadUrl === "string"
            ? output.downloadUrl
            : "";
      return src ? [{ ...base, kind: "video" as const, src }] : [];
    });
    return {
      configured: response.configured === true,
      items,
      total: Number(response.total || items.length),
    };
  },
  async list(): Promise<LocalMedia[]> {
    const [images, videos] = await Promise.all([
      getElectronApi().listImageFiles(),
      getElectronApi().listVideoFiles(),
    ]);
    return [...normalize(images, "image"), ...normalize(videos, "video")].sort(
      (left, right) => right.time - left.time,
    );
  },
  delete(path: string) {
    return getElectronApi().deleteFile(
      path.replace(/^file:[/\\]{2,3}/, "").replace(/^\/([A-Za-z]:)/, "$1"),
    );
  },
  async importImages(): Promise<number> {
    const selected = await getElectronApi().selectFiles();
    if (!Array.isArray(selected)) return 0;
    let saved = 0;
    for (const raw of selected) {
      const file = record(raw);
      if (
        typeof file.imageBytes !== "string" ||
        typeof file.fileName !== "string"
      )
        continue;
      const mimeType =
        typeof file.mimeType === "string" ? file.mimeType : "image/png";
      await getElectronApi().saveImageLocally({
        src: `data:${mimeType};base64,${file.imageBytes}`,
        fileName: file.fileName,
      });
      saved += 1;
    }
    return saved;
  },
  selectVideos: () => getElectronApi().selectVideoFiles(),
  concat: (filePaths: string[]) => getElectronApi().concatVideos({ filePaths }),
  trim: (filePath: string, startTime: number, endTime: number) =>
    getElectronApi().trimVideo({ filePath, startTime, endTime }),
  openVideoFolder: () => getElectronApi().openOutputFolder(),
};
