import { useCallback, useEffect, useState } from "react";
import { captchaApi } from "@/services/electron-api";

export interface CaptchaStatus {
  extensionCompatible: boolean;
  extensionConnected: boolean;
  extensionVersion: string;
  labsProjectOpen: boolean;
  labsTabOpen: boolean;
  requiredExtensionVersion: string;
  setupReady: boolean;
  tokenError: string;
  tokenVerified: boolean;
}

const emptyStatus: CaptchaStatus = {
  extensionCompatible: false,
  extensionConnected: false,
  extensionVersion: "",
  labsProjectOpen: false,
  labsTabOpen: false,
  requiredExtensionVersion: "1.3.1",
  setupReady: false,
  tokenError: "",
  tokenVerified: false,
};

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
const parseStatus = (value: unknown): CaptchaStatus => ({
  extensionCompatible: field(value, "extensionCompatible") === true,
  extensionConnected: field(value, "extensionConnected") === true,
  extensionVersion:
    typeof field(value, "extensionVersion") === "string"
      ? (field(value, "extensionVersion") as string)
      : "",
  labsProjectOpen: field(value, "labsProjectOpen") === true,
  labsTabOpen: field(value, "labsTabOpen") === true,
  requiredExtensionVersion:
    typeof field(value, "requiredExtensionVersion") === "string"
      ? (field(value, "requiredExtensionVersion") as string)
      : "1.3.1",
  setupReady: field(value, "setupReady") === true,
  tokenError:
    typeof field(value, "tokenError") === "string"
      ? (field(value, "tokenError") as string)
      : "",
  tokenVerified: field(value, "tokenVerified") === true,
});

export function useCaptchaSetup() {
  const [status, setStatus] = useState<CaptchaStatus>(emptyStatus);
  const [checking, setChecking] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const [next] = await Promise.all([
        captchaApi.getBridgeStatus().then(parseStatus),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      setStatus(next);
      window.dispatchEvent(
        new CustomEvent("genyu:captcha-status-changed", { detail: next }),
      );
      return next;
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : String(runtimeError),
      );
      return emptyStatus;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verify = useCallback(async () => {
    setVerifying(true);
    setError(null);
    try {
      const [result] = await Promise.all([
        captchaApi.testExtension(),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      await refresh();
      return (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        (result as Record<string, unknown>).ok === true
      );
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : String(runtimeError),
      );
      return false;
    } finally {
      setVerifying(false);
    }
  }, [refresh]);

  return { checking, error, refresh, status, verify, verifying };
}
