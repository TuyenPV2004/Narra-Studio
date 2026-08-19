import { KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AiProviderProfilesPanel } from "@/pages/ProviderAccount/AiProviderProfilesPanel";
import type { ProviderId } from "@/types/electron-api";

export function ProviderConnectionsPage({
  providerId: _providerId,
}: {
  providerId: ProviderId;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleRefresh = () => {
    if (
      dirty &&
      !window.confirm(
        "Bạn có thay đổi chưa lưu. Làm mới sẽ xóa các thay đổi này. Tiếp tục?",
      )
    )
      return;
    setReloadKey((prev) => prev + 1);
  };

  return (
    <section
      className="source-tool-page source-provider-account"
      aria-labelledby="provider-account-title"
    >
      <header className="source-provider-hero">
        <div className="source-provider-hero__left">
          <span className="source-provider-hero__icon">
            <KeyRound size={28} aria-hidden="true" />
          </span>
          <div>
            <h1 id="provider-account-title">Kết nối provider</h1>
            <p>
              Quản lý và cấu hình các AI Provider tùy chỉnh. Khóa API được mã
              hóa bảo mật và lưu trữ an toàn trực tiếp trên thiết bị của bạn.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={handleRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
          Làm mới
        </Button>
      </header>

      <AiProviderProfilesPanel
        refreshSignal={reloadKey}
        onLoadingChange={setLoading}
        onDirtyChange={setDirty}
      />
    </section>
  );
}
