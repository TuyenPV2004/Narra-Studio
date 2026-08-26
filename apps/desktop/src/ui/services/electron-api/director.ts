import { getElectronApi } from "@/services/electron-api/client";

export interface DirectorSceneMeta {
  id: string;
  name: string;
  updatedAt: number;
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
export const directorApi = {
  async listScenes(): Promise<DirectorSceneMeta[]> {
    const value = await getElectronApi().listDirectorScenes();
    return (Array.isArray(value) ? value : []).map(object).flatMap((item) =>
      typeof item.id === "string"
        ? [
            {
              id: item.id,
              name: typeof item.name === "string" ? item.name : item.id,
              updatedAt:
                typeof item.updatedAt === "number" ? item.updatedAt : 0,
            },
          ]
        : [],
    );
  },
  loadScene: (id: string) => getElectronApi().loadDirectorScene({ id }),
  saveScene: (
    id: string | undefined,
    name: string,
    scene: Record<string, unknown>,
  ) =>
    getElectronApi().saveDirectorScene({ ...(id ? { id } : {}), name, scene }),
  saveCapture: (sceneId: string | undefined, name: string, dataUrl: string) =>
    getElectronApi().saveDirectorCapture({
      ...(sceneId ? { sceneId } : {}),
      filename: `${name}.png`,
      dataUrl,
    }),
  createStoryProject: (projectName: string, brief: string, style: string) =>
    getElectronApi().createAIAgentStoryProject({
      projectName,
      brief,
      style,
      density: "Standard",
      characterStyle: "consistent",
      pacing: "cinematic",
    }),
};
