import { getElectronApi } from "@/services/electron-api/client";

export interface LocalMedia {
  name: string;
  path: string;
  localPath: string;
  size: number;
  time: number;
  type: "image" | "video" | "audio";
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export function cleanMediaDisplayName(rawName: string): string {
  if (!rawName) return "";
  // Remove 10-14 digit unix timestamp suffixes like "-1787593310597" or "_1787593310597" before file extension
  return rawName.replace(/[-_]\d{10,14}(?=\.[^.]+$|$)/, "");
}

export const normalizeMediaItem = (
  item: Record<string, unknown>,
  type: LocalMedia["type"],
): LocalMedia | null => {
  const rawPath = typeof item.path === "string" ? item.path : "";
  const fileUrl = typeof item.fileUrl === "string" ? item.fileUrl : "";
  const target = fileUrl || rawPath;
  if (!target) return null;

  const src =
    fileUrl ||
    (rawPath.startsWith("file:")
      ? rawPath
      : `file:///${rawPath.replace(/\\/g, "/")}`);
  const fallbackName =
    rawPath.split(/[\\/]/).pop() || fileUrl.split(/[\\/]/).pop() || type;
  const rawName =
    typeof item.name === "string" && item.name.trim()
      ? item.name.trim()
      : fallbackName;
  const name = cleanMediaDisplayName(rawName);

  return {
    name,
    path: src,
    localPath: rawPath || fileUrl,
    size: typeof item.size === "number" ? item.size : 0,
    time: typeof item.time === "number" ? item.time : 0,
    type,
  };
};

const normalize = (value: unknown, type: LocalMedia["type"]): LocalMedia[] =>
  (Array.isArray(value) ? value : [])
    .map(record)
    .map((item) => normalizeMediaItem(item, type))
    .filter((item): item is LocalMedia => item !== null);

export const mediaApi = {
  async list(): Promise<LocalMedia[]> {
    const [images, videos, voices] = await Promise.all([
      getElectronApi().listImageFiles(),
      getElectronApi().listVideoFiles(),
      getElectronApi().listVoiceFiles(),
    ]);
    return [
      ...normalize(images, "image"),
      ...normalize(videos, "video"),
      ...normalize(voices, "audio"),
    ].sort((left, right) => right.time - left.time);
  },
  delete(mediaOrPath: LocalMedia | string) {
    const pathToDelete =
      typeof mediaOrPath === "object" && mediaOrPath !== null
        ? mediaOrPath.localPath || mediaOrPath.path
        : mediaOrPath;
    return getElectronApi().deleteFile(pathToDelete);
  },
  async importImages(): Promise<number> {
    const selected = await getElectronApi().selectFiles();
    if (!Array.isArray(selected) || selected.length === 0) return 0;
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
