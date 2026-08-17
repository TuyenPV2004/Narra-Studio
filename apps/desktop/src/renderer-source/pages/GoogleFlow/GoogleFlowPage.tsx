import { LogIn, LogOut, RefreshCw, RotateCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { flowApi, type FlowSlot } from "@/services/electron-api/flow";

export function GoogleFlowPage() {
  const [slots, setSlots] = useState<FlowSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setSlots(await flowApi.listSlots());
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
      setError(value instanceof Error ? value.message : String(value));
    }
  };
  return (
    <section
      className="source-tool-page source-flow-page"
      aria-labelledby="flow-title"
    >
      <header>
        <div>
          <small>GOOGLE FLOW</small>
          <h1 id="flow-title">
            <Users size={22} />
            Phiên tài khoản
          </h1>
          <p>
            Mỗi slot giữ session riêng; Narra không chia sẻ cookie giữa các tài
            khoản.
          </p>
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
          <article key={slot.id} data-connected={slot.status === "connected"}>
            <header>
              <span>Slot {slot.id + 1}</span>
              <strong>
                {slot.displayName ||
                  slot.email ||
                  (slot.status === "connected"
                    ? "Đã kết nối"
                    : "Chưa đăng nhập")}
              </strong>
            </header>
            <p>
              {slot.projectId
                ? `Project: ${slot.projectId}`
                : slot.hasBearerToken
                  ? "Đã nhận token phiên."
                  : "Chưa có project/token."}
            </p>
            <div>
              {slot.status === "connected" ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void action(() => flowApi.switchSlot(slot.id))
                    }
                  >
                    <RotateCw size={15} />
                    Mở phiên
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void action(() => flowApi.sync(slot.id))}
                  >
                    <RefreshCw size={15} />
                    Đồng bộ
                  </Button>
                  {!slot.projectId && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void action(async () => {
                          await flowApi.switchSlot(slot.id);
                          return flowApi.createProject();
                        })
                      }
                    >
                      Tạo project
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => void action(() => flowApi.logout(slot.id))}
                  >
                    <LogOut size={15} />
                    Đăng xuất
                  </Button>
                </>
              ) : (
                <Button
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
