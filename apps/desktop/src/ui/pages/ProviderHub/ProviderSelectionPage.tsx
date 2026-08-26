import { BrainCircuit, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { ProviderId } from "@/types/electron-api";

interface ProviderSelectionPageProps {
  error: string | null;
  loading: boolean;
  onActivate: (providerId: ProviderId) => Promise<void>;
}

export function ProviderSelectionPage({
  error,
  loading,
  onActivate,
}: ProviderSelectionPageProps) {
  return (
    <main className="source-provider-hub">
      <header>
        <span>Narra Studio</span>
        <h1>Kết nối Narra Studio</h1>
        <p>
          Google VEO3 xử lý media qua Google Flow. AI Agent dùng provider API
          được cấu hình độc lập sau khi vào ứng dụng.
        </p>
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
            <p>Google Flow, account slot và CAPTCHA Extension.</p>
          </div>
          <Button disabled={loading} onClick={() => void onActivate("veo3")}>
            Tiếp tục với Google VEO3
          </Button>
        </Surface>
        <Surface>
          <BrainCircuit size={24} aria-hidden="true" />
          <div>
            <h2>AI Provider độc lập</h2>
            <p>
              Sau khi vào ứng dụng, mở Tài khoản provider để nhập Base URL, API
              key và chọn model cho AI Agent.
            </p>
          </div>
        </Surface>
      </div>
    </main>
  );
}
