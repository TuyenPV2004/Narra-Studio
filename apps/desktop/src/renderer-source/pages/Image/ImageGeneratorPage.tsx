import {
  Brain,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CircleX,
  Clock4,
  Copy,
  Download,
  Eye,
  ImagePlus,
  ImageUp,
  Inbox,
  Info,
  Layers2,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { formatImageError, imageApi } from "@/services/electron-api/image";
import type { ProviderId } from "@/types/electron-api";

function SquareDimensions({
  size = 16,
  className = "",
  ...props
}: {
  className?: string;
  size?: number | string;
  [key: string]: unknown;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 11V7h4" />
      <path d="M17 13v4h-4" />
    </svg>
  );
}

type TaskStatus = "cancelled" | "error" | "processing" | "queued" | "success";
interface ImageTask {
  aspect?: string | undefined;
  error?: string | undefined;
  id: string;
  mediaId?: string | null | undefined;
  model?: string | undefined;
  prompt: string;
  slotId?: number | undefined;
  src?: string | undefined;
  status: TaskStatus;
}

export function ImageGeneratorPage({ providerId }: { providerId: ProviderId }) {
  const models = useMemo(() => imageApi.getModels(providerId), [providerId]);
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [model, setModel] = useState("NARWHAL");
  const [aspect, setAspect] = useState("IMAGE_ASPECT_RATIO_LANDSCAPE");
  const [quantity, setQuantity] = useState(1);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [running, setRunning] = useState(false);
  const [progressCount, setProgressCount] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewTask, setPreviewTask] = useState<ImageTask | null>(null);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<
    { file: File; id: string; url: string }[]
  >([]);
  const [previewRefImage, setPreviewRefImage] = useState<{
    file: File;
    id: string;
    url: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRequestedRef = useRef(false);

  const successfulTasks = useMemo(
    () => tasks.filter((t) => Boolean(t.src) && t.status === "success"),
    [tasks],
  );

  const previewIndex = previewTask
    ? successfulTasks.findIndex((t) => t.id === previewTask.id)
    : -1;
  const hasPrev = previewIndex > 0;
  const hasNext =
    previewIndex >= 0 && previewIndex < successfulTasks.length - 1;

  const goToPrev = useCallback(() => {
    if (hasPrev) {
      const prev = successfulTasks[previewIndex - 1];
      if (prev) setPreviewTask(prev);
    }
  }, [hasPrev, successfulTasks, previewIndex]);

  const goToNext = useCallback(() => {
    if (hasNext) {
      const next = successfulTasks[previewIndex + 1];
      if (next) setPreviewTask(next);
    }
  }, [hasNext, successfulTasks, previewIndex]);

  useEffect(() => {
    if (!previewTask) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPreviewTask(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewTask, goToPrev, goToNext]);

  const refPreviewIndex = previewRefImage
    ? referencePreviews.findIndex((p) => p.id === previewRefImage.id)
    : -1;
  const hasRefPrev = refPreviewIndex > 0;
  const hasRefNext =
    refPreviewIndex >= 0 && refPreviewIndex < referencePreviews.length - 1;

  const goToRefPrev = useCallback(() => {
    if (hasRefPrev) {
      const prev = referencePreviews[refPreviewIndex - 1];
      if (prev) setPreviewRefImage(prev);
    }
  }, [hasRefPrev, referencePreviews, refPreviewIndex]);

  const goToRefNext = useCallback(() => {
    if (hasRefNext) {
      const next = referencePreviews[refPreviewIndex + 1];
      if (next) setPreviewRefImage(next);
    }
  }, [hasRefNext, referencePreviews, refPreviewIndex]);

  useEffect(() => {
    if (!previewRefImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToRefPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToRefNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPreviewRefImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewRefImage, goToRefPrev, goToRefNext]);

  useEffect(() => {
    const hasProcessing =
      running || tasks.some((t) => t.status === "processing");
    if (!hasProcessing) {
      setTaskProgress(0);
      return;
    }
    setTaskProgress(0);
    const interval = setInterval(() => {
      setTaskProgress((prev) => {
        if (prev >= 95) return prev;
        if (prev < 30) return prev + 6;
        if (prev < 70) return prev + 3;
        return prev + 1;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [running, progressCount?.current, tasks]);

  const displayPercent = useMemo(() => {
    if (progressCount && progressCount.total > 0) {
      const base = ((progressCount.current - 1) / progressCount.total) * 100;
      const slice = (1 / progressCount.total) * 100;
      return Math.min(99, Math.round(base + (taskProgress * slice) / 100));
    }
    return Math.min(99, taskProgress);
  }, [progressCount, taskProgress]);

  useEffect(() => {
    const previews = referenceImages.map((file) => ({
      file,
      id: `${file.name}-${file.size}-${file.lastModified}`,
      url: URL.createObjectURL(file),
    }));
    setReferencePreviews(previews);
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [referenceImages]);

  const handleReferenceImagesSelect = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = event.target.files ? Array.from(event.target.files) : [];
    if (fileList.length === 0) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const validFiles: File[] = [];
    for (const file of fileList) {
      if (!allowedTypes.includes(file.type)) {
        alert(
          `File "${file.name}" không hợp lệ. Chỉ chấp nhận các định dạng: PNG, JPEG, WebP.`,
        );
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert(`File "${file.name}" vượt quá dung lượng tối đa 10MB.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setReferenceImages((prev) => {
        const existingKeys = new Set(
          prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`),
        );
        const filteredNew = validFiles.filter(
          (f) => !existingKeys.has(`${f.name}-${f.size}-${f.lastModified}`),
        );
        return [...prev, ...filteredNew];
      });
    }
    if (event.target) {
      event.target.value = "";
    }
  };

  const removeReferenceImage = (indexToRemove: number) => {
    setReferenceImages((prev) =>
      prev.filter((_, idx) => idx !== indexToRemove),
    );
  };

  const clearAllReferenceImages = () => {
    setReferenceImages([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const copyPrompt = (promptText: string, id: string) => {
    void navigator.clipboard.writeText(promptText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((t) => t.id !== taskId));
  };

  const cancelGeneration = () => {
    cancelRequestedRef.current = true;
    setTasks((current) =>
      current.map((t) =>
        t.status === "queued" ? { ...t, status: "cancelled" } : t,
      ),
    );
    setProgressCount(null);
    setRunning(false);
  };

  const retryTask = async (taskToRetry: ImageTask) => {
    setTasks((current) =>
      current.map((t) =>
        t.id === taskToRetry.id
          ? { ...t, error: undefined, status: "processing" }
          : t,
      ),
    );
    try {
      const taskAspect = taskToRetry.aspect || aspect;
      const taskModel = taskToRetry.model || model;
      const result = await imageApi.generate({
        aspect: taskAspect,
        model: taskModel,
        prompt: taskToRetry.prompt,
        providerId,
        referenceImages:
          referenceImages.length > 0 ? referenceImages : undefined,
        resolution: "2k",
        seed: Math.floor(Math.random() * 9_999_999),
      });
      await imageApi.save(result.src, result.slotId).catch((saveErr) => {
        console.warn("Không thể lưu ảnh local:", saveErr);
      });
      setTasks((current) =>
        current.map((t) =>
          t.id === taskToRetry.id
            ? {
                ...t,
                aspect: taskAspect,
                mediaId: result.mediaId,
                model: taskModel,
                slotId: result.slotId,
                src: result.src,
                status: "success",
              }
            : t,
        ),
      );
    } catch (error) {
      setTasks((current) =>
        current.map((t) =>
          t.id === taskToRetry.id
            ? {
                ...t,
                error: formatImageError(error),
                status: "error",
              }
            : t,
        ),
      );
    }
  };

  const run = useCallback(async () => {
    const usable = prompts.map((prompt) => prompt.trim()).filter(Boolean);
    if (!usable.length || running) return;
    cancelRequestedRef.current = false;
    const currentAspect = aspect;
    const currentModel = model;
    const queued = usable.flatMap((prompt) =>
      Array.from({ length: quantity }, () => ({
        aspect: currentAspect,
        id: crypto.randomUUID(),
        model: currentModel,
        prompt,
        status: "queued" as const,
      })),
    );
    setTasks((current) => [...queued, ...current]);
    setPrompts([""]);
    setRunning(true);
    const totalCount = queued.length;
    let completedCount = 0;

    for (const queuedTask of queued) {
      if (cancelRequestedRef.current) {
        setTasks((current) =>
          current.map((t) =>
            t.id === queuedTask.id && t.status === "queued"
              ? { ...t, status: "cancelled" }
              : t,
          ),
        );
        continue;
      }
      completedCount++;
      setProgressCount({ current: completedCount, total: totalCount });
      setTasks((current) =>
        current.map((task) =>
          task.id === queuedTask.id ? { ...task, status: "processing" } : task,
        ),
      );
      try {
        const taskAspect = queuedTask.aspect || currentAspect;
        const taskModel = queuedTask.model || currentModel;
        const result = await imageApi.generate({
          aspect: taskAspect,
          model: taskModel,
          prompt: queuedTask.prompt,
          providerId,
          referenceImages:
            referenceImages.length > 0 ? referenceImages : undefined,
          resolution: "2k",
          seed: Math.floor(Math.random() * 9_999_999),
        });
        await imageApi.save(result.src, result.slotId).catch((saveErr) => {
          console.warn("Không thể lưu ảnh local:", saveErr);
        });
        setTasks((current) =>
          current.map((task) =>
            task.id === queuedTask.id
              ? {
                  ...task,
                  aspect: taskAspect,
                  mediaId: result.mediaId,
                  model: taskModel,
                  slotId: result.slotId,
                  src: result.src,
                  status: "success",
                }
              : task,
          ),
        );
      } catch (error) {
        setTasks((current) =>
          current.map((task) =>
            task.id === queuedTask.id
              ? {
                  ...task,
                  error: formatImageError(error),
                  status: "error",
                }
              : task,
          ),
        );
      }
    }
    setProgressCount(null);
    setRunning(false);
  }, [aspect, model, prompts, providerId, quantity, referenceImages, running]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void run();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [run]);

  return (
    <section
      className="source-generation-page source-image-page"
      aria-labelledby="image-title"
    >
      <div className="source-generation-controls">
        <header className="source-image-hero">
          <div className="source-image-hero__left">
            <span className="source-image-hero__icon">
              <ImagePlus size={28} aria-hidden="true" />
            </span>
            <div>
              <h1 id="image-title">Hình ảnh</h1>
              <p>Tạo ảnh qua Google Flow và CAPTCHA bridge.</p>
            </div>
          </div>
        </header>
        <section className="source-control-card">
          <div className="source-control-card__heading">
            <h2>
              Prompt{" "}
              <span
                className="source-prompt-required"
                style={{ color: "#ef4444" }}
                aria-hidden="true"
              >
                *
              </span>
            </h2>
            <span>
              {prompts.filter((prompt) => prompt.trim()).length} prompt
            </span>
          </div>
          <div className="source-prompt-list">
            {prompts.map((prompt, index) => (
              <div className="source-prompt-row" key={index}>
                <textarea
                  value={prompt}
                  rows={3}
                  aria-label={`Prompt ${index + 1}`}
                  placeholder="Mô tả hình ảnh cần tạo..."
                  onChange={(event) =>
                    setPrompts((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? event.target.value : value,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="source-prompt-delete-btn"
                  disabled={prompts.length === 1}
                  aria-label={`Xóa prompt ${index + 1}`}
                  onClick={() =>
                    setPrompts((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            className="source-prompt-add-btn"
            onClick={() => setPrompts((current) => [...current, ""])}
          >
            <CirclePlus size={16} />
            Thêm prompt
          </Button>
        </section>
        <section className="source-control-card">
          <div className="source-control-card__heading">
            <h2>
              <ImageUp size={16} aria-hidden="true" />
              Ảnh tham chiếu (Tùy chọn)
            </h2>
            {referenceImages.length > 0 && (
              <span>{referenceImages.length} ảnh</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={handleReferenceImagesSelect}
          />
          {referencePreviews.length > 0 ? (
            <div className="source-reference-list">
              {referencePreviews.map((item, index) => (
                <div key={item.id} className="source-reference-preview-box">
                  <img
                    src={item.url}
                    alt={item.file.name}
                    className="source-reference-thumb"
                    onClick={() => setPreviewRefImage(item)}
                    title="Bấm để xem ảnh phóng to"
                  />
                  <div
                    className="source-reference-info"
                    onClick={() => setPreviewRefImage(item)}
                    style={{ cursor: "pointer" }}
                    title="Bấm để xem ảnh phóng to"
                  >
                    <span className="source-reference-name">
                      {item.file.name}
                    </span>
                    <span className="source-reference-size">
                      {(item.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    type="button"
                    className="source-reference-action-btn"
                    title="Xem ảnh phóng to"
                    aria-label={`Xem ảnh tham chiếu ${item.file.name}`}
                    onClick={() => setPreviewRefImage(item)}
                  >
                    <Eye
                      size={15}
                      className="source-action-icon--view"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    className="source-prompt-delete-btn"
                    aria-label={`Xóa ảnh tham chiếu ${item.file.name}`}
                    onClick={() => removeReferenceImage(index)}
                    title="Xóa ảnh này"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="source-prompt-add-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} aria-hidden="true" />
                Thêm ảnh tham chiếu
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="source-prompt-add-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              Chọn ảnh tham chiếu
            </Button>
          )}
        </section>
        <section className="source-control-card">
          <h2>
            Thiết lập{" "}
            <span
              className="source-prompt-required"
              style={{ color: "#ef4444" }}
              aria-hidden="true"
            >
              *
            </span>
          </h2>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Brain size={16} aria-hidden="true" />
              Model
            </span>
            <Select value={model} onValueChange={(val) => setModel(val)}>
              <SelectTrigger aria-label="Model">
                <SelectValue placeholder="Chọn model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <SquareDimensions size={16} aria-hidden="true" />
              Tỷ lệ
            </span>
            <Select value={aspect} onValueChange={(val) => setAspect(val)}>
              <SelectTrigger aria-label="Tỷ lệ">
                <SelectValue placeholder="Chọn tỷ lệ" />
              </SelectTrigger>
              <SelectContent>
                {[
                  {
                    value: "IMAGE_ASPECT_RATIO_LANDSCAPE",
                    label: "16:9 (Ngang)",
                  },
                  {
                    value: "IMAGE_ASPECT_RATIO_PORTRAIT",
                    label: "9:16 (Dọc)",
                  },
                  {
                    value: "IMAGE_ASPECT_RATIO_SQUARE",
                    label: "1:1 (Vuông)",
                  },
                  {
                    value: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
                    label: "4:3 (Ngang chuẩn)",
                  },
                  {
                    value: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
                    label: "3:4 (Dọc chuẩn)",
                  },
                ].map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Layers2 size={16} aria-hidden="true" />
              Số lượng
            </span>
            <Select
              value={String(quantity)}
              onValueChange={(val) => setQuantity(Number(val))}
            >
              <SelectTrigger aria-label="Số lượng">
                <SelectValue placeholder="Số lượng" />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    x{value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
        <small className="source-generation-hint">
          <Info size={14} aria-hidden="true" />
          Ctrl+Enter để thêm vào hàng đợi
        </small>
        <div className="source-generation-actions-row">
          <Button
            disabled={running || !prompts.some((prompt) => prompt.trim())}
            onClick={() => void run()}
            className="source-generate-main-btn"
          >
            <Sparkles size={17} aria-hidden="true" />
            {running ? `Đang tạo (${displayPercent}%)...` : "Tạo hình ảnh"}
          </Button>
          {running && (
            <Button
              variant="danger"
              className="source-cancel-btn"
              onClick={cancelGeneration}
            >
              Dừng lại
            </Button>
          )}
        </div>
      </div>
      <section
        className="source-generation-results"
        aria-label="Kết quả hình ảnh"
      >
        <header>
          <h2>Hàng đợi và kết quả</h2>
          <span>Số lượng: {tasks.length}</span>
        </header>
        {tasks.length === 0 ? (
          <div className="source-generation-empty">
            <Inbox size={34} aria-hidden="true" />
            <p>Hàng đợi đang trống. Hãy nhập prompt để bắt đầu tạo ảnh.</p>
          </div>
        ) : (
          <div className="source-image-grid">
            {tasks.map((task) => (
              <article
                key={task.id}
                data-status={task.status}
                className="source-image-task-card"
              >
                {task.src ? (
                  <img
                    src={task.src}
                    alt={task.prompt}
                    className="source-image-task-thumb"
                    onClick={() => setPreviewTask(task)}
                    title="Bấm để xem ảnh phóng to"
                  />
                ) : (
                  <div className="source-image-task-placeholder">
                    {task.status === "processing" ? (
                      <div className="source-processing-percent-box">
                        <span className="source-processing-percent-value">
                          {displayPercent}%
                        </span>
                      </div>
                    ) : task.status === "error" ? (
                      <div className="source-error-icon-box">
                        <CircleX
                          size={30}
                          className="source-error-icon"
                          aria-hidden="true"
                        />
                      </div>
                    ) : task.status === "cancelled" ? (
                      <span>🚫 Đã hủy</span>
                    ) : (
                      <div className="source-queued-icon-box">
                        <Clock4
                          size={30}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="source-image-task-content">
                  <header className="source-image-task-header">
                    <div className="source-image-task-badges">
                      <strong
                        className={`source-task-badge source-task-badge--${task.status}`}
                      >
                        {task.status === "queued"
                          ? "Đang chờ"
                          : task.status === "processing"
                            ? "Đang tạo"
                            : task.status === "success"
                              ? "Hoàn tất"
                              : task.status === "cancelled"
                                ? "Đã hủy"
                                : "Có lỗi"}
                      </strong>
                      {task.aspect && (
                        <span className="source-task-aspect-badge">
                          {task.aspect.includes("PORTRAIT_THREE_FOUR") ||
                          task.aspect === "3:4"
                            ? "3:4"
                            : task.aspect.includes("LANDSCAPE_FOUR_THREE") ||
                                task.aspect === "4:3"
                              ? "4:3"
                              : task.aspect.includes("PORTRAIT") ||
                                  task.aspect === "9:16"
                                ? "9:16"
                                : task.aspect.includes("SQUARE") ||
                                    task.aspect === "1:1"
                                  ? "1:1"
                                  : "16:9"}
                        </span>
                      )}
                    </div>
                    {typeof task.slotId === "number" && (
                      <span className="source-task-slot-badge">
                        Slot {task.slotId}
                      </span>
                    )}
                  </header>
                  <p className="source-task-prompt-text">
                    <strong className="source-task-prompt-label">
                      Prompt:{" "}
                    </strong>
                    {task.prompt}
                  </p>
                  {task.error && (
                    <p className="source-task-error-text" role="alert">
                      {task.error}
                    </p>
                  )}
                  <footer className="source-image-task-actions">
                    {task.src && (
                      <>
                        <button
                          type="button"
                          className="source-task-action-btn"
                          onClick={() => setPreviewTask(task)}
                          title="Xem ảnh phóng to"
                        >
                          <Eye
                            size={14}
                            className="source-action-icon--view"
                            aria-hidden="true"
                          />
                          Xem
                        </button>
                        <a
                          href={task.src}
                          download={`narra-${task.id.slice(0, 8)}.png`}
                          className="source-task-action-link"
                        >
                          <Download
                            size={14}
                            className="source-action-icon--download"
                            aria-hidden="true"
                          />
                          Tải về
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      className="source-task-action-btn"
                      onClick={() => copyPrompt(task.prompt, task.id)}
                      title="Sao chép prompt"
                    >
                      <Copy
                        size={14}
                        className="source-action-icon--copy"
                        aria-hidden="true"
                      />
                      {copiedId === task.id ? "Đã copy" : "Copy"}
                    </button>
                    {(task.status === "error" ||
                      task.status === "cancelled") && (
                      <button
                        type="button"
                        className="source-task-action-btn"
                        onClick={() => void retryTask(task)}
                        title="Thử lại"
                      >
                        <RotateCcw
                          size={14}
                          className="source-action-icon--retry"
                          aria-hidden="true"
                        />
                        Thử lại
                      </button>
                    )}
                    <button
                      type="button"
                      className="source-task-action-btn source-task-action-btn--delete"
                      onClick={() => deleteTask(task.id)}
                      title="Xóa tác vụ này"
                    >
                      <Trash2
                        size={14}
                        className="source-action-icon--delete"
                        aria-hidden="true"
                      />
                      Xóa
                    </button>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(previewTask)}
        onOpenChange={(open) => {
          if (!open) setPreviewTask(null);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {previewTask && previewTask.src && (
            <>
              <DialogTitle style={{ display: "none" }}>
                {previewTask.prompt}
              </DialogTitle>
              <DialogDescription style={{ display: "none" }}>
                Xem chi tiết ảnh đã tạo
              </DialogDescription>

              {successfulTasks.length > 1 && previewIndex >= 0 && (
                <div className="source-media-lightbox__counter">
                  {previewIndex + 1} / {successfulTasks.length}
                </div>
              )}

              <button
                type="button"
                className="source-media-lightbox__btn-close"
                title="Đóng (Esc)"
                aria-label="Đóng"
                onClick={() => setPreviewTask(null)}
              >
                <X size={20} />
              </button>

              {hasPrev && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--prev"
                  title="Xem ảnh trước (Phím ←)"
                  aria-label="Xem ảnh trước"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToPrev();
                  }}
                >
                  <ChevronLeft size={28} />
                </button>
              )}

              <div className="source-media-lightbox__stage">
                <img
                  key={previewTask.id}
                  src={previewTask.src}
                  alt={previewTask.prompt}
                  className="source-media-lightbox__img"
                />
              </div>

              {hasNext && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--next"
                  title="Xem ảnh tiếp theo (Phím →)"
                  aria-label="Xem ảnh tiếp theo"
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
        open={Boolean(previewRefImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewRefImage(null);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {previewRefImage && (
            <>
              <DialogTitle style={{ display: "none" }}>
                {previewRefImage.file.name}
              </DialogTitle>
              <DialogDescription style={{ display: "none" }}>
                Xem chi tiết ảnh tham chiếu
              </DialogDescription>

              {referencePreviews.length > 1 && refPreviewIndex >= 0 && (
                <div className="source-media-lightbox__counter">
                  {refPreviewIndex + 1} / {referencePreviews.length}
                </div>
              )}

              <button
                type="button"
                className="source-media-lightbox__btn-close"
                title="Đóng (Esc)"
                aria-label="Đóng"
                onClick={() => setPreviewRefImage(null)}
              >
                <X size={20} />
              </button>

              {hasRefPrev && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--prev"
                  title="Xem ảnh trước (Phím ←)"
                  aria-label="Xem ảnh trước"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToRefPrev();
                  }}
                >
                  <ChevronLeft size={28} />
                </button>
              )}

              <div className="source-media-lightbox__stage">
                <img
                  key={previewRefImage.id}
                  src={previewRefImage.url}
                  alt={previewRefImage.file.name}
                  className="source-media-lightbox__img"
                />
              </div>

              {hasRefNext && (
                <button
                  type="button"
                  className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--next"
                  title="Xem ảnh tiếp theo (Phím →)"
                  aria-label="Xem ảnh tiếp theo"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToRefNext();
                  }}
                >
                  <ChevronRight size={28} />
                </button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
