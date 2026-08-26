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

export const providerCapabilities: readonly AiProviderCapability[] = [
  "text",
  "vision",
  "text-to-speech",
  "lip-sync",
];

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
  model?: string;
  protocol?: AiProviderProtocol;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const requireSuccessful = async <T>(operation: Promise<T>): Promise<T> => {
  const result = await operation;
  const value = record(result);
  if (value.success === false) {
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Thao tác provider thất bại.",
    );
  }
  return result;
};

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
    const raw = await getElectronApi().aiProviderProfileList();
    const response = record(raw);
    if (!Array.isArray(response.profiles)) {
      throw new Error("Provider trả về danh sách cấu hình không hợp lệ.");
    }
    const profiles = response.profiles.flatMap((item) => {
      const value = profile(item);
      return value ? [value] : [];
    });
    const validIds = new Set(profiles.map((item) => item.id));
    const activeByCapability =
      typeof response.activeByCapability === "object" &&
      response.activeByCapability !== null
        ? Object.fromEntries(
            providerCapabilities.flatMap((capability) => {
              const id = (
                response.activeByCapability as Record<string, unknown>
              )[capability];
              return typeof id === "string" && validIds.has(id)
                ? [[capability, id]]
                : [];
            }),
          )
        : {};
    return {
      activeId: typeof response.activeId === "string" ? response.activeId : "",
      activeByCapability,
      profiles,
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
  remove: (id: string) =>
    requireSuccessful(getElectronApi().aiProviderProfileDelete({ id })),
  setActive: (id: string, capability: AiProviderCapability = "text") =>
    requireSuccessful(
      getElectronApi().aiProviderProfileSetActive({ id, capability }),
    ),
  async models(connection: AiProviderConnection): Promise<AiProviderModel[]> {
    const response = record(
      await getElectronApi().aiProviderProfileModels(connection),
    );
    if (response.connected === false && typeof response.error === "string") {
      throw new Error(response.error);
    }
    const models = Array.isArray(response.models)
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
    if (!models.length) {
      throw new Error("Provider kết nối được nhưng không tìm thấy model nào.");
    }
    return models;
  },
  async test(connection: AiProviderConnection): Promise<{
    modelCount: number;
    verifiedModel: string;
  }> {
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
    if (
      typeof response.modelCount !== "number" ||
      !Number.isInteger(response.modelCount) ||
      response.modelCount < 0 ||
      typeof response.verifiedModel !== "string" ||
      !response.verifiedModel.trim()
    ) {
      throw new Error("Provider trả về kết quả kiểm tra không hợp lệ.");
    }
    return {
      modelCount: response.modelCount,
      verifiedModel: response.verifiedModel,
    };
  },
};
