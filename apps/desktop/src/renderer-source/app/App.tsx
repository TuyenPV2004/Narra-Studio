import { lazy, Suspense } from "react";
import { AppShell } from "@/app/AppShell";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { useAppRuntime } from "@/hooks/useAppRuntime";
import { Toaster } from "@/components/ui/Toast";
import { ProviderSelectionPage } from "@/pages/ProviderHub/ProviderSelectionPage";
import { VideoQueueProvider } from "@/pages/Video/useVideoQueue";

const SettingsPage = lazy(() =>
  import("@/pages/Settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
const CaptchaSetupPage = lazy(() =>
  import("@/pages/CaptchaSetup/CaptchaSetupPage").then((module) => ({
    default: module.CaptchaSetupPage,
  })),
);
const ImageGeneratorPage = lazy(() =>
  import("@/pages/Image/ImageGeneratorPage").then((module) => ({
    default: module.ImageGeneratorPage,
  })),
);
const ImageEditorPage = lazy(() =>
  import("@/pages/Image/ImageEditorPage").then((module) => ({
    default: module.ImageEditorPage,
  })),
);
const VoicePage = lazy(() =>
  import("@/pages/Voice/VoicePage").then((module) => ({
    default: module.VoicePage,
  })),
);
const VideoGeneratorPage = lazy(() =>
  import("@/pages/Video/VideoGeneratorPage").then((module) => ({
    default: module.VideoGeneratorPage,
  })),
);
const MediaLibraryPage = lazy(() =>
  import("@/pages/MediaLibrary/MediaLibraryPage").then((module) => ({
    default: module.MediaLibraryPage,
  })),
);
const VideoEditorPage = lazy(() =>
  import("@/pages/VideoEditor/VideoEditorPage").then((module) => ({
    default: module.VideoEditorPage,
  })),
);
const SceneMergePage = lazy(() =>
  import("@/pages/SceneMerge/SceneMergePage").then((module) => ({
    default: module.SceneMergePage,
  })),
);
const ProviderConnectionsPage = lazy(() =>
  import("@/pages/ProviderAccount/ProviderConnectionsPage").then((module) => ({
    default: module.ProviderConnectionsPage,
  })),
);
const GoogleFlowPage = lazy(() =>
  import("@/pages/GoogleFlow/GoogleFlowPage").then((module) => ({
    default: module.GoogleFlowPage,
  })),
);
const DashboardPage = lazy(() =>
  import("@/pages/Dashboard/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const GuidePage = lazy(() =>
  import("@/pages/Guide/GuidePage").then((module) => ({
    default: module.GuidePage,
  })),
);
const AIAgentSourcePage = lazy(() =>
  import("@/pages/AIAgent/AIAgentSourcePage").then((module) => ({
    default: module.AIAgentSourcePage,
  })),
);
const CapcutEditorPage = lazy(() =>
  import("@/pages/CapcutEditor/CapcutEditorPage").then((module) => ({
    default: module.CapcutEditorPage,
  })),
);

export function App() {
  return (
    <ErrorBoundary>
      <LocaleProvider>
        <VideoQueueProvider>
          <SourceApplication />
        </VideoQueueProvider>
        <Toaster />
      </LocaleProvider>
    </ErrorBoundary>
  );
}

function SourceApplication() {
  const runtime = useAppRuntime();
  if (runtime.currentPage === "provider-hub") {
    return (
      <ProviderSelectionPage
        error={runtime.error}
        loading={runtime.loading}
        onActivate={runtime.activateProvider}
      />
    );
  }
  return (
    <AppShell
      activeProvider={runtime.activeProvider}
      captchaReady={runtime.captchaReady}
      currentPage={runtime.currentPage}
      imageMode={runtime.imageMode}
      onNavigate={runtime.navigate}
    >
      <Suspense fallback={<div role="status">Đang tải chức năng...</div>}>
        {runtime.currentPage === "settings" ? (
          <SettingsPage activeProvider={runtime.activeProvider} />
        ) : runtime.currentPage === "captcha-setup" ? (
          <CaptchaSetupPage />
        ) : (runtime.currentPage === "image" ||
            runtime.currentPage === "image-ultra") &&
          runtime.imageMode === "generate" ? (
          <ImageGeneratorPage providerId={runtime.activeProvider} />
        ) : runtime.currentPage === "image-ultra" &&
          runtime.imageMode === "edit" ? (
          <ImageEditorPage providerId={runtime.activeProvider} />
        ) : runtime.currentPage === "video-pro" ||
          runtime.currentPage === "video-standard" ? (
          <VideoGeneratorPage providerId={runtime.activeProvider} />
        ) : runtime.currentPage === "voice" ? (
          <VoicePage />
        ) : runtime.currentPage === "upload" ? (
          <MediaLibraryPage />
        ) : runtime.currentPage === "capcut-video" ? (
          <CapcutEditorPage />
        ) : runtime.currentPage === "video-editor" ? (
          <VideoEditorPage />
        ) : runtime.currentPage === "concat" ? (
          <SceneMergePage />
        ) : runtime.currentPage === "provider-account" ? (
          <ProviderConnectionsPage providerId={runtime.activeProvider} />
        ) : runtime.currentPage === "webview" ? (
          <GoogleFlowPage />
        ) : runtime.currentPage === "dashboard" ? (
          <DashboardPage providerId={runtime.activeProvider} />
        ) : runtime.currentPage === "ai-agent" ? (
          <AIAgentSourcePage providerId={runtime.activeProvider} />
        ) : (
          <GuidePage />
        )}
      </Suspense>
    </AppShell>
  );
}
