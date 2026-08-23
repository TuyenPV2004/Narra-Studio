import { AppShell } from "@/app/AppShell";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { useAppRuntime } from "@/hooks/useAppRuntime";
import { Toaster } from "@/components/ui/Toast";
import { ProviderSelectionPage } from "@/pages/ProviderHub/ProviderSelectionPage";
import { SettingsPage } from "@/pages/Settings/SettingsPage";
import { CaptchaSetupPage } from "@/pages/CaptchaSetup/CaptchaSetupPage";
import { ImageGeneratorPage } from "@/pages/Image/ImageGeneratorPage";
import { ImageEditorPage } from "@/pages/Image/ImageEditorPage";
import { VoicePage } from "@/pages/Voice/VoicePage";
import { VideoGeneratorPage } from "@/pages/Video/VideoGeneratorPage";
import { VideoQueueProvider } from "@/pages/Video/useVideoQueue";
import { MediaLibraryPage } from "@/pages/MediaLibrary/MediaLibraryPage";
import { VideoEditorPage } from "@/pages/VideoEditor/VideoEditorPage";
import { SceneMergePage } from "@/pages/SceneMerge/SceneMergePage";
import { ProviderConnectionsPage } from "@/pages/ProviderAccount/ProviderConnectionsPage";
import { GoogleFlowPage } from "@/pages/GoogleFlow/GoogleFlowPage";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { GuidePage } from "@/pages/Guide/GuidePage";
import { AIAgentSourcePage } from "@/pages/AIAgent/AIAgentSourcePage";
import { CapcutEditorPage } from "@/pages/CapcutEditor/CapcutEditorPage";

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
    </AppShell>
  );
}
