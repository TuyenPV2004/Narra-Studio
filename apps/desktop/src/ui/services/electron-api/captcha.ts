import { getElectronApi } from "@/services/electron-api/client";

export const captchaApi = {
  getBridgeStatus(): Promise<unknown> {
    return getElectronApi().getCaptchaBridgeStatus();
  },
  testExtension(): Promise<unknown> {
    return getElectronApi().testCaptchaExtension();
  },
  async openExtensionFolder(): Promise<{ ok: boolean; error?: string }> {
    const result = await getElectronApi().openExtensionFolder();
    if (result === true) return { ok: true };
    if (typeof result === "object" && result !== null && "ok" in result) {
      const res = result as { ok?: unknown; error?: unknown };
      return typeof res.error === "string"
        ? { ok: res.ok === true, error: res.error }
        : { ok: res.ok === true };
    }
    return { ok: false, error: "Phản hồi mở thư mục không hợp lệ." };
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
