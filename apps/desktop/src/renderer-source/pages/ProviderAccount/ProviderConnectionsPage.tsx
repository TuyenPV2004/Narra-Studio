import { KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { AiProviderProfilesPanel } from "@/pages/ProviderAccount/AiProviderProfilesPanel";
import { providerApi } from "@/services/electron-api/provider";
import type { ProviderId } from "@/types/electron-api";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export function ProviderConnectionsPage({
  providerId,
}: {
  providerId: ProviderId;
}) {
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setStatus(record(await providerApi.getStatus(providerId)));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [providerId]);

  return (
    <section
      className="source-tool-page source-provider-account"
      aria-labelledby="provider-account-title"
    >
      <header>
        <div>
          <small>PROVIDER</small>
          <h1 id="provider-account-title">
            <KeyRound size={22} />
            Kết nối provider
          </h1>
          <p>
            Google VEO3 và AI Provider dùng hai contract độc lập. API key AI
            được mã hóa bởi hệ điều hành và không trả về renderer.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
          Làm mới
        </Button>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <section className="source-provider-account__grid">
        <article>
          <span>Google VEO3 / Google Flow</span>
          <strong>
            {status.ready === true
              ? "Sẵn sàng"
              : status.configured === true
                ? "Đã cấu hình"
                : "Chưa cấu hình"}
          </strong>
          <p>
            Session, account slot và CAPTCHA Extension được quản lý riêng với
            các AI Provider dùng API key.
          </p>
        </article>
      </section>
      <AiProviderProfilesPanel />
    </section>
  );
}
