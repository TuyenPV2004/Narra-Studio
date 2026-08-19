import { getElectronApi } from "@/services/electron-api/client";

export interface AiProviderModel {
  id: string;
  name: string;
  ownedBy?: string;
}

export type AiProviderCapability =
  "text" | "vision" | "text-to-speech" | "lip-sync";

export type AiProviderProtocol =
  "openai-compatible" | "narra-tts-v1" | "sync-v2";

export interface AiProviderProfile {
  apiKeyPreview: string;
  baseUrl: string;
  hasApiKey: boolean;
  id: string;
  model: string;
  name: string;
  capabilities: AiProviderCapability[];
  protocol: AiProviderProtocol;
}

export interface AiProviderDraft {
  apiKey?: string;
  baseUrl: string;
  id?: string;
  model?: string;
  name: string;
  capabilities?: AiProviderCapability[];
  protocol?: AiProviderProtocol;
}

export interface AiProviderConnection {
  apiKey?: string;
  baseUrl?: string;
  id?: string;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const profile = (value: unknown): AiProviderProfile | null => {
  const item = record(value);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.baseUrl !== "string"
  )
    return null;
  return {
    id: item.id,
    name: item.name,
    baseUrl: item.baseUrl,
    model: typeof item.model === "string" ? item.model : "",
    capabilities: Array.isArray(item.capabilities)
      ? item.capabilities.filter(
          (value): value is AiProviderCapability =>
            value === "text" ||
            value === "vision" ||
            value === "text-to-speech" ||
            value === "lip-sync",
        )
      : ["text", "vision"],
    protocol:
      item.protocol === "narra-tts-v1" || item.protocol === "sync-v2"
        ? item.protocol
        : "openai-compatible",
    hasApiKey: item.hasApiKey === true,
    apiKeyPreview:
      typeof item.apiKeyPreview === "string" ? item.apiKeyPreview : "",
  };
};

export const aiProviderApi = {
  async list(): Promise<{
    activeId: string;
    activeByCapability: Partial<Record<AiProviderCapability, string>>;
    profiles: AiProviderProfile[];
  }> {
    const response = record(await getElectronApi().aiProviderProfileList());
    return {
      activeId: typeof response.activeId === "string" ? response.activeId : "",
      activeByCapability:
        typeof response.activeByCapability === "object" &&
        response.activeByCapability !== null
          ? (response.activeByCapability as Partial<
              Record<AiProviderCapability, string>
            >)
          : {},
      profiles: Array.isArray(response.profiles)
        ? response.profiles.flatMap((item) => {
            const value = profile(item);
            return value ? [value] : [];
          })
        : [],
    };
  },
  async save(draft: AiProviderDraft): Promise<AiProviderProfile> {
    const response = profile(
      await getElectronApi().aiProviderProfileSave(draft),
    );
    if (!response) throw new Error("Provider trả về cấu hình không hợp lệ.");
    return response;
  },
  async active(
    capability: AiProviderCapability,
  ): Promise<AiProviderProfile | null> {
    const value = await this.list();
    const id = value.activeByCapability[capability];
    return value.profiles.find((profile) => profile.id === id) || null;
  },
  remove: (id: string) => getElectronApi().aiProviderProfileDelete({ id }),
  setActive: (id: string, capability: AiProviderCapability = "text") =>
    getElectronApi().aiProviderProfileSetActive({ id, capability }),
  async models(connection: AiProviderConnection): Promise<AiProviderModel[]> {
    const response = record(
      await getElectronApi().aiProviderProfileModels(connection),
    );
    if (response.connected === false && typeof response.error === "string") {
      throw new Error(response.error);
    }
    return Array.isArray(response.models)
      ? response.models.flatMap((value) => {
          const item = record(value);
          if (typeof item.id !== "string") return [];
          return [
            {
              id: item.id,
              name: typeof item.name === "string" ? item.name : item.id,
              ...(typeof item.ownedBy === "string"
                ? { ownedBy: item.ownedBy }
                : {}),
            },
          ];
        })
      : [];
  },
  async test(connection: AiProviderConnection): Promise<number> {
    const response = record(
      await getElectronApi().aiProviderProfileTest(connection),
    );
    if (response.connected !== true) {
      throw new Error(
        typeof response.error === "string" && response.error
          ? response.error
          : "Không thể kết nối AI provider.",
      );
    }
    return typeof response.modelCount === "number" ? response.modelCount : 0;
  },
};
