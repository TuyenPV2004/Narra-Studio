import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { navigationItemsForProvider, type ImageMode } from "@/app/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { storageKeys } from "@/storage/keys";
import { readStorageValue, writeStorageValue } from "@/storage/safe-storage";
import type { SourcePageId } from "@/app/page-config";
import type { ProviderId } from "@/types/electron-api";

interface SidebarProps {
  activeProvider: ProviderId;
  currentPage: SourcePageId;
  imageMode: ImageMode;
  onNavigate: (page: SourcePageId, imageMode?: ImageMode) => void;
}

const readInitialCollapsed = (): boolean => {
  const storedValue = readStorageValue(storageKeys.sidebarCollapsed);
  return storedValue === null ? true : storedValue === "1";
};

export function Sidebar({
  activeProvider,
  currentPage,
  imageMode,
  onNavigate,
}: SidebarProps) {
  const { messages } = useLocale();
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const groups = navigationItemsForProvider(activeProvider);

  useEffect(() => {
    writeStorageValue(storageKeys.sidebarCollapsed, collapsed ? "1" : "0");
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed]);

  return (
    <aside
      className="source-sidebar"
      data-collapsed={collapsed}
      aria-label={messages.shell.sidebarLabel}
    >
      <div className="source-sidebar__brand" aria-label="Narra Studio">
        <span className="source-sidebar__mark" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <span className="source-sidebar__brand-copy">Narra</span>
      </div>
      <button
        type="button"
        className="source-sidebar__collapse"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={
          collapsed
            ? messages.shell.expandSidebar
            : messages.shell.collapseSidebar
        }
        title={
          collapsed
            ? messages.shell.expandSidebar
            : messages.shell.collapseSidebar
        }
      >
        {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
      </button>
      <nav
        className="source-sidebar__nav"
        aria-label={messages.shell.navigationLabel}
      >
        {groups.map((group) => (
          <div
            key={group.id}
            className="source-sidebar__group"
            role="group"
            data-nav-group={group.id}
            aria-label={group.label(messages)}
          >
            <span className="source-sidebar__group-label" aria-hidden="true">
              {group.label(messages)}
            </span>
            {group.items.map((item) => {
              const active =
                currentPage === item.page &&
                (!item.imageMode || imageMode === item.imageMode);
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="source-sidebar__item"
                  data-page={item.page}
                  data-intent={item.imageMode}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label(messages) : undefined}
                  onClick={() => onNavigate(item.page, item.imageMode)}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{item.label(messages)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
