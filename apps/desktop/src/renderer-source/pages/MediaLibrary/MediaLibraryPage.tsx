import {
  Download,
  FolderOpen,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import {
  mediaApi,
  type CloudMedia,
  type LocalMedia,
} from "@/services/electron-api/media";

export function MediaLibraryPage() {
  const [items, setItems] = useState<LocalMedia[]>([]);
  const [cloudItems, setCloudItems] = useState<CloudMedia[]>([]);
  const [cloudTotal, setCloudTotal] = useState(0);
  const [view, setView] = useState<"cloud" | "local">("local");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems(await mediaApi.list());
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadCloud = useCallback(
    async (append = false) => {
      setLoading(true);
      setError(undefined);
      try {
        const result = await mediaApi.listCloud(append ? cloudItems.length : 0);
        if (!result.configured)
          throw new Error("Cloud AI chưa được cấu hình API key.");
        setCloudItems((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setCloudTotal(result.total);
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
      } finally {
        setLoading(false);
      }
    },
    [cloudItems.length],
  );
  useEffect(() => {
    if (view === "cloud" && !cloudItems.length) void loadCloud();
  }, [cloudItems.length, loadCloud, view]);
  const importImages = async () => {
    try {
      await mediaApi.importImages();
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const remove = async (item: LocalMedia) => {
    try {
      await mediaApi.delete(item.path);
      setItems((current) =>
        current.filter((value) => value.path !== item.path),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  const downloadCloud = async (item: CloudMedia) => {
    setError(undefined);
    try {
      await mediaApi.downloadCloud(item);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  return (
    <section className="source-media-page" aria-labelledby="media-title">
      <header>
        <div>
          <small>TÀI NGUYÊN CỤC BỘ</small>
          <h1 id="media-title">
            <FolderOpen size={22} />
            Thư viện
          </h1>
          <p>Ảnh và video được lưu trên thiết bị này.</p>
        </div>
        <div>
          <Tabs
            ariaLabel="Nguồn thư viện"
            value={view}
            onChange={setView}
            options={[
              { value: "local", label: "Cục bộ" },
              { value: "cloud", label: "Cloud AI" },
            ]}
          />
          <Button
            variant="secondary"
            onClick={() => void (view === "local" ? load() : loadCloud())}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
            Làm mới
          </Button>
          {view === "local" && (
            <Button onClick={() => void importImages()}>
              <Upload size={16} />
              Nhập ảnh
            </Button>
          )}
        </div>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      {view === "cloud" ? (
        cloudItems.length === 0 ? (
          <div className="source-generation-empty source-media-empty">
            <FolderOpen size={32} />
            <p>{loading ? "Đang tải Cloud AI..." : "Chưa có generation."}</p>
          </div>
        ) : (
          <>
            <div className="source-media-grid source-cloud-media-grid">
              {cloudItems.map((item, index) => (
                <article key={`${item.generationId}-${item.src}-${index}`}>
                  {item.kind === "image" ? (
                    <img src={item.src} alt={item.prompt || item.model} />
                  ) : (
                    <video src={item.src} controls preload="metadata" />
                  )}
                  <div>
                    <span>{item.kind === "image" ? "Ảnh" : "Video"}</span>
                    <strong title={item.prompt}>
                      {item.prompt || item.model}
                    </strong>
                    <small>{item.status || item.createdAt || "Cloud AI"}</small>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Tải ${item.kind} ${item.prompt || item.model}`}
                    onClick={() => void downloadCloud(item)}
                  >
                    <Download size={15} />
                  </Button>
                </article>
              ))}
            </div>
            {cloudItems.length < cloudTotal && (
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => void loadCloud(true)}
              >
                Tải thêm
              </Button>
            )}
          </>
        )
      ) : items.length === 0 ? (
        <div className="source-generation-empty source-media-empty">
          <FolderOpen size={32} />
          <p>{loading ? "Đang tải thư viện..." : "Chưa có media cục bộ."}</p>
        </div>
      ) : (
        <div className="source-media-grid">
          {items.map((item) => (
            <article key={item.path}>
              {item.type === "image" ? (
                <img src={item.path} alt={item.name} />
              ) : (
                <video src={item.path} preload="metadata" />
              )}
              <div>
                <span>
                  {item.type === "image" ? (
                    <ImageIcon size={14} />
                  ) : (
                    <Video size={14} />
                  )}
                  {item.type === "image" ? "Ảnh" : "Video"}
                </span>
                <strong title={item.name}>{item.name}</strong>
                <small>
                  {item.size
                    ? `${(item.size / 1024 / 1024).toFixed(1)} MB`
                    : "—"}
                </small>
              </div>
              <button
                type="button"
                aria-label={`Xóa ${item.name}`}
                onClick={() => void remove(item)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
