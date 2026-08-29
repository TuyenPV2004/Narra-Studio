import { useCallback, useEffect, useMemo, useState } from "react";
import { sourcePageIds, type SourcePageId } from "@/app/page-config";
import type { ImageMode } from "@/app/navigation";
import { captchaApi, providerApi } from "@/services/electron-api";
import { storageKeys } from "@/storage/keys";
import { readStorageJson, writeStorageValue } from "@/storage/safe-storage";
import type { ProviderId } from "@/types/electron-api";

interface NavigationState {
  page?: string;
  pages?: Partial<Record<ProviderId, string>>;
  providerId?: ProviderId;
}

interface ProviderStatus {
  configured: boolean;
  ready: boolean;
}

const allowedPageIds = new Set<string>(sourcePageIds);
const providerPages = new Set<SourcePageId>([
  "provider-hub",
  "provider-account",
  "webview",
  "captcha-setup",
  "settings",
]);
const configuredProviderPages = new Set<SourcePageId>([
  "dashboard",
  "image",
  "image-ultra",
  "video-pro",
  "video-standard",
  "upload",
  "concat",
  "video-editor",
  "capcut-video",
  "voice",
  "ai-agent",
]);

const isProviderId = (value: unknown): value is ProviderId => value === "veo3";
const isAllowedPage = (value: unknown): value is SourcePageId =>
  typeof value === "string" && allowedPageIds.has(value);
const readBoolean = (value: unknown, key: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  key in value &&
  (value as Record<string, unknown>)[key] === true;

const initialNavigation = (): {
  page: SourcePageId;
  providerId: ProviderId;
} => {
  const stored = readStorageJson<NavigationState>(storageKeys.navigation, {});
  const providerId = isProviderId(stored.providerId)
    ? stored.providerId
    : "veo3";
  const providerPage = stored.pages?.[providerId];
  const storedPage = isAllowedPage(providerPage) ? providerPage : stored.page;
  return {
    page: isAllowedPage(storedPage) ? storedPage : "provider-hub",
    providerId,
  };
};

export function useAppRuntime() {
  const initial = useMemo(initialNavigation, []);
  const [activeProvider, setActiveProvider] = useState<ProviderId>(
    initial.providerId,
  );
  const [currentPage, setCurrentPage] = useState<SourcePageId>(initial.page);
  const [imageMode, setImageMode] = useState<ImageMode>("generate");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    configured: false,
    ready: false,
  });
  const [captchaReady, setCaptchaReady] = useState(false);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [runtimeActive, setRuntimeActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistNavigation = useCallback(
    (page: SourcePageId, providerId: ProviderId) => {
      const stored = readStorageJson<NavigationState>(
        storageKeys.navigation,
        {},
      );
      writeStorageValue(
        storageKeys.navigation,
        JSON.stringify({
          providerId,
          page,
          pages: { ...stored.pages, [providerId]: page },
        }),
      );
    },
    [],
  );

  const refreshRuntime = useCallback(
    async (providerId: ProviderId, activate: boolean) => {
      const selected = activate
        ? await providerApi.setActive(providerId, true)
        : await providerApi.getActive();
      const resolvedProvider = isProviderId(selected) ? selected : providerId;
      const status = await providerApi.getStatus(resolvedProvider);
      const nextStatus = {
        configured: readBoolean(status, "configured"),
        ready: readBoolean(status, "ready"),
      };
      const bridge =
        resolvedProvider === "veo3"
          ? await captchaApi.getBridgeStatus().catch(() => null)
          : null;
      setActiveProvider(resolvedProvider);
      setProviderStatus(nextStatus);
      setCaptchaReady(
        resolvedProvider !== "veo3" || readBoolean(bridge, "setupReady"),
      );
      setSessionConfirmed(activate);
      setRuntimeActive(activate);
      return {
        providerId: resolvedProvider,
        status: nextStatus,
        captchaReady:
          resolvedProvider !== "veo3" || readBoolean(bridge, "setupReady"),
      };
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const runtime = await refreshRuntime(
          initial.providerId,
          initial.page !== "provider-hub",
        );
        if (cancelled) return;
        let nextPage = initial.page;
        if (!runtime.status.configured && configuredProviderPages.has(nextPage))
          nextPage = runtime.providerId === "veo3" ? "webview" : "settings";
        if (
          runtime.providerId === "veo3" &&
          runtime.status.configured &&
          !runtime.captchaReady &&
          !providerPages.has(nextPage)
        )
          nextPage = "captcha-setup";
        setCurrentPage(nextPage);
      } catch (runtimeError) {
        if (!cancelled)
          setError(
            runtimeError instanceof Error
              ? runtimeError.message
              : String(runtimeError),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const syncStatus = async () => {
      try {
        const status = await providerApi.getStatus(activeProvider);
        const bridge =
          activeProvider === "veo3"
            ? await captchaApi.getBridgeStatus().catch(() => null)
            : null;
        if (!active) return;
        const nextStatus = {
          configured: readBoolean(status, "configured"),
          ready: readBoolean(status, "ready"),
        };
        const nextCaptchaReady =
          activeProvider !== "veo3" || readBoolean(bridge, "setupReady");
        setProviderStatus(nextStatus);
        setCaptchaReady(nextCaptchaReady);
        if (nextStatus.configured) {
          setSessionConfirmed(true);
          setRuntimeActive(true);
        }
      } catch {}
    };
    const interval = window.setInterval(syncStatus, 3000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void syncStatus();
    };
    const handleCaptchaChange = () => void syncStatus();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener(
      "genyu:captcha-status-changed",
      handleCaptchaChange,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(
        "genyu:captcha-status-changed",
        handleCaptchaChange,
      );
    };
  }, [activeProvider]);

  useEffect(() => {
    if (!loading) persistNavigation(currentPage, activeProvider);
  }, [activeProvider, currentPage, loading, persistNavigation]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ imageMode?: unknown; page?: unknown }>
      ).detail;
      if (detail?.imageMode === "edit" || detail?.imageMode === "generate")
        setImageMode(detail.imageMode);
      if (isAllowedPage(detail?.page)) setCurrentPage(detail.page);
    };
    window.addEventListener("genyu:navigate-page", handleNavigate);
    return () =>
      window.removeEventListener("genyu:navigate-page", handleNavigate);
  }, []);

  const navigate = useCallback(
    (requestedPage: SourcePageId, nextImageMode?: ImageMode) => {
      let page = requestedPage;
      if (nextImageMode) setImageMode(nextImageMode);
      if (
        page !== "provider-hub" &&
        !providerStatus.configured &&
        (!sessionConfirmed || !runtimeActive)
      )
        page = "provider-hub";
      else if (!providerStatus.configured && configuredProviderPages.has(page))
        page = activeProvider === "veo3" ? "webview" : "settings";
      else if (
        activeProvider === "veo3" &&
        providerStatus.configured &&
        !captchaReady &&
        !providerPages.has(page)
      )
        page = "captcha-setup";
      setCurrentPage(page);
    },
    [
      activeProvider,
      captchaReady,
      providerStatus.configured,
      runtimeActive,
      sessionConfirmed,
    ],
  );

  const activateProvider = useCallback(
    async (providerId: ProviderId) => {
      setLoading(true);
      setError(null);
      try {
        const runtime = await refreshRuntime(providerId, true);
        setCurrentPage(
          !runtime.status.configured
            ? providerId === "veo3"
              ? "webview"
              : "settings"
            : providerId === "veo3" && !runtime.captchaReady
              ? "captcha-setup"
              : "dashboard",
        );
      } catch (runtimeError) {
        setError(
          runtimeError instanceof Error
            ? runtimeError.message
            : String(runtimeError),
        );
      } finally {
        setLoading(false);
      }
    },
    [refreshRuntime],
  );

  return {
    activeProvider,
    activateProvider,
    captchaReady,
    currentPage,
    error,
    imageMode,
    loading,
    navigate,
  };
}
