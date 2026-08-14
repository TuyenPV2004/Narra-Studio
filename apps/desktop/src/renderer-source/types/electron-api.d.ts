export type ProviderId = 'avis' | 'veo3';

export interface ProviderSelectionPayload {
  providerId: ProviderId;
  activate: boolean;
}

export interface ProviderPayload {
  providerId: ProviderId;
}

export interface NarraElectronApi {
  providerGetActive: () => Promise<unknown>;
  providerSetActive: (payload: ProviderSelectionPayload) => Promise<unknown>;
  providerGetStatus: (payload: ProviderPayload) => Promise<unknown>;
  providerGetCredential: (payload: ProviderPayload) => Promise<unknown>;
  providerClearCredential: (payload: ProviderPayload) => Promise<unknown>;
  getCaptchaBridgeStatus: () => Promise<unknown>;
  testCaptchaExtension: () => Promise<unknown>;
  openExtensionFolder: () => Promise<unknown>;
}

declare global {
  interface Window {
    api?: NarraElectronApi;
  }
}
