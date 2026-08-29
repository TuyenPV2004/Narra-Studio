import {
  Check,
  Copy,
  FolderPlus,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCw,
  User,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { flowApi, type FlowSlot } from "@/services/electron-api/flow";
import { getElectronApi } from "@/services/electron-api/client";

export function GoogleFlowPage() {
  const [slots, setSlots] = useState<FlowSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [activeAction, setActiveAction] = useState<{
    slotId: number;
    type: "login" | "logout" | "switch" | "sync" | "create";
  } | null>(null);
  const loadRequestRef = useRef(0);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const requestId = ++loadRequestRef.current;
    try {
      const [nextSlots] = await Promise.all([
        flowApi.listSlots(),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      if (requestId === loadRequestRef.current) setSlots(nextSlots);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const scheduleLoad = () => {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => void load(), 100);
    };
    const cleanup = flowApi.subscribeSlotsChanged(scheduleLoad);
    return () => {
      cleanup();
      window.clearTimeout(refreshTimerRef.current);
    };
  }, [load]);

  const action = async (
    slotId: number,
    type: "login" | "logout" | "switch" | "create",
    operation: () => Promise<unknown>,
  ) => {
    setActiveAction({ slotId, type });
    setError(undefined);
    try {
      await operation();
      await load();
    } catch (value) {
      const msg = value instanceof Error ? value.message : String(value);
      setError(msg);
      toast.error("Thao tác thất bại", { description: msg });
    } finally {
      setActiveAction(null);
    }
  };

  const handleSync = async (slotId: number) => {
    setSyncingId(slotId);
    setActiveAction({ slotId, type: "sync" });
    try {
      await Promise.all([
        flowApi.sync(slotId),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      await load();
      toast.success(`Đã đồng bộ phiên Slot ${slotId + 1} thành công!`);
    } catch (value) {
      const msg = value instanceof Error ? value.message : String(value);
      setError(msg);
      toast.error(`Đồng bộ Slot ${slotId + 1} thất bại`, { description: msg });
    } finally {
      setSyncingId(null);
      setActiveAction(null);
    }
  };

  const copyProjectId = async (projectId: string) => {
    try {
      try {
        await navigator.clipboard.writeText(projectId);
      } catch {
        await getElectronApi().copyToClipboard(projectId);
      }
      setCopiedId(projectId);
      toast.success("Đã sao chép Project ID vào bộ nhớ tạm!");
      setTimeout(() => setCopiedId(null), 2000);
    } catch (value) {
      const msg = value instanceof Error ? value.message : String(value);
      toast.error("Không thể sao chép Project ID", { description: msg });
    }
  };

  return (
    <section
      className="source-tool-page source-flow-page"
      aria-labelledby="flow-title"
    >
      <header className="source-flow-hero">
        <div className="source-flow-hero__left">
          <span className="source-flow-hero__icon">
            <Users size={28} aria-hidden="true" />
          </span>
          <div>
            <h1 id="flow-title">Phiên tài khoản</h1>
            <p>
              Mỗi slot giữ session riêng; Narra không chia sẻ cookie giữa các
              tài khoản.
            </p>
          </div>
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

      <div className="source-flow-grid">
        {slots.map((slot) => {
          const isConnected = slot.status === "connected";
          const isAuthenticated = slot.status === "authenticated";
          const isRestoring = slot.status === "restoring";
          const isExpired = slot.status === "expired";
          const isError = slot.status === "error";

          let statusTitle = "Chưa đăng nhập";
          let statusSubtitle = "Nhấn Đăng nhập để kết nối";
          let dotLabel = "Chưa kết nối";

          const fallbackName = slot.email
            ? slot.email.split("@")[0] || "Tài khoản Google"
            : "Tài khoản Google";

          if (isConnected) {
            statusTitle = slot.displayName || fallbackName;
            statusSubtitle = slot.email || "Đã kết nối (Sẵn sàng tạo media)";
            dotLabel = "Đã kết nối";
          } else if (isAuthenticated) {
            statusTitle = slot.displayName || fallbackName;
            statusSubtitle = slot.email
              ? `${slot.email} (Đã khôi phục phiên)`
              : "Đã khôi phục phiên Google";
            dotLabel = "Đã khôi phục phiên";
          } else if (isRestoring) {
            statusTitle = slot.displayName || "Đang kiểm tra...";
            statusSubtitle = "Đang khôi phục phiên...";
            dotLabel = "Đang khôi phục";
          } else if (isExpired) {
            statusTitle = slot.displayName || fallbackName;
            statusSubtitle = "Phiên đã hết hạn — Vui lòng đăng nhập lại";
            dotLabel = "Phiên hết hạn";
          } else if (isError) {
            statusTitle = slot.displayName || fallbackName;
            statusSubtitle = "Lỗi kết nối — Hãy thử lại";
            dotLabel = "Lỗi kết nối";
          }

          return (
            <article
              key={slot.id}
              className="source-flow-slot-card"
              data-status={slot.status}
              data-connected={isConnected}
            >
              {}
              <div className="source-flow-slot-card__top">
                <span className="source-flow-slot-tag">Slot {slot.id + 1}</span>
                <div className="source-flow-slot-card__top-right">
                  {slot.projectId && (
                    <button
                      type="button"
                      className="source-flow-slot-project"
                      title={
                        copiedId === slot.projectId
                          ? "Đã sao chép vào bộ nhớ tạm!"
                          : `Project ID: ${slot.projectId} (Nhấn để sao chép)`
                      }
                      aria-label={`Sao chép Project ID Slot ${slot.id + 1}`}
                      onClick={() => void copyProjectId(slot.projectId!)}
                    >
                      <span className="source-flow-slot-project__label">
                        Project:
                      </span>
                      <code>
                        {slot.projectId.length > 13
                          ? `${slot.projectId.slice(0, 8)}…${slot.projectId.slice(-4)}`
                          : slot.projectId}
                      </code>
                      {copiedId === slot.projectId ? (
                        <Check
                          size={12}
                          className="source-flow-slot-project__copied-icon"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy
                          size={12}
                          className="source-flow-slot-project__copy-icon"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )}
                  {(isConnected || isAuthenticated || isExpired) && (
                    <button
                      type="button"
                      className="source-flow-slot-logout"
                      title="Đăng xuất khỏi slot này"
                      aria-label={`Đăng xuất Slot ${slot.id + 1}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Xác nhận đăng xuất Slot ${slot.id + 1}?`,
                          )
                        )
                          void action(slot.id, "logout", () =>
                            flowApi.logout(slot.id),
                          );
                      }}
                    >
                      <LogOut size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {}
              <div className="source-flow-slot-user">
                <div className="source-flow-avatar-wrap">
                  {slot.avatar ? (
                    <img
                      src={slot.avatar}
                      alt={slot.displayName || slot.email || "Avatar"}
                      className="source-flow-avatar__img"
                    />
                  ) : (
                    <div className="source-flow-avatar__fallback">
                      {slot.displayName ? (
                        slot.displayName.charAt(0).toUpperCase()
                      ) : slot.email ? (
                        slot.email.charAt(0).toUpperCase()
                      ) : (
                        <User size={20} />
                      )}
                    </div>
                  )}
                  <span
                    className="source-flow-avatar__status-dot"
                    data-status={slot.status}
                    data-connected={isConnected}
                    title={dotLabel}
                  />
                </div>
                <div className="source-flow-user-info">
                  <strong>{statusTitle}</strong>
                  <small title={slot.email || statusSubtitle}>
                    {statusSubtitle}
                  </small>
                </div>
              </div>

              {}
              <div className="source-flow-slot-actions">
                {isConnected && (
                  <>
                    <Button
                      variant="primary"
                      className="source-flow-btn-open"
                      disabled={activeAction?.slotId === slot.id}
                      aria-label={`Mở phiên Slot ${slot.id + 1}`}
                      onClick={() =>
                        void action(slot.id, "switch", () =>
                          flowApi.openSession(slot.id),
                        )
                      }
                    >
                      <RotateCw size={15} />
                      Mở phiên
                    </Button>
                    <Button
                      variant="secondary"
                      className="source-flow-btn-sync"
                      disabled={syncingId === slot.id}
                      onClick={() => void handleSync(slot.id)}
                    >
                      <RefreshCw
                        size={15}
                        className={syncingId === slot.id ? "is-spinning" : ""}
                      />
                      Đồng bộ
                    </Button>
                    {!slot.projectId && (
                      <Button
                        variant="secondary"
                        className="source-flow-btn-create-project"
                        disabled={activeAction?.slotId === slot.id}
                        onClick={() =>
                          void action(slot.id, "create", () =>
                            flowApi.createProject(slot.id),
                          )
                        }
                      >
                        <FolderPlus size={15} />
                        Tạo project
                      </Button>
                    )}
                  </>
                )}

                {isAuthenticated && (
                  <>
                    <Button
                      variant="primary"
                      className="source-flow-btn-open"
                      disabled={activeAction?.slotId === slot.id}
                      aria-label={`Mở phiên Slot ${slot.id + 1}`}
                      onClick={() =>
                        void action(slot.id, "switch", () =>
                          flowApi.openSession(slot.id),
                        )
                      }
                    >
                      <RotateCw size={15} />
                      Mở phiên
                    </Button>
                    <Button
                      variant="secondary"
                      className="source-flow-btn-sync"
                      disabled={syncingId === slot.id}
                      onClick={() => void handleSync(slot.id)}
                    >
                      <RefreshCw
                        size={15}
                        className={syncingId === slot.id ? "is-spinning" : ""}
                      />
                      Đồng bộ
                    </Button>
                  </>
                )}

                {isRestoring && (
                  <Button
                    variant="secondary"
                    className="source-flow-btn-restoring"
                    disabled
                  >
                    <RefreshCw size={15} className="is-spinning" />
                    Đang khôi phục...
                  </Button>
                )}

                {isExpired && (
                  <Button
                    variant="primary"
                    className="source-flow-btn-relogin"
                    disabled={activeAction?.slotId === slot.id}
                    onClick={() =>
                      void action(slot.id, "login", () =>
                        flowApi.login(slot.id),
                      )
                    }
                  >
                    <LogIn size={15} />
                    Đăng nhập lại
                  </Button>
                )}

                {isError && (
                  <>
                    <Button
                      variant="secondary"
                      className="source-flow-btn-sync"
                      disabled={syncingId === slot.id}
                      onClick={() => void handleSync(slot.id)}
                    >
                      <RefreshCw
                        size={15}
                        className={syncingId === slot.id ? "is-spinning" : ""}
                      />
                      Thử lại
                    </Button>
                    <Button
                      variant="primary"
                      className="source-flow-btn-open"
                      disabled={activeAction?.slotId === slot.id}
                      onClick={() =>
                        void action(slot.id, "switch", () =>
                          flowApi.openSession(slot.id),
                        )
                      }
                    >
                      <RotateCw size={15} />
                      Mở phiên
                    </Button>
                  </>
                )}

                {slot.status === "empty" && (
                  <Button
                    variant="primary"
                    className="source-flow-btn-login"
                    disabled={activeAction?.slotId === slot.id}
                    onClick={() =>
                      void action(slot.id, "login", () =>
                        flowApi.login(slot.id),
                      )
                    }
                  >
                    <LogIn size={15} />
                    Đăng nhập
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
