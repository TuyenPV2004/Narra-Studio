import { Cloud, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { ProviderId } from "@/types/electron-api";

interface ProviderHubPageProps {
  error: string | null;
  loading: boolean;
  onActivate: (providerId: ProviderId) => Promise<void>;
}

export function ProviderHubPage({
  error,
  loading,
  onActivate,
}: ProviderHubPageProps) {
  return (
    <main className="source-provider-hub">
      <header>
        <span>Narra Studio</span>
        <h1>Chọn provider</h1>
        <p>Chọn nền tảng sẽ được dùng cho phiên làm việc hiện tại.</p>
      </header>
      {error && (
        <p className="source-provider-hub__error" role="alert">
          {error}
        </p>
      )}
      <div className="source-provider-hub__grid">
        <Surface>
          <Workflow size={24} aria-hidden="true" />
          <div>
            <h2>Google VEO3</h2>
            <p>Google Flow, nhiều account slot và CAPTCHA bridge.</p>
          </div>
          <Button disabled={loading} onClick={() => void onActivate("veo3")}>
            Tiếp tục với VEO3
          </Button>
        </Surface>
        <Surface>
          <Cloud size={24} aria-hidden="true" />
          <div>
            <h2>External AI</h2>
            <p>Image, video và workflow bằng API key riêng.</p>
          </div>
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => void onActivate("avis")}
          >
            Tiếp tục với External AI
          </Button>
        </Surface>
      </div>
    </main>
  );
}
