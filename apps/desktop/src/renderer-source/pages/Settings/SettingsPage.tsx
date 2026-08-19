import {
  Folder,
  FolderOpen,
  Image,
  KeyRound,
  Save,
  Settings,
  Video,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, type TabOption } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { captchaApi, settingsApi } from "@/services/electron-api";
import type { ProviderId } from "@/types/electron-api";

type SettingsTab = "advanced" | "output";

interface SettingsPageProps {
  activeProvider: ProviderId;
}

export function SettingsPage({ activeProvider }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>("output");
  const [videoPath, setVideoPath] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [siteKey, setSiteKey] = useState(
    "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV",
  );
  const [captchaAction, setCaptchaAction] = useState("submit");
  const [busy, setBusy] = useState(false);
  const tabs: readonly TabOption<SettingsTab>[] = [
    {
      value: "output",
      label: "Thư mục lưu",
      icon: <Folder size={16} aria-hidden="true" />,
    },
    ...(activeProvider === "veo3"
      ? [
          {
            value: "advanced" as const,
            label: "Nâng cao",
            icon: <KeyRound size={16} aria-hidden="true" />,
          },
        ]
      : []),
  ];

  useEffect(() => {
    let cancelled = false;
    void settingsApi
      .getOutputPaths()
      .then((paths) => {
        if (!cancelled) {
          setVideoPath(paths.video);
          setImagePath(paths.image);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : String(error);
          toast.error("Không thể tải đường dẫn lưu", { description: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeProvider !== "veo3" && tab === "advanced") setTab("output");
  }, [activeProvider, tab]);

  const changeFolder = async (kind: "image" | "video") => {
    setBusy(true);
    try {
      const path =
        kind === "video"
          ? await settingsApi.changeVideoOutputFolder()
          : await settingsApi.changeImageOutputFolder();
      if (path) {
        if (kind === "video") setVideoPath(path);
        else setImagePath(path);
        toast.success("Đã cập nhật thư mục lưu thành công!", { description: path });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Không thể đổi thư mục lưu", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const saveAuth = async () => {
    if (!authToken.trim()) {
      toast.warning("Vui lòng dán mã xác thực trước khi lưu.");
      return;
    }
    setBusy(true);
    try {
      await settingsApi.setManualAuth(authToken.trim());
      setAuthToken("");
      toast.success("Đã lưu mã xác thực Google thành công!");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Lưu mã xác thực thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const testCaptcha = async () => {
    setBusy(true);
    try {
      const status = await captchaApi.getBridgeStatus();
      const connected =
        typeof status === "object" &&
        status !== null &&
        "connected" in status &&
        (status as Record<string, unknown>).connected === true;
      if (!connected) {
        toast.error("CAPTCHA bridge chưa kết nối", {
          description: "Hãy mở Google Flow và kiểm tra Extension trong Chrome.",
        });
        return;
      }
      toast.success(`Kết nối CAPTCHA hoạt động (${captchaAction || "submit"}).`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Kiểm tra CAPTCHA thất bại", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="source-settings-page" aria-labelledby="settings-title">
      <header className="source-page-heading">
        <div className="source-page-heading__title">
          <Settings size={24} aria-hidden="true" />
          <h1 id="settings-title">Cài đặt</h1>
        </div>
      </header>
      <Tabs
        value={tab}
        options={tabs}
        onChange={setTab}
        ariaLabel="Các mục cài đặt"
      />
      {tab === "output" && (
        <section
          className="source-settings-section"
          aria-labelledby="output-title"
        >
          <header>
            <h2 id="output-title">Thư mục lưu</h2>
            <p>Chọn thư mục dễ tìm cho hình ảnh và video đã tạo.</p>
          </header>
          <div className="source-folder-list">
            <FolderRow
              icon={<Video size={24} aria-hidden="true" />}
              label="Video"
              path={videoPath}
              busy={busy}
              onChange={() => void changeFolder("video")}
              onOpen={() => void settingsApi.openOutputFolder(videoPath)}
            />
            <FolderRow
              icon={<Image size={24} aria-hidden="true" />}
              label="Hình ảnh"
              path={imagePath}
              busy={busy}
              onChange={() => void changeFolder("image")}
              onOpen={() => void settingsApi.openOutputFolder(imagePath)}
            />
          </div>
        </section>
      )}
      {tab === "advanced" && activeProvider === "veo3" && (
        <section
          className="source-settings-section"
          aria-labelledby="advanced-title"
        >
          <header>
            <h2 id="advanced-title">Nâng cao</h2>
            <p>
              Thiết lập xác thực thủ công khi phiên Google Flow cần được cập
              nhật.
            </p>
          </header>
          <div className="source-settings-auth">
            <label htmlFor="manual-auth">Mã xác thực Google</label>
            <div>
              <Input
                id="manual-auth"
                type="password"
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                placeholder="Dán mã xác thực"
                autoComplete="off"
              />
              <Button
                disabled={busy || !authToken.trim()}
                onClick={() => void saveAuth()}
              >
                <Save size={16} aria-hidden="true" />
                Lưu
              </Button>
            </div>
          </div>
          <details className="source-settings-details">
            <summary>Kiểm tra xác minh trình duyệt</summary>
            <div className="source-settings-technical-grid">
              <label htmlFor="captcha-site-key">
                Site key
                <Input
                  id="captcha-site-key"
                  value={siteKey}
                  onChange={(event) => setSiteKey(event.target.value)}
                />
              </label>
              <label htmlFor="captcha-action">
                Action
                <Input
                  id="captcha-action"
                  value={captchaAction}
                  onChange={(event) => setCaptchaAction(event.target.value)}
                />
              </label>
            </div>
            <Button
              variant="secondary"
              disabled={busy || !siteKey.trim()}
              onClick={() => void testCaptcha()}
            >
              Kiểm tra kết nối
            </Button>
          </details>
        </section>
      )}
    </section>
  );
}

interface FolderRowProps {
  busy: boolean;
  icon: ReactNode;
  label: string;
  onChange: () => void;
  onOpen: () => void;
  path: string;
}

function FolderRow({
  busy,
  icon,
  label,
  onChange,
  onOpen,
  path,
}: FolderRowProps) {
  return (
    <article className="source-folder-row">
      <span className="source-folder-row__icon">{icon}</span>
      <div>
        <strong>{label}</strong>
        <code title={path}>{path || "Đang tải..."}</code>
      </div>
      <Button
        variant="secondary"
        className="source-folder-row__btn-change"
        disabled={busy}
        onClick={onChange}
      >
        <FolderOpen size={16} aria-hidden="true" />
        Đổi thư mục
      </Button>
      <Button
        variant="primary"
        className="source-folder-row__btn-open"
        disabled={!path}
        onClick={onOpen}
      >
        <Folder size={16} aria-hidden="true" />
        Mở
      </Button>
    </article>
  );
}
