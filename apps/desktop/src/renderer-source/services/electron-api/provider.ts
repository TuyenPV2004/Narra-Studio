import { getElectronApi } from "@/services/electron-api/client";
import type { ProviderId } from "@/types/electron-api";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const providerApi = {
  async getBalance(providerId: ProviderId): Promise<number | undefined> {
    const response = record(
      providerId === "avis"
        ? await getElectronApi().avisGetBalance()
        : await getElectronApi().getCredits(),
    );
    const value =
      providerId === "avis" ? response.creditBalance : response.credits;
    return typeof value === "number" ? value : undefined;
  },
  getActive(): Promise<unknown> {
    return getElectronApi().providerGetActive();
  },
  setActive(providerId: ProviderId, activate = true): Promise<unknown> {
    return getElectronApi().providerSetActive({ providerId, activate });
  },
  getStatus(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerGetStatus({ providerId });
  },
  getCredential(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerGetCredential({ providerId });
  },
  clearCredential(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerClearCredential({ providerId });
  },
  async configureAvis(apiKey: string): Promise<void> {
    await getElectronApi().saveOllamaSettings({
      provider: "avis",
      avisApiKey: apiKey,
    });
    await getElectronApi().providerSetActive({
      providerId: "avis",
      activate: true,
    });
  },
};
