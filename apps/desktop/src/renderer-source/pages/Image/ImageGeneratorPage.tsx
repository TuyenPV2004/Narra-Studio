import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CircleX,
  Clock4,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
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
  CircleUserRound,
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
import { toast } from "@/components/ui/Toast";
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
import { getElectronApi } from "@/services/electron-api/client";
import {
  MAX_REFERENCE_IMAGES,
  imageApi,
  type ImageModel,
  type ReferenceImageSnapshot,
} from "@/services/electron-api/image";
import {
  useImageQueue,
  type ImageQueueTask,
} from "@/pages/Image/useImageQueue";
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

interface ImageAccountSlot {
  displayName?: string | null;
  email?: string | null;
  id: number;
}

export function ImageGeneratorPage({ providerId }: { providerId: ProviderId }) {
  const queue = useImageQueue();
  const tasks = queue.tasks;
  const running = tasks.some((task) => task.status === "processing");
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [models, setModels] = useState<ImageModel[]>(() =>
    imageApi.getModels(providerId),
  );
  const [model, setModel] = useState("NARWHAL");
  const [aspect, setAspect] = useState("IMAGE_ASPECT_RATIO_LANDSCAPE");
  const [quantity, setQuantity] = useState(1);
  const [accountSlots, setAccountSlots] = useState<ImageAccountSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewTask, setPreviewTask] = useState<ImageQueueTask | null>(null);
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
  const referenceLimit = useMemo(() => {
    const configured = models.find(
      (candidate) => candidate.value === model,
    )?.maxImageInputs;
    return typeof configured === "number" && configured >= 0
      ? Math.min(MAX_REFERENCE_IMAGES, configured)
      : MAX_REFERENCE_IMAGES;
  }, [model, models]);
  const aspectOptions = useMemo(() => {
    const options = [
      {
        value: "IMAGE_ASPECT_RATIO_LANDSCAPE",
        label: "16:9 (Ngang)",
      },
      { value: "IMAGE_ASPECT_RATIO_PORTRAIT", label: "9:16 (Dọc)" },
      { value: "IMAGE_ASPECT_RATIO_SQUARE", label: "1:1 (Vuông)" },
      {
        value: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
        label: "4:3 (Ngang chuẩn)",
      },
      {
        value: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
        label: "3:4 (Dọc chuẩn)",
      },
    ];
    const supported = models.find(
      (candidate) => candidate.value === model,
    )?.supportedAspectRatios;
    if (!supported?.length) return options;
    const filtered = options.filter((option) =>
      supported.includes(option.value),
    );
    return filtered.length > 0 ? filtered : options;
  }, [model, models]);

  useEffect(() => {
    if (!aspectOptions.some((option) => option.value === aspect)) {
      setAspect(aspectOptions[0]?.value || "IMAGE_ASPECT_RATIO_LANDSCAPE");
    }
  }, [aspect, aspectOptions]);

  useEffect(() => {
    let cancelled = false;
    void getElectronApi()
      .getAllSlots()
      .then((value) => {
        if (cancelled || !Array.isArray(value)) return;
        const connected = value.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const slot = item as Record<string, unknown>;
          if (
            typeof slot.id !== "number" ||
            slot.hasBearerToken !== true ||
            typeof slot.projectId !== "string" ||
            !slot.projectId
          )
            return [];
          return [
            {
              id: slot.id,
              email: typeof slot.email === "string" ? slot.email : null,
              displayName:
                typeof slot.displayName === "string" ? slot.displayName : null,
            },
          ];
        });
        setAccountSlots(connected);
        setSelectedSlotId((current) =>
          current !== null && connected.some((slot) => slot.id === current)
            ? current
            : (connected[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAccountSlots([]);
          setSelectedSlotId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (selectedSlotId === null) {
      setModels(imageApi.getModels(providerId));
      return;
    }
    void imageApi.getModelsForSlot(selectedSlotId, providerId).then((next) => {
      if (cancelled) return;
      setModels(next);
      setModel((current) =>
        next.some((candidate) => candidate.value === current)
          ? current
          : (next[0]?.value ?? "NARWHAL"),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [providerId, selectedSlotId]);

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
  }, [running, tasks]);

  const displayBatchPercent = useMemo(() => {
    return Math.min(95, Math.max(5, taskProgress));
  }, [taskProgress]);

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
        const combined = [...prev, ...filteredNew];
        if (combined.length > referenceLimit) {
          alert(`Model này chỉ nhận tối đa ${referenceLimit} ảnh tham chiếu.`);
          return combined.slice(0, referenceLimit);
        }
        return combined;
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

  const copyPrompt = async (promptText: string, id: string) => {
    try {
      try {
        await navigator.clipboard.writeText(promptText);
      } catch {
        await getElectronApi().copyToClipboard(promptText);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  const run = useCallback(() => {
    const usable = prompts.map((prompt) => prompt.trim()).filter(Boolean);
    if (!usable.length || selectedSlotId === null) return;
    const currentAspect = aspect;
    const currentModel = model;
    const currentSnapshots: ReferenceImageSnapshot[] = referenceImages
      .slice(0, referenceLimit)
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        localPath: getElectronApi().getFilePath(file),
        name: file.name,
        size: file.size,
        type: file.type || "image/png",
      }));
    const requests = usable.flatMap((prompt) =>
      Array.from({ length: quantity }, () => ({
        aspect: currentAspect,
        model: currentModel,
        prompt,
        providerId: "veo3" as const,
        referenceImageSnapshots:
          currentSnapshots.length > 0 ? currentSnapshots : undefined,
        resolution: "2k",
        seed: Math.floor(Math.random() * 9_999_999),
        slotId: selectedSlotId,
      })),
    );
    const result = queue.enqueue(requests);
    if (result.accepted === 0) {
      toast.error("Hàng đợi ảnh đã đầy (tối đa 20 tác vụ đang hoạt động).");
      return;
    }
    if (result.rejected > 0) {
      setPrompts(
        requests.slice(result.accepted).map((request) => request.prompt),
      );
      setQuantity(1);
      toast.warning(
        `Đã thêm ${result.accepted} tác vụ. Giữ lại ${result.rejected} prompt do hàng đợi đạt giới hạn.`,
      );
      return;
    }
    setPrompts([""]);
    toast.success(`Đã thêm ${result.accepted} tác vụ vào hàng đợi ảnh.`);
  }, [
    aspect,
    model,
    prompts,
    quantity,
    queue,
    referenceLimit,
    referenceImages,
    selectedSlotId,
  ]);
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
            <h2>Ảnh tham chiếu (Tùy chọn)</h2>
            {referenceImages.length > 0 && (
              <span>
                Chọn {referenceImages.length}/{referenceLimit}
              </span>
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
                  <div className="source-reference-actions">
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
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
              {referenceImages.length < referenceLimit && (
                <Button
                  type="button"
                  variant="secondary"
                  className="source-prompt-add-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={16} aria-hidden="true" />
                  Thêm ảnh tham chiếu
                </Button>
              )}
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
              <CircleUserRound size={16} aria-hidden="true" />
              Tài khoản
            </span>
            <Select
              value={selectedSlotId === null ? "" : String(selectedSlotId)}
              onValueChange={(value) => setSelectedSlotId(Number(value))}
            >
              <SelectTrigger aria-label="Tài khoản">
                <SelectValue placeholder="Chưa có tài khoản khả dụng" />
              </SelectTrigger>
              <SelectContent>
                {accountSlots.map((slot) => (
                  <SelectItem key={slot.id} value={String(slot.id)}>
                    Slot {slot.id + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                {aspectOptions.map((option) => (
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
            disabled={
              tasks.filter(
                (task) =>
                  task.status === "queued" || task.status === "processing",
              ).length >= 20 ||
              selectedSlotId === null ||
              referenceImages.length > referenceLimit ||
              !prompts.some((prompt) => prompt.trim())
            }
            onClick={() => void run()}
            className="source-generate-main-btn"
          >
            <Sparkles size={17} aria-hidden="true" />
            {running
              ? `Đang tạo (~${displayBatchPercent}%)...`
              : "Tạo hình ảnh"}
          </Button>
        </div>
      </div>
      <section
        className="source-generation-results"
        aria-label="Kết quả hình ảnh"
      >
        <header className="source-results-header">
          <div className="source-results-header__title-group">
            <h2>Hàng đợi và kết quả</h2>
            <span className="source-results-count-badge">
              {tasks.length} ảnh
            </span>
          </div>
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
                          ~{Math.min(95, Math.max(5, taskProgress))}%
                        </span>
                        <span className="source-processing-estimate-label">
                          Ước tính tiến độ
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
                      <span
                        className={`source-task-badge source-task-badge--${task.status}`}
                      >
                        {task.status === "queued"
                          ? "Đang chờ"
                          : task.status === "processing"
                            ? "Đang tạo"
                            : task.status === "success"
                              ? "Hoàn tất"
                              : "Thất bại"}
                      </span>
                      {task.status === "success" && (
                        <span
                          className={`source-task-save-badge source-task-save-badge--${task.saveStatus}`}
                          title={
                            task.saveStatus === "failed"
                              ? `Lưu local thất bại: ${task.saveError || "Không thể lưu"}`
                              : task.saveStatus === "saving"
                                ? "Đang lưu vào thư viện local..."
                                : task.saveStatus === "saved"
                                  ? task.savedFileUrl
                                    ? `Đã lưu: ${task.savedFileUrl}`
                                    : "Đã lưu vào Thư viện"
                                  : "Chưa lưu vào local"
                          }
                        >
                          {task.saveStatus === "saving"
                            ? "Đang lưu..."
                            : task.saveStatus === "failed"
                              ? "Chưa lưu local"
                              : task.saveStatus === "saved"
                                ? "Đã lưu thư viện"
                                : "Chưa lưu"}
                        </span>
                      )}
                      {task.referenceImages &&
                        task.referenceImages.length > 0 && (
                          <span
                            className="source-task-ref-badge"
                            title={`Ảnh tham chiếu: ${task.referenceImages
                              .map((r) => r.name)
                              .join(", ")}`}
                          >
                            <ImageUp size={11} aria-hidden="true" />
                            {task.referenceImages.length} ảnh tham chiếu
                          </span>
                        )}
                      {task.aspect && (
                        <span
                          className="source-task-aspect-badge"
                          title={`Tỷ lệ: ${
                            task.aspect.includes("PORTRAIT_THREE_FOUR") ||
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
                                    : "16:9"
                          }`}
                        >
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
                        Slot {task.slotId + 1}
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
                  {task.saveStatus === "failed" && (
                    <div className="source-task-save-failed-box">
                      <span className="source-task-save-failed-text">
                        Ảnh đã tạo nhưng chưa lưu local (
                        {task.saveError || "Lỗi lưu"}).
                      </span>
                      <button
                        type="button"
                        className="source-task-save-retry-btn"
                        onClick={() => void queue.retrySave(task.id)}
                        title="Thử lưu lại vào thư mục local"
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Thử lưu lại
                      </button>
                    </div>
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
                        {task.savedFileUrl && (
                          <button
                            type="button"
                            className="source-task-action-btn"
                            onClick={() => {
                              if (task.savedFileUrl) {
                                void getElectronApi().showInFolder(
                                  task.savedFileUrl,
                                );
                              }
                            }}
                            title={`Ảnh đã lưu trên máy: ${task.savedFileUrl}. Bấm để mở thư mục.`}
                          >
                            <FolderOpen
                              size={14}
                              className="source-action-icon--folder"
                              aria-hidden="true"
                            />
                            Mở thư mục
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="source-task-action-btn"
                      onClick={() => void copyPrompt(task.prompt, task.id)}
                      title="Sao chép prompt"
                    >
                      {copiedId === task.id ? (
                        <Check
                          size={14}
                          className="source-action-icon--check"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy
                          size={14}
                          className="source-action-icon--copy"
                          aria-hidden="true"
                        />
                      )}
                      Copy
                    </button>
                    {task.status === "error" && (
                      <button
                        type="button"
                        className="source-task-action-btn"
                        onClick={() => {
                          if (!queue.retry(task.id)) {
                            toast.error(
                              "Không thể thử lại vì hàng đợi ảnh đã đầy.",
                            );
                          }
                        }}
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
                      onClick={() => {
                        queue.removeTask(task.id);
                        if (task.status === "processing") {
                          toast.info(
                            "Đã ẩn tác vụ khỏi danh sách; generation trên máy chủ vẫn tiếp tục.",
                          );
                        } else if (task.status === "queued") {
                          toast.info("Đã bỏ tác vụ khỏi hàng đợi ảnh.");
                        }
                      }}
                      title={
                        task.status === "processing"
                          ? "Ẩn khỏi danh sách (không hủy generation trên máy chủ)"
                          : task.status === "queued"
                            ? "Bỏ tác vụ khỏi hàng đợi chờ"
                            : "Xóa tác vụ này"
                      }
                    >
                      {task.status === "processing" ? (
                        <EyeOff size={14} aria-hidden="true" />
                      ) : task.status === "queued" ? (
                        <X size={14} aria-hidden="true" />
                      ) : (
                        <Trash2
                          size={14}
                          className="source-action-icon--delete"
                          aria-hidden="true"
                        />
                      )}
                      {task.status === "processing"
                        ? "Ẩn"
                        : task.status === "queued"
                          ? "Bỏ hàng đợi"
                          : "Xóa"}
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
