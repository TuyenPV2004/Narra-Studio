import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { mediaApi, type LocalMedia } from "@/services/electron-api/media";

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(time: number): string {
  if (!time) return "—";
  try {
    const d = new Date(time);
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function MediaLibraryPage() {
  const [items, setItems] = useState<LocalMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewMedia, setPreviewMedia] = useState<LocalMedia | null>(null);
  const [deletingMedia, setDeletingMedia] = useState<LocalMedia | null>(null);
  const [error, setError] = useState<string>();

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [items, filter, searchQuery]);

  const currentIndex = previewMedia
    ? filteredItems.findIndex((item) => item.path === previewMedia.path)
    : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < filteredItems.length - 1;

  const goToPrev = useCallback(() => {
    if (hasPrev) {
      const prev = filteredItems[currentIndex - 1];
      if (prev) setPreviewMedia(prev);
    }
  }, [hasPrev, currentIndex, filteredItems]);

  const goToNext = useCallback(() => {
    if (hasNext) {
      const next = filteredItems[currentIndex + 1];
      if (next) setPreviewMedia(next);
    }
  }, [hasNext, currentIndex, filteredItems]);

  useEffect(() => {
    if (!previewMedia) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentIndex > 0) {
          const prev = filteredItems[currentIndex - 1];
          if (prev) setPreviewMedia(prev);
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < filteredItems.length - 1) {
          const next = filteredItems[currentIndex + 1];
          if (next) setPreviewMedia(next);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMedia, currentIndex, filteredItems]);

  const load = useCallback(async (isManual = false) => {
    if (isManual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(undefined);
    try {
      const data = await mediaApi.list();
      setItems(data);
      if (isManual) {
        toast.success("Đã làm mới thư viện.");
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importImages = async () => {
    setImporting(true);
    try {
      const count = await mediaApi.importImages();
      if (count === 0) {
        toast.info("Không có ảnh mới nào được chọn.");
      } else {
        await load();
        toast.success(`Đã nhập thành công ${count} ảnh vào thư viện.`);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      toast.error("Nhập ảnh thất bại", {
        description: value instanceof Error ? value.message : String(value),
      });
    } finally {
      setImporting(false);
    }
  };

  const remove = async (item: LocalMedia) => {
    try {
      await mediaApi.delete(item);
      setItems((current) =>
        current.filter((value) => value.path !== item.path),
      );
      if (previewMedia?.path === item.path) {
        setPreviewMedia(null);
      }
      toast.success(`Đã chuyển "${item.name}" vào Thùng rác.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  const isBusy = loading || refreshing || importing;

  return (
    <section
      className="source-tool-page source-media-page"
      aria-labelledby="media-title"
    >
      <header className="source-media-hero">
        <div className="source-media-hero__left">
          <span className="source-media-hero__icon">
            <FolderOpen size={28} aria-hidden="true" />
          </span>
          <div>
            <h1 id="media-title">Thư viện</h1>
            <p>Ảnh và video được lưu trên thiết bị này.</p>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <Button
            variant="secondary"
            onClick={() => void load(true)}
            disabled={isBusy}
          >
            <RefreshCw
              size={16}
              className={loading || refreshing ? "is-spinning" : ""}
            />
            Làm mới
          </Button>
          <Button onClick={() => void importImages()} disabled={isBusy}>
            <Upload size={16} className={importing ? "is-spinning" : ""} />
            {importing ? "Đang nhập..." : "Nhập ảnh"}
          </Button>
        </div>
      </header>

      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <div className="source-media-toolbar">
          <div
            className="source-media-filters"
            role="group"
            aria-label="Lọc loại media"
          >
            <button
              type="button"
              className="source-media-filter-btn"
              data-active={filter === "all"}
              onClick={() => setFilter("all")}
            >
              Tất cả ({items.length})
            </button>
            <button
              type="button"
              className="source-media-filter-btn"
              data-active={filter === "image"}
              onClick={() => setFilter("image")}
            >
              <ImageIcon size={13} aria-hidden="true" />
              Ảnh ({items.filter((i) => i.type === "image").length})
            </button>
            <button
              type="button"
              className="source-media-filter-btn"
              data-active={filter === "video"}
              onClick={() => setFilter("video")}
            >
              <Video size={13} aria-hidden="true" />
              Video ({items.filter((i) => i.type === "video").length})
            </button>
          </div>

          <div className="source-media-search">
            <Search
              size={14}
              className="source-media-search__icon"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Tìm kiếm tệp theo tên..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Tìm kiếm media theo tên"
            />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="source-generation-empty source-media-empty">
          <FolderOpen size={32} />
          <p>{loading ? "Đang tải thư viện..." : "Chưa có media cục bộ."}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="source-generation-empty source-media-empty">
          <FolderOpen size={32} />
          <p>Không tìm thấy media phù hợp với bộ lọc.</p>
        </div>
      ) : (
        <div className="source-media-grid">
          {filteredItems.map((item) => (
            <article key={item.path} className="source-media-card">
              <div className="source-media-card__thumb">
                <button
                  type="button"
                  className="source-media-card__preview-btn"
                  onClick={() => setPreviewMedia(item)}
                  aria-label={`Xem ${item.name}`}
                >
                  {item.type === "image" ? (
                    <img
                      src={item.path}
                      alt={item.name}
                      loading="lazy"
                      className="source-media-card__media"
                    />
                  ) : (
                    <video
                      src={item.path}
                      preload="metadata"
                      className="source-media-card__media"
                    />
                  )}

                  <div className="source-media-card__badge">
                    {item.type === "image" ? (
                      <>
                        <ImageIcon size={11} aria-hidden="true" />
                        <span>Ảnh</span>
                      </>
                    ) : (
                      <>
                        <Play
                          size={11}
                          fill="currentColor"
                          aria-hidden="true"
                        />
                        <span>Video</span>
                      </>
                    )}
                  </div>

                  <div className="source-media-card__overlay">
                    <span className="source-media-card__action-icon">
                      {item.type === "video" ? (
                        <Play
                          size={20}
                          fill="currentColor"
                          style={{ marginLeft: 2 }}
                        />
                      ) : (
                        <Eye size={20} />
                      )}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  className="source-media-card__btn-delete"
                  title={`Xóa ${item.name}`}
                  aria-label={`Xóa ${item.name}`}
                  onClick={() => setDeletingMedia(item)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>

              <div className="source-media-card__info">
                <button
                  type="button"
                  className="source-media-card__title-btn"
                  onClick={() => setPreviewMedia(item)}
                  aria-label={`Xem chi tiết ${item.name}`}
                >
                  <h4 className="source-media-card__name" title={item.name}>
                    {item.name}
                  </h4>
                </button>
                <div className="source-media-card__meta">
                  <span>{formatFileSize(item.size)}</span>
                  <span>{formatDate(item.time)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(previewMedia)}
        onOpenChange={(open) => {
          if (!open) setPreviewMedia(null);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {previewMedia && (
            <>
              <DialogTitle style={{ display: "none" }}>
                {previewMedia.name}
              </DialogTitle>
              <DialogDescription style={{ display: "none" }}>
                Xem chi tiết media
              </DialogDescription>

              {filteredItems.length > 1 && currentIndex >= 0 && (
                <div className="source-media-lightbox__counter">
                  {currentIndex + 1} / {filteredItems.length}
                </div>
              )}

              <button
                type="button"
                className="source-media-lightbox__btn-close"
                title="Đóng (Esc)"
                aria-label="Đóng"
                onClick={() => setPreviewMedia(null)}
              >
                <X size={20} />
              </button>

              {hasPrev && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--prev"
                  title="Xem tệp trước (Phím ←)"
                  aria-label="Xem tệp trước"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToPrev();
                  }}
                >
                  <ChevronLeft size={28} />
                </button>
              )}

              <div className="source-media-lightbox__stage">
                {previewMedia.type === "image" ? (
                  <img
                    key={previewMedia.path}
                    src={previewMedia.path}
                    alt={previewMedia.name}
                    className="source-media-lightbox__img"
                  />
                ) : (
                  <video
                    key={previewMedia.path}
                    src={previewMedia.path}
                    controls
                    autoPlay
                    playsInline
                    className="source-media-lightbox__video"
                  />
                )}
              </div>

              {hasNext && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--next"
                  title="Xem tệp tiếp theo (Phím →)"
                  aria-label="Xem tệp tiếp theo"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToNext();
                  }}
                >
                  <ChevronRight size={28} />
                </button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deletingMedia)}
        onOpenChange={(open) => {
          if (!open) setDeletingMedia(null);
        }}
      >
        <DialogContent showClose={false}>
          <DialogHeader>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  borderRadius: "9999px",
                  background: "var(--danger)",
                  color: "#ffffff",
                  flexShrink: 0,
                  boxShadow:
                    "0 2px 6px color-mix(in srgb, var(--danger) 35%, transparent)",
                }}
              >
                <AlertTriangle size={17} aria-hidden="true" />
              </div>
              <div>
                <DialogTitle>
                  Xác nhận xóa{" "}
                  {deletingMedia?.type === "image" ? "ảnh" : "video"}
                </DialogTitle>
                <DialogDescription>
                  Tệp sẽ được chuyển vào Thùng rác của hệ thống.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div
            style={{
              padding: "8px 0",
              fontSize: "0.9rem",
              color: "var(--foreground)",
              lineHeight: 1.5,
            }}
          >
            Bạn có chắc chắn muốn chuyển tệp{" "}
            <strong>"{deletingMedia?.name}"</strong> vào Thùng rác không? Bạn
            vẫn có thể khôi phục lại từ Thùng rác của máy tính nếu cần.
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeletingMedia(null)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deletingMedia) {
                  const target = deletingMedia;
                  setDeletingMedia(null);
                  void remove(target);
                }
              }}
            >
              Chuyển vào Thùng rác
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
