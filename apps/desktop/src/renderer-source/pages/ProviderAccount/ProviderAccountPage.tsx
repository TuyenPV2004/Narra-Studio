import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { providerApi } from "@/services/electron-api/provider";
import type { ProviderId } from "@/types/electron-api";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
export function ProviderAccountPage({
  providerId,
}: {
  providerId: ProviderId;
}) {
  const [status, setStatus] = useState<Record<string, unknown>>({});
  const [credential, setCredential] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextStatus, nextCredential] = await Promise.all([
        providerApi.getStatus(providerId),
        providerApi.getCredential(providerId),
      ]);
      setStatus(record(nextStatus));
      const value = record(nextCredential).value;
      setCredential(typeof value === "string" ? value : "");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [providerId]);
  const save = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      await providerApi.configureAvis(apiKey.trim());
      setApiKey("");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setLoading(false);
    }
  };
  const clear = async () => {
    setLoading(true);
    try {
      await providerApi.clearCredential(providerId);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setLoading(false);
    }
  };
  return (
    <section
      className="source-tool-page source-provider-account"
      aria-labelledby="provider-account-title"
    >
      <header>
        <div>
          <small>TÀI KHOẢN PROVIDER</small>
          <h1 id="provider-account-title">
            <KeyRound size={22} />
            {providerId === "avis" ? "External AI" : "Google VEO3"}
          </h1>
          <p>Thông tin kết nối được quản lý bởi runtime Electron hiện tại.</p>
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
          <span>Trạng thái</span>
          <strong>
            {status.ready === true
              ? "Sẵn sàng"
              : status.configured === true
                ? "Đã cấu hình"
                : "Chưa cấu hình"}
          </strong>
          <p>
            {credential
              ? `•••• •••• ${credential.slice(-4)}`
              : "Chưa có mã kết nối được lưu."}
          </p>
          {credential && (
            <Button variant="danger" onClick={() => void clear()}>
              <Trash2 size={15} />
              Ngắt kết nối
            </Button>
          )}
        </article>
        {providerId === "avis" ? (
          <article>
            <label>
              API key External AI
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                placeholder="Nhập API key"
              />
            </label>
            <Button
              disabled={!apiKey.trim() || loading}
              onClick={() => void save()}
            >
              Lưu và kết nối
            </Button>
          </article>
        ) : (
          <article>
            <h2>Google Flow</h2>
            <p>
              Đăng nhập và quản lý nhiều phiên tài khoản tại trang Google Flow.
            </p>
          </article>
        )}
      </section>
    </section>
  );
}
