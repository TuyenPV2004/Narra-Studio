import { Check, Copy, FolderPlus, LogIn, LogOut, RefreshCw, RotateCw, User, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { flowApi, type FlowSlot } from "@/services/electron-api/flow";

export function GoogleFlowPage() {
  const [slots, setSlots] = useState<FlowSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextSlots] = await Promise.all([
        flowApi.listSlots(),
        new Promise((resolve) => setTimeout(resolve, 450)),
      ]);
      setSlots(nextSlots);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return flowApi.subscribeSlotsChanged(() => void load());
  }, [load]);

  const action = async (operation: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await operation();
      await load();
    } catch (value) {
      const msg = value instanceof Error ? value.message : String(value);
      setError(msg);
      toast.error("Thao tác thất bại", { description: msg });
    }
  };

  const handleSync = async (slotId: number) => {
    setSyncingId(slotId);
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
    }
  };

  const copyProjectId = async (projectId: string) => {
    try {
      await navigator.clipboard.writeText(projectId);
      setCopiedId(projectId);
      toast.success("Đã sao chép Project ID vào bộ nhớ tạm!");
      setTimeout(() => setCopiedId(null), 2000);
    } catch (_) {}
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
              Mỗi slot giữ session riêng; Narra không chia sẻ cookie giữa các tài
              khoản.
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
        {slots.map((slot) => (
          <article
            key={slot.id}
            className="source-flow-slot-card"
            data-connected={slot.status === "connected"}
          >
            {/* Top row: Slot Badge on Left, Project ID & Logout on Right */}
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
                    aria-label="Sao chép Project ID"
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
                {slot.status === "connected" && (
                  <button
                    type="button"
                    className="source-flow-slot-logout"
                    title="Đăng xuất khỏi slot này"
                    aria-label="Đăng xuất"
                    onClick={() => void action(() => flowApi.logout(slot.id))}
                  >
                    <LogOut size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {/* Profile row: Round Avatar + Status Dot + Name/Email */}
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
                  data-connected={slot.status === "connected"}
                  title={
                    slot.status === "connected" ? "Đã kết nối" : "Chưa kết nối"
                  }
                />
              </div>
              <div className="source-flow-user-info">
                <strong>
                  {slot.displayName ||
                    (slot.email
                      ? slot.email.split("@")[0]
                      : slot.status === "connected"
                        ? "Tài khoản Google"
                        : "Chưa đăng nhập")}
                </strong>
                {slot.email ? (
                  <small title={slot.email}>{slot.email}</small>
                ) : slot.status === "connected" ? (
                  <small>Đã kết nối phiên Google</small>
                ) : (
                  <small>Nhấn Đăng nhập để kết nối</small>
                )}
              </div>
            </div>

            {/* Actions row */}
            <div className="source-flow-slot-actions">
              {slot.status === "connected" ? (
                <>
                  <Button
                    variant="primary"
                    className="source-flow-btn-open"
                    onClick={() =>
                      void action(() => flowApi.switchSlot(slot.id))
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
                      onClick={() =>
                        void action(async () => {
                          await flowApi.switchSlot(slot.id);
                          return flowApi.createProject();
                        })
                      }
                    >
                      <FolderPlus size={15} />
                      Tạo project
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  variant="primary"
                  className="source-flow-btn-login"
                  onClick={() => void action(() => flowApi.login(slot.id))}
                >
                  <LogIn size={15} />
                  Đăng nhập
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
