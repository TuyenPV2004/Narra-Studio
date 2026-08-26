import { useEffect, useRef, type ReactNode } from "react";
import type { SourcePageId } from "@/app/page-config";
import type { ImageMode } from "@/app/navigation";
import { Header } from "@/components/Header/Header";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import type { ProviderId } from "@/types/electron-api";

interface AppShellProps {
  activeProvider: ProviderId;
  captchaReady: boolean;
  children: ReactNode;
  currentPage: SourcePageId;
  imageMode: ImageMode;
  onNavigate: (page: SourcePageId, imageMode?: ImageMode) => void;
}

export function AppShell({
  activeProvider,
  captchaReady,
  children,
  currentPage,
  imageMode,
  onNavigate,
}: AppShellProps) {
  const mainContentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainContentRef.current?.focus({ preventScroll: true });
  }, [currentPage, imageMode]);
  return (
    <div className="source-app-shell">
      <Sidebar
        activeProvider={activeProvider}
        currentPage={currentPage}
        imageMode={imageMode}
        onNavigate={onNavigate}
      />
      <Header
        activeProvider={activeProvider}
        captchaReady={captchaReady}
        currentPage={currentPage}
        imageMode={imageMode}
        onNavigate={onNavigate}
      />
      <main
        ref={mainContentRef}
        className="source-main-content"
        tabIndex={-1}
        data-page={currentPage}
      >
        {children}
      </main>
      <div id="overlay-root" />
    </div>
  );
}
