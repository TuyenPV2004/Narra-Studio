import { getElectronApi } from "@/services/electron-api/client";

const asPath = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const settingsApi = {
  async getOutputPaths() {
    const [video, image] = await Promise.all([
      getElectronApi().getVideoOutputPath(),
      getElectronApi().getImageOutputPath(),
    ]);
    return { video: asPath(video), image: asPath(image) };
  },
  async changeVideoOutputFolder() {
    return asPath(await getElectronApi().changeOutputFolder());
  },
  async changeImageOutputFolder() {
    return asPath(await getElectronApi().changeImageOutputFolder());
  },
  openOutputFolder(path: string) {
    return getElectronApi().openOutputFolder(path);
  },
  setManualAuth(bearerToken: string) {
    return getElectronApi().setManualAuth({ bearerToken, projectId: null });
  },
};
