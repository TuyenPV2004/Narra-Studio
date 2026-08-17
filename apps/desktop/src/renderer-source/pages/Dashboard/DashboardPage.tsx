import { Activity, Gauge, Image, RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  dashboardApi,
  type DashboardSummary,
} from "@/services/electron-api/dashboard";
import type { ProviderId } from "@/types/electron-api";
const empty: DashboardSummary = {
  imageStorage: 0,
  recentActivity: 0,
  totalImages: 0,
  totalVideos: 0,
  videoStorage: 0,
};
export function DashboardPage({ providerId }: { providerId: ProviderId }) {
  const [summary, setSummary] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setSummary(await dashboardApi.load(providerId));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [providerId]);
  useEffect(() => {
    void load();
  }, [load]);
  const storage = summary.imageStorage + summary.videoStorage;
  return (
    <section
      className="source-tool-page source-dashboard"
      aria-labelledby="dashboard-title"
    >
      <header>
        <div>
          <small>
            TỔNG QUAN {providerId === "avis" ? "EXTERNAL AI" : "GOOGLE VEO3"}
          </small>
          <h1 id="dashboard-title">
            <Gauge size={22} />
            Bảng điều khiển
          </h1>
          <p>Dữ liệu hoạt động và nội dung lưu cục bộ.</p>
        </div>
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => void load()}
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
      <div className="source-metric-grid">
        <article>
          <Image size={20} />
          <span>Hình ảnh</span>
          <strong>{summary.totalImages}</strong>
        </article>
        <article>
          <Video size={20} />
          <span>Video</span>
          <strong>{summary.totalVideos}</strong>
        </article>
        <article>
          <Activity size={20} />
          <span>Dung lượng</span>
          <strong>{(storage / 1024 / 1024).toFixed(1)} MB</strong>
        </article>
        {providerId === "avis" && (
          <article>
            <Gauge size={20} />
            <span>Số dư</span>
            <strong>
              {summary.balance === undefined
                ? "—"
                : summary.balance.toLocaleString()}
            </strong>
            <small>{summary.recentActivity} hoạt động gần đây</small>
          </article>
        )}
      </div>
    </section>
  );
}
