import {
  Cable,
  Check,
  ChevronDown,
  Clipboard,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { captchaApi } from "@/services/electron-api";
import { useCaptchaSetup } from "@/pages/CaptchaSetup/useCaptchaSetup";

interface Step {
  actions: ReactNode;
  description: string;
  done: boolean;
  id: string;
  instructions: string[];
  title: string;
}

export function CaptchaSetupPage() {
  const { checking, error, refresh, status, verify, verifying } =
    useCaptchaSetup();
  const extensionReady =
    status.extensionConnected && status.extensionCompatible;
  const [expanded, setExpanded] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const openFolder = async () => {
    const result = await captchaApi.openExtensionFolder();
    const ok =
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      (result as Record<string, unknown>).ok === true;
    setFeedback(
      ok ? "Đã mở thư mục Extension." : "Không thể mở thư mục Extension.",
    );
  };
  const copyAddress = async () => {
    await captchaApi.copyChromeExtensionsAddress();
    setFeedback("Đã sao chép chrome://extensions.");
  };
  const runVerify = async () =>
    setFeedback(
      (await verify())
        ? "Kết nối đã được xác minh."
        : "Chưa thể xác minh kết nối.",
    );
  const steps = useMemo<Step[]>(
    () => [
      {
        id: "files",
        done: status.extensionConnected,
        title: "Bước 1/4. Tải Extension về máy",
        description: status.extensionConnected
          ? `Đã nhận diện Extension ${status.extensionVersion || ""}`.trim()
          : "Tải và giải nén Extension Narra trên máy.",
        instructions: [
          "Tải Extension Narra.",
          "Giải nén tệp vào một thư mục dễ tìm.",
        ],
        actions: (
          <>
            <Button onClick={() => void openFolder()}>
              <FolderOpen size={16} />
              Tải Extension
            </Button>
            <Button variant="secondary" onClick={() => void openFolder()}>
              Mở thư mục
            </Button>
          </>
        ),
      },
      {
        id: "extension",
        done: extensionReady,
        title: "Bước 2/4. Cài đặt Extension",
        description: extensionReady
          ? `Extension ${status.extensionVersion || status.requiredExtensionVersion} tương thích.`
          : "Tải Extension dạng unpacked trong Chrome.",
        instructions: [
          "Mở trang quản lý Extension.",
          "Bật Chế độ dành cho nhà phát triển.",
          "Chọn Tải tiện ích đã giải nén và chọn thư mục Extension.",
        ],
        actions: (
          <>
            <Button onClick={() => void copyAddress()}>
              <Clipboard size={16} />
              chrome://extensions
            </Button>
            <Button variant="secondary" onClick={() => void openFolder()}>
              Mở thư mục
            </Button>
          </>
        ),
      },
      {
        id: "flow",
        done: extensionReady && status.labsProjectOpen,
        title: "Bước 3/4. Mở Google Flow",
        description: status.labsProjectOpen
          ? "Đã nhận diện dự án Google Flow."
          : status.labsTabOpen
            ? "Hãy mở một dự án trong Google Flow."
            : "Đăng nhập và giữ dự án Google Flow đang mở.",
        instructions: [
          "Đăng nhập Google Flow.",
          "Mở một dự án.",
          "Giữ tab dự án đang mở khi sử dụng Narra Studio.",
        ],
        actions: (
          <Button onClick={() => void captchaApi.openGoogleFlow()}>
            <ExternalLink size={16} />
            Mở Google Flow
          </Button>
        ),
      },
      {
        id: "verify",
        done: extensionReady && status.labsProjectOpen && status.tokenVerified,
        title: "Bước 4/4. Kiểm tra kết nối",
        description: status.tokenVerified
          ? "Kết nối đã được xác minh."
          : status.tokenError ||
            "Kiểm tra Extension và dự án Flow trước khi tạo nội dung.",
        instructions: ["Nhấn Kiểm tra để xác minh kết nối trình duyệt."],
        actions: (
          <Button
            disabled={!extensionReady || !status.labsProjectOpen || verifying}
            onClick={() => void runVerify()}
          >
            {verifying ? (
              <RefreshCw className="is-spinning" size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            Kiểm tra
          </Button>
        ),
      },
    ],
    [extensionReady, status, verifying],
  );
  const currentStep = status.setupReady
    ? 3
    : Math.max(
        0,
        steps.findIndex((step) => !step.done),
      );
  const completed = steps.filter((step) => step.done).length;
  useEffect(() => {
    setExpanded(currentStep);
  }, [currentStep]);

  return (
    <section className="source-captcha-page" aria-labelledby="captcha-title">
      <header className="source-captcha-hero">
        <span className="source-captcha-hero__icon">
          <Cable size={25} aria-hidden="true" />
        </span>
        <div>
          <h1 id="captcha-title">Kết nối VEO3 với Narra Studio</h1>
          <p>
            Làm theo từng bước bên dưới. Narra Studio sẽ tự nhận diện và chuyển
            bước khi Chrome đã sẵn sàng.
          </p>
        </div>
        <span className="source-captcha-state" data-ready={status.setupReady}>
          {checking ? (
            <RefreshCw className="is-spinning" size={15} />
          ) : status.setupReady ? (
            <Check size={15} />
          ) : (
            <TriangleAlert size={15} />
          )}
          {checking
            ? "Đang kiểm tra"
            : status.setupReady
              ? "Đã kết nối"
              : "Cần thiết lập"}
        </span>
      </header>
      <div className="source-captcha-progress">
        <span>
          {status.setupReady
            ? "Đã hoàn tất"
            : `Bước hiện tại ${currentStep + 1}/4`}
        </span>
        <strong>{Math.round((completed / 4) * 100)}%</strong>
        <i>
          <span style={{ width: `${(completed / 4) * 100}%` }} />
        </i>
      </div>
      {(error || feedback) && (
        <p
          className="source-captcha-feedback"
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          {error || feedback}
        </p>
      )}
      <div className="source-captcha-steps">
        {steps.map((step, index) => (
          <article
            key={step.id}
            className="source-captcha-step"
            data-done={step.done}
            data-current={index === currentStep}
          >
            <button
              type="button"
              className="source-captcha-step__summary"
              aria-expanded={expanded === index}
              aria-controls={`source-captcha-${step.id}`}
              onClick={() => setExpanded(expanded === index ? -1 : index)}
            >
              <span className="source-captcha-step__check">
                {step.done ? <Check size={16} strokeWidth={3} /> : index + 1}
              </span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            {expanded === index && (
              <div
                id={`source-captcha-${step.id}`}
                className="source-captcha-step__panel"
              >
                <ol>
                  {step.instructions.map((instruction, itemIndex) => (
                    <li key={instruction}>
                      <span>{itemIndex + 1}</span>
                      <p>{instruction}</p>
                    </li>
                  ))}
                </ol>
                <div className="source-captcha-step__actions">
                  {step.actions}
                  <Button variant="ghost" onClick={() => void refresh()}>
                    <RefreshCw
                      className={checking ? "is-spinning" : ""}
                      size={15}
                    />
                    Kiểm tra
                  </Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
