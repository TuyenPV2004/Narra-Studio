import { getElectronApi } from "@/services/electron-api/client";

export const captchaApi = {
  getBridgeStatus(): Promise<unknown> {
    return getElectronApi().getCaptchaBridgeStatus();
  },
  testExtension(): Promise<unknown> {
    return getElectronApi().testCaptchaExtension();
  },
  openExtensionFolder(): Promise<unknown> {
    return getElectronApi().openExtensionFolder();
  },
  copyChromeExtensionsAddress(): Promise<unknown> {
    return getElectronApi().copyToClipboard("chrome://extensions");
  },
  openGoogleFlow(): Promise<unknown> {
    return getElectronApi().openExternalUrl(
      "https://labs.google/fx/tools/flow",
    );
  },
};
