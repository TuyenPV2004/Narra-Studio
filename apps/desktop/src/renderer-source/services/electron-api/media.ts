import { getElectronApi } from "@/services/electron-api/client";

export interface LocalMedia {
  name: string;
  path: string;
  size: number;
  time: number;
  type: "image" | "video";
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
