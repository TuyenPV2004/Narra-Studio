import { KeyRound, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { AiProviderProfilesPanel } from "@/pages/ProviderAccount/AiProviderProfilesPanel";
import {
  aiProviderApi,
  type AiProviderCapability,
  type AiProviderProfile,
} from "@/services/electron-api/ai-providers";
import type { ProviderId } from "@/types/electron-api";

export function ProviderConnectionsPage({
  providerId: _providerId,
}: {
  providerId: ProviderId;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [activeTextId, setActiveTextId] = useState<string>("");

  const handleProfilesChange = useCallback(
    (
      items: AiProviderProfile[],
      activeByCapability: Partial<Record<AiProviderCapability, string>>,
    ) => {
      setProfiles(items);
      const activeId = activeByCapability.text || "";
      const exists = items.some((p) => p.id === activeId);
      setActiveTextId(exists ? activeId : "");
    },
    [],
  );

  const handleSelectProvider = async (id: string) => {
    if (!id || id === activeTextId) return;
    try {
      await aiProviderApi.setActive(id, "text");
      const selected = profiles.find((p) => p.id === id);
      if (selected?.capabilities?.includes("vision")) {
        await aiProviderApi.setActive(id, "vision");
      }
      setActiveTextId(id);
      setReloadKey((prev) => prev + 1);
      toast.success(`Đã kích hoạt provider "${selected?.name || id}".`);
    } catch (err) {
      toast.error("Không thể kích hoạt provider", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

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

  const isSpinning = loading;

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
              Quản lý và cấu hình AI Provider an toàn trên thiết bị của bạn.
            </p>
          </div>
        </div>
        <div className="source-provider-hero__right">
          <Button
            variant="secondary"
            onClick={() => void handleRefresh()}
            disabled={isSpinning}
          >
            <RefreshCw size={16} className={isSpinning ? "is-spinning" : ""} />
            Làm mới
          </Button>
          <div className="source-provider-hero__select-wrap">
            <Select
              {...(activeTextId ? { value: activeTextId } : {})}
              onValueChange={(val) => void handleSelectProvider(val)}
              disabled={isSpinning || !profiles.length}
            >
              <SelectTrigger
                className="source-provider-hero__select-trigger"
                aria-label="Chọn Provider"
              >
                <SelectValue placeholder="Chọn Provider" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <AiProviderProfilesPanel
        refreshSignal={reloadKey}
        onLoadingChange={setLoading}
        onDirtyChange={setDirty}
        onProfilesChange={handleProfilesChange}
      />
    </section>
  );
}
