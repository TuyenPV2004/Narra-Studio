import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Bot,
  Film,
  FolderOpen,
  Image,
  Images,
  KeyRound,
  Mic2,
  PanelsTopLeft,
  Settings,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import type { SourcePageId } from "@/app/page-config";
import type { AppMessages } from "@/i18n/messages";
import type { ProviderId } from "@/types/electron-api";

export type ImageMode = "edit" | "generate";
export type NavigationGroupId = "assets" | "create" | "edit" | "system";

export interface NavigationItem {
  id: string;
  page: SourcePageId;
  icon: ComponentType<LucideProps>;
  label: (messages: AppMessages) => string;
  imageMode?: ImageMode;
  provider?: ProviderId;
}

export interface NavigationGroup {
  id: NavigationGroupId;
  label: (messages: AppMessages) => string;
  items: readonly NavigationItem[];
}

export const navigationGroups: readonly NavigationGroup[] = [
  {
    id: "create",
    label: ({ sections }) => sections.create,
    items: [
      {
        id: "image-generate",
        page: "image-ultra",
        icon: Image,
        label: ({ pages }) => pages.imageGenerator,
        imageMode: "generate",
      },
      {
        id: "video-generate",
        page: "video-pro",
        icon: Film,
        label: ({ pages }) => pages.videoGenerator,
      },
      {
        id: "voice-generate",
        page: "voice",
        icon: Mic2,
        label: ({ pages }) => pages.voice,
      },
      {
        id: "ai-agent",
        page: "ai-agent",
        icon: Bot,
        label: ({ pages }) => pages.aiAgent,
      },
    ],
  },
  {
    id: "edit",
    label: ({ sections }) => sections.edit,
    items: [
      {
        id: "image-edit",
        page: "image-ultra",
        icon: Images,
        label: ({ pages }) => pages.imageEditor,
        imageMode: "edit",
      },
      {
        id: "video-editor",
        page: "capcut-video",
        icon: Film,
        label: ({ pages }) => pages.videoEditor,
      },
      {
        id: "scene-merge",
        page: "concat",
        icon: PanelsTopLeft,
        label: ({ pages }) => pages.sceneMerge,
      },
    ],
  },
  {
    id: "assets",
    label: ({ sections }) => sections.assets,
    items: [
      {
        id: "library",
        page: "upload",
        icon: FolderOpen,
        label: ({ pages }) => pages.library,
      },
    ],
  },
  {
    id: "system",
    label: ({ sections }) => sections.system,
    items: [
      {
        id: "provider-account",
        page: "provider-account",
        icon: UserRoundCog,
        label: ({ pages }) => pages.providerAccount,
      },
      {
        id: "veo3-login",
        page: "webview",
        icon: KeyRound,
        label: ({ pages }) => pages.veo3Login,
        provider: "veo3",
      },
      {
        id: "captcha-setup",
        page: "captcha-setup",
        icon: ShieldCheck,
        label: ({ pages }) => pages.captchaSetup,
        provider: "veo3",
      },
      {
        id: "settings",
        page: "settings",
        icon: Settings,
        label: ({ pages }) => pages.settings,
      },
    ],
  },
] as const;

export const pageTitle = (
  page: SourcePageId,
  imageMode: ImageMode,
  messages: AppMessages,
): string => {
  if (page === "image-ultra")
    return imageMode === "edit"
      ? messages.pages.imageEditor
      : messages.pages.imageGenerator;
  const titleByPage: Partial<Record<SourcePageId, string>> = {
    "provider-hub": messages.pages.providerHub,
    dashboard: messages.pages.dashboard,
    image: messages.pages.imageGenerator,
    "video-pro": messages.pages.videoGenerator,
    "video-standard": messages.pages.videoGenerator,
    voice: messages.pages.voice,
    "capcut-video": messages.pages.videoEditor,
    "video-editor": messages.pages.quickCut,
    concat: messages.pages.sceneMerge,
    upload: messages.pages.library,
    "provider-account": messages.pages.providerAccount,
    webview: messages.pages.veo3Login,
    "captcha-setup": messages.pages.captchaSetup,
    settings: messages.pages.settings,
    guide: messages.pages.guide,
    "ai-agent": messages.pages.aiAgent,
  };
  return titleByPage[page] ?? page;
};

export const navigationItemsForProvider = (
  providerId: ProviderId,
): readonly NavigationGroup[] =>
  navigationGroups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.provider || item.provider === providerId,
    ),
  }));
