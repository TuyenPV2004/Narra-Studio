import {
  ChevronDown,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import type { SourcePageId } from "@/app/page-config";
import { pageTitle, type ImageMode } from "@/app/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import type { ProviderId } from "@/types/electron-api";
import { useEffect, useState } from "react";
import { providerApi } from "@/services/electron-api/provider";

interface HeaderProps {
  activeProvider: ProviderId;
  captchaReady: boolean;
  currentPage: SourcePageId;
  imageMode: ImageMode;
  onNavigate: (page: SourcePageId) => void;
}

export function Header({
  activeProvider,
  captchaReady,
  currentPage,
  imageMode,
  onNavigate,
}: HeaderProps) {
  const { messages } = useLocale();
  const [balance, setBalance] = useState<number>();
  const title = pageTitle(currentPage, imageMode, messages);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      providerApi
        .getBalance(activeProvider)
        .then((value) => {
          if (active) setBalance(value);
        })
        .catch(() => {
          if (active) setBalance(undefined);
        });
    void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(
      refresh,
      activeProvider === "avis" ? 30_000 : 60_000,
    );
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeProvider]);
  return (
    <header className="source-header" aria-label={messages.shell.headerLabel}>
      <div className="source-header__context">
        <span>Narra Studio</span>
        <strong>{title}</strong>
      </div>
      <div className="source-header__actions">
        {balance !== undefined && (
          <output className="source-header__balance" aria-label="Credits">
            {balance.toLocaleString("vi-VN", {
              maximumFractionDigits: activeProvider === "avis" ? 2 : 0,
            })}{" "}
            credits
          </output>
        )}
        {activeProvider === "veo3" && (
          <button
            type="button"
            className="source-header__status"
            data-state={captchaReady ? "connected" : "attention"}
            onClick={() => onNavigate("captcha-setup")}
          >
            {captchaReady ? (
              <ShieldCheck size={16} aria-hidden="true" />
            ) : (
              <TriangleAlert size={16} aria-hidden="true" />
            )}
            <span>
              {captchaReady
                ? messages.shell.captchaConnected
                : messages.shell.captchaSetupNeeded}
            </span>
          </button>
        )}
        <button
          type="button"
          className="source-header__account"
          onClick={() => onNavigate("provider-account")}
          aria-label={messages.shell.providerAccount}
        >
          <UserRound size={17} aria-hidden="true" />
          <span>
            {activeProvider === "veo3" ? "Google VEO3" : "External AI"}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
