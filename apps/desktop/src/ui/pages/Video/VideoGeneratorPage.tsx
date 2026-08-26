import {
  Brain,
  BroomSparkles,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CircleUserRound,
  CircleX,
  Clapperboard,
  Clock,
  Clock4,
  Copy,
  Crop,
  Eye,
  EyeOff,
  Film,
  FolderOpen,
  ImagePlus,
  Inbox,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Sparkles,
  Trash2,
  Tv,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getElectronApi } from "@/services/electron-api/client";
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
import { toast } from "@/components/ui/Toast";
import {
  videoApi,
  type VideoGenerationRequest,
  DEFAULT_VIDEO_MODELS,
  getVideoModelsForMode,
  type VideoMode,
  type VideoModel,
} from "@/services/electron-api/video";
import {
  useVideoQueue,
  type VideoQueueTask,
} from "@/pages/Video/useVideoQueue";
import type { ProviderId } from "@/types/electron-api";

const defaultFlowModel = DEFAULT_VIDEO_MODELS[0]!;

interface VideoAccountSlot {
  displayName?: string | null;
  email?: string | null;
  id: number;
}

export function VideoGeneratorPage({ providerId }: { providerId: ProviderId }) {
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [mode, setMode] = useState<VideoMode>("text");
  const models = useMemo(() => getVideoModelsForMode(mode), [mode]);
  const [modelId, setModelId] = useState(defaultFlowModel.id);
  const [duration, setDuration] = useState(8);
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [accountSlots, setAccountSlots] = useState<VideoAccountSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [startImage, setStartImage] = useState<File>();
  const [endImage, setEndImage] = useState<File>();
  const [editVideo, setEditVideo] = useState<File>();
  const [editVideoThumb, setEditVideoThumb] = useState<string | null>(null);
  const [previewInputVideo, setPreviewInputVideo] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
    items?: { url: string; title: string }[] | undefined;
    index?: number | undefined;
  } | null>(null);
  const [characterImages, setCharacterImages] = useState<File[]>([]);
  const [postAction, setPostAction] = useState<string>();

  const startImageRef = useRef<HTMLInputElement>(null);
  const endImageRef = useRef<HTMLInputElement>(null);
  const characterImagesRef = useRef<HTMLInputElement>(null);
  const replaceCharImageRef = useRef<HTMLInputElement>(null);
  const replaceCharIndex = useRef<number | null>(null);
  const editVideoRef = useRef<HTMLInputElement>(null);

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

  const startImagePreview = useMemo(
    () => (startImage ? URL.createObjectURL(startImage) : null),
    [startImage],
  );
  const endImagePreview = useMemo(
    () => (endImage ? URL.createObjectURL(endImage) : null),
    [endImage],
  );
  const editVideoUrl = useMemo(() => {
    if (!editVideo) return null;
    if (typeof (editVideo as unknown as { url?: string }).url === "string") {
      return (editVideo as unknown as { url: string }).url;
    }
    if (editVideo instanceof Blob) {
      return URL.createObjectURL(editVideo);
    }
    return null;
  }, [editVideo]);
  const characterPreviews = useMemo(
    () =>
      characterImages.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [characterImages],
  );

  useEffect(() => {
    return () => {
      if (startImagePreview) URL.revokeObjectURL(startImagePreview);
    };
  }, [startImagePreview]);

  useEffect(() => {
    return () => {
      if (endImagePreview) URL.revokeObjectURL(endImagePreview);
    };
  }, [endImagePreview]);

  useEffect(() => {
    return () => {
      if (editVideoUrl && editVideoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(editVideoUrl);
      }
    };
  }, [editVideoUrl]);

  useEffect(() => {
    return () => {
      characterPreviews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [characterPreviews]);

  // Extract real video thumbnail when editVideo changes
  useEffect(() => {
    if (!editVideo) {
      setEditVideoThumb(null);
      return;
    }
    let isCancelled = false;
    const isBlob = editVideo instanceof Blob;
    const url =
      typeof (editVideo as unknown as { url?: string }).url === "string"
        ? (editVideo as unknown as { url: string }).url
        : isBlob
          ? URL.createObjectURL(editVideo)
          : "";
    if (!url) return;
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const captureFrame = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          if (!isCancelled) {
            setEditVideoThumb(dataUrl);
          }
        }
      } catch {
        // Fallback handled by video tag
      } finally {
        if (isBlob && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = captureFrame;
    video.onerror = () => {
      if (isBlob && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };

    return () => {
      isCancelled = true;
      if (isBlob && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };
  }, [editVideo]);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === modelId) || models[0],
    [modelId, models],
  );

  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) {
      setModelId(models[0]?.id || "abra_t2v");
    }
  }, [models, modelId]);

  useEffect(() => {
    if (
      selectedModel &&
      Array.isArray(selectedModel.durations) &&
      selectedModel.durations.length > 0 &&
      !selectedModel.durations.includes(duration)
    ) {
      setDuration(selectedModel.durations[0]!);
    }
  }, [selectedModel, duration]);

  const queue = useVideoQueue();
  const running = queue.tasks.some((task) => task.status === "processing");
  const [previewTask, setPreviewTask] = useState<VideoQueueTask | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const successfulTasks = useMemo(
    () =>
      queue.tasks.filter(
        (t) => t.status === "success" && (t.localPath || t.src),
      ),
    [queue.tasks],
  );
  const activePreviewTask = useMemo(() => {
    if (!previewTask) return null;
    return queue.tasks.find((t) => t.id === previewTask.id) || previewTask;
  }, [previewTask, queue.tasks]);
  const previewIndex = activePreviewTask
    ? successfulTasks.findIndex((t) => t.id === activePreviewTask.id)
    : -1;
  const hasPrev = previewIndex > 0;
  const hasNext =
    previewIndex >= 0 && previewIndex < successfulTasks.length - 1;
  const goToPrev = useCallback(() => {
    if (hasPrev) setPreviewTask(successfulTasks[previewIndex - 1] || null);
  }, [hasPrev, previewIndex, successfulTasks]);
  const goToNext = useCallback(() => {
    if (hasNext) setPreviewTask(successfulTasks[previewIndex + 1] || null);
  }, [hasNext, previewIndex, successfulTasks]);

  useEffect(() => {
    if (!previewTask) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goToPrev();
      else if (e.key === "ArrowRight") goToNext();
      else if (e.key === "Escape") setPreviewTask(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNext, goToPrev, previewTask]);

  useEffect(() => {
    if (!previewImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPreviewImage(null);
      } else if (
        e.key === "ArrowLeft" &&
        previewImage.items &&
        previewImage.index !== undefined &&
        previewImage.index > 0
      ) {
        e.preventDefault();
        const prevIdx = previewImage.index - 1;
        const prevItem = previewImage.items[prevIdx];
        if (prevItem) {
          setPreviewImage({
            ...prevItem,
            items: previewImage.items,
            index: prevIdx,
          });
        }
      } else if (
        e.key === "ArrowRight" &&
        previewImage.items &&
        previewImage.index !== undefined &&
        previewImage.index < previewImage.items.length - 1
      ) {
        e.preventDefault();
        const nextIdx = previewImage.index + 1;
        const nextItem = previewImage.items[nextIdx];
        if (nextItem) {
          setPreviewImage({
            ...nextItem,
            items: previewImage.items,
            index: nextIdx,
          });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage]);

  useEffect(() => {
    setDuration(selectedModel?.durations[0] || 8);
  }, [selectedModel]);

  const requestFor = useCallback(
    (value: string): VideoGenerationRequest | null =>
      selectedModel
        ? {
            aspect,
            duration,
            mode,
            model: selectedModel.id,
            prompt: value,
            providerId,
            resolution: selectedModel.resolutions[0] || "720p",
            ...(selectedSlotId !== null ? { slotId: selectedSlotId } : {}),
            ...(mode === "image" || mode === "startend"
              ? startImage
                ? { startImage }
                : {}
              : {}),
            ...(mode === "startend" ? (endImage ? { endImage } : {}) : {}),
            ...(mode === "editvideo" ? (editVideo ? { editVideo } : {}) : {}),
            ...(mode === "charsync"
              ? characterImages.length
                ? { characterImages }
                : {}
              : {}),
          }
        : null,
    [
      aspect,
      characterImages,
      duration,
      editVideo,
      endImage,
      mode,
      providerId,
      selectedModel,
      selectedSlotId,
      startImage,
    ],
  );
  const generate = useCallback(() => {
    if (
      (mode === "image" && !startImage) ||
      (mode === "startend" && (!startImage || !endImage)) ||
      (mode === "editvideo" && !editVideo) ||
      (mode === "charsync" && !characterImages.length)
    )
      return;

    const nonBlankEntries = prompts
      .map((text, idx) => ({ text: text.trim(), idx }))
      .filter((item) => item.text.length > 0);

    if (!nonBlankEntries.length) return;

    const requestsWithIndices = nonBlankEntries
      .map((item) => ({ request: requestFor(item.text), idx: item.idx }))
      .filter(
        (entry): entry is { request: VideoGenerationRequest; idx: number } =>
          Boolean(entry.request?.prompt),
      );

    if (!requestsWithIndices.length) return;

    const result = queue.enqueue(requestsWithIndices.map((e) => e.request));

    if (result.accepted === 0) {
      toast.error(
        "Hàng đợi đã đầy (tối đa 20 tác vụ). Vui lòng đợi các tác vụ hoàn thành.",
      );
      return;
    }

    if (result.rejected > 0) {
      toast.warning(
        `Đã thêm ${result.accepted} tác vụ vào hàng đợi. Giữ lại ${result.rejected} prompt do hàng đợi đạt giới hạn (20 tác vụ).`,
      );
      const acceptedIndices = new Set(
        requestsWithIndices.slice(0, result.accepted).map((e) => e.idx),
      );
      const remainingPrompts = prompts.filter(
        (_, idx) => !acceptedIndices.has(idx),
      );
      setPrompts(remainingPrompts.length > 0 ? remainingPrompts : [""]);
    } else {
      toast.success(
        result.accepted > 1
          ? `Đã thêm ${result.accepted} tác vụ vào hàng đợi.`
          : "Đã thêm tác vụ vào hàng đợi.",
      );
      setPrompts([""]);
    }
  }, [
    characterImages.length,
    editVideo,
    endImage,
    mode,
    prompts,
    queue.enqueue,
    requestFor,
    startImage,
  ]);

  const handleRetryTask = useCallback(
    (task: VideoQueueTask) => {
      if (task.request) {
        if (!queue.retry(task.id, task.request)) {
          toast.error(
            "Hàng đợi đã đầy (tối đa 20 tác vụ). Vui lòng thử lại sau.",
          );
          return;
        }
        toast.success("Đã đưa tác vụ vào hàng đợi thử lại.");
        return;
      }

      const taskMode = (task.mode as VideoMode) || "text";
      if (taskMode === "text") {
        const retryRequest: VideoGenerationRequest = {
          prompt: task.prompt,
          mode: "text",
          model: task.model || defaultFlowModel.id,
          duration: task.duration || 8,
          aspect: task.aspect || "landscape",
          resolution: task.resolution || "720p",
          providerId: task.providerId || providerId,
          ...(typeof task.slotId === "number" ? { slotId: task.slotId } : {}),
        };
        if (!queue.retry(task.id, retryRequest)) {
          toast.error(
            "Hàng đợi đã đầy (tối đa 20 tác vụ). Vui lòng thử lại sau.",
          );
          return;
        }
        toast.success("Đã đưa tác vụ văn bản vào hàng đợi thử lại.");
        return;
      }

      // For file-dependent modes restored from storage history:
      setMode(taskMode);
      if (task.model) setModelId(task.model);
      if (task.duration) setDuration(task.duration);
      if (task.aspect) setAspect(task.aspect);
      if (typeof task.slotId === "number") setSelectedSlotId(task.slotId);
      setPrompts([task.prompt]);

      const modeLabels: Record<VideoMode, string> = {
        text: "Văn bản",
        image: "Ảnh đầu",
        startend: "Ảnh đầu + cuối",
        charsync: "Character Sync",
        editvideo: "Edit video",
      };
      toast.info(
        `Đã nạp lại cấu hình chế độ "${modeLabels[taskMode] || taskMode}". Vui lòng chọn lại file đầu vào trong form để tạo lại.`,
      );
    },
    [defaultFlowModel.id, providerId, queue],
  );

  const handlePickEditVideo = useCallback(async () => {
    try {
      const res = await getElectronApi().selectVideoFiles();
      if (res) {
        const urlStr = Array.isArray(res) ? res[0] : res;
        if (typeof urlStr === "string" && urlStr.trim()) {
          const rawName = urlStr.split(/[/\\]/).pop() || "video.mp4";
          const cleanName = decodeURIComponent(rawName);
          setEditVideo({
            name: cleanName,
            size: 0,
            path: urlStr,
            url: urlStr,
          } as unknown as File);
          return;
        }
      }
    } catch (err) {
      console.warn("[VIDEO] Native video picker fallback to input:", err);
    }
    editVideoRef.current?.click();
  }, []);

  const runPostAction = useCallback(
    async (
      taskId: string,
      mediaId: string,
      action: "gif" | "1080p" | "4k",
      taskAspect: "landscape" | "portrait",
      slotId = 0,
    ) => {
      const actionId = `${taskId}:${action}`;
      setPostAction(actionId);
      queue.updateTask(taskId, { postError: undefined });
      try {
        if (action === "gif") await videoApi.createGif(mediaId, slotId);
        else {
          const src = await videoApi.upscale(
            mediaId,
            action,
            taskAspect,
            slotId,
          );
          queue.updateTask(taskId, {
            resolution: action === "1080p" ? "1080p" : "4k",
            src,
          });
        }
      } catch (error) {
        queue.updateTask(taskId, {
          postError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPostAction(undefined);
      }
    },
    [queue.updateTask],
  );

  return (
    <section
      className="source-generation-page source-video-page"
      aria-labelledby="video-title"
    >
      <div className="source-generation-controls">
        <header className="source-video-hero">
          <div className="source-video-hero__left">
            <span className="source-video-hero__icon">
              <Clapperboard size={28} aria-hidden="true" />
            </span>
            <div>
              <h1 id="video-title">Tạo video</h1>
              <p>Google Flow video qua tài khoản được chọn bên dưới.</p>
            </div>
          </div>
        </header>
        <section className="source-control-card">
          <h2>
            Chế độ{" "}
            <span
              className="source-prompt-required"
              style={{ color: "#ef4444" }}
              aria-hidden="true"
            >
              *
            </span>
          </h2>
          <div className="source-segmented">
            {(
              ["text", "image", "startend", "charsync", "editvideo"] as const
            ).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "text"
                  ? "Văn bản"
                  : value === "image"
                    ? "Ảnh đầu"
                    : value === "startend"
                      ? "Ảnh đầu + cuối"
                      : value === "charsync"
                        ? "Character Sync"
                        : "Edit video"}
              </button>
            ))}
          </div>
          {mode === "image" && (
            <div>
              <input
                ref={startImageRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void getElectronApi().authorizeFilePath(file);
                    setStartImage(file);
                  }
                  event.target.value = "";
                }}
              />
              {!startImage ? (
                <button
                  type="button"
                  className="source-media-dropzone"
                  onClick={() => startImageRef.current?.click()}
                >
                  <div className="source-media-dropzone__icon">
                    <ImagePlus size={22} />
                  </div>
                  <div className="source-media-dropzone__text">
                    <span className="source-media-dropzone__title">
                      Tải lên ảnh đầu (Start frame)
                    </span>
                    <span className="source-media-dropzone__hint">
                      PNG, JPG, WebP · Bấm để chọn ảnh
                    </span>
                  </div>
                </button>
              ) : (
                <div
                  className="source-reference-preview-box"
                  style={{ marginTop: "var(--space-3)" }}
                >
                  {startImagePreview && (
                    <img
                      src={startImagePreview}
                      alt={startImage.name}
                      className="source-reference-thumb"
                      style={{ cursor: "pointer" }}
                      title="Bấm để xem ảnh phóng to"
                      onClick={() =>
                        setPreviewImage({
                          url: startImagePreview,
                          title: startImage.name,
                        })
                      }
                    />
                  )}
                  <div
                    className="source-reference-info"
                    style={{ cursor: "pointer" }}
                    title="Bấm để xem ảnh phóng to"
                    onClick={() =>
                      startImagePreview &&
                      setPreviewImage({
                        url: startImagePreview,
                        title: startImage.name,
                      })
                    }
                  >
                    <span
                      className="source-reference-name"
                      title={startImage.name}
                    >
                      {startImage.name}
                    </span>
                    <span className="source-reference-size">
                      {(startImage.size / 1024).toFixed(0)} KB · Ảnh bắt đầu
                    </span>
                  </div>
                  <div className="source-reference-actions">
                    <button
                      type="button"
                      className="source-reference-action-btn"
                      title="Xem ảnh phóng to"
                      aria-label={`Xem ảnh ${startImage.name}`}
                      onClick={() =>
                        startImagePreview &&
                        setPreviewImage({
                          url: startImagePreview,
                          title: startImage.name,
                        })
                      }
                    >
                      <Eye
                        size={15}
                        className="source-action-icon--view"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="source-reference-action-btn"
                      title="Đổi ảnh khác"
                      onClick={() => startImageRef.current?.click()}
                    >
                      <Repeat2
                        size={15}
                        className="source-action-icon--repeat"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="source-prompt-delete-btn"
                      title="Xóa ảnh này"
                      onClick={() => setStartImage(undefined)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "startend" && (
            <div>
              <input
                ref={startImageRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void getElectronApi().authorizeFilePath(file);
                    setStartImage(file);
                  }
                  event.target.value = "";
                }}
              />
              <input
                ref={endImageRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void getElectronApi().authorizeFilePath(file);
                    setEndImage(file);
                  }
                  event.target.value = "";
                }}
              />
              <div className="source-video-startend-vertical">
                <div className="source-video-startend-item">
                  {!startImage ? (
                    <button
                      type="button"
                      className="source-media-dropzone"
                      style={{ marginTop: 0 }}
                      onClick={() => startImageRef.current?.click()}
                    >
                      <div className="source-media-dropzone__icon">
                        <ImagePlus size={22} />
                      </div>
                      <div className="source-media-dropzone__text">
                        <span className="source-media-dropzone__title">
                          Tải lên ảnh đầu (Start frame)
                        </span>
                        <span className="source-media-dropzone__hint">
                          PNG, JPG, WebP · Bấm để chọn ảnh
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="source-reference-preview-box">
                      {startImagePreview && (
                        <img
                          src={startImagePreview}
                          alt={startImage.name}
                          className="source-reference-thumb"
                          style={{ cursor: "pointer" }}
                          title="Bấm để xem ảnh phóng to"
                          onClick={() =>
                            setPreviewImage({
                              url: startImagePreview,
                              title: startImage.name,
                            })
                          }
                        />
                      )}
                      <div
                        className="source-reference-info"
                        style={{ cursor: "pointer" }}
                        title="Bấm để xem ảnh phóng to"
                        onClick={() =>
                          startImagePreview &&
                          setPreviewImage({
                            url: startImagePreview,
                            title: startImage.name,
                          })
                        }
                      >
                        <span
                          className="source-reference-name"
                          title={startImage.name}
                        >
                          {startImage.name}
                        </span>
                        <span className="source-reference-size">
                          {(startImage.size / 1024).toFixed(0)} KB · Ảnh bắt đầu
                        </span>
                      </div>
                      <div className="source-reference-actions">
                        <button
                          type="button"
                          className="source-reference-action-btn"
                          title="Xem ảnh phóng to"
                          aria-label={`Xem ảnh ${startImage.name}`}
                          onClick={() =>
                            startImagePreview &&
                            setPreviewImage({
                              url: startImagePreview,
                              title: startImage.name,
                            })
                          }
                        >
                          <Eye
                            size={15}
                            className="source-action-icon--view"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className="source-reference-action-btn"
                          title="Đổi ảnh khác"
                          onClick={() => startImageRef.current?.click()}
                        >
                          <Repeat2
                            size={15}
                            className="source-action-icon--repeat"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className="source-prompt-delete-btn"
                          title="Xóa ảnh này"
                          onClick={() => setStartImage(undefined)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="source-startend-plus-divider"
                  title="Kết hợp ảnh đầu và ảnh cuối"
                >
                  <Plus size={20} aria-hidden="true" />
                </div>

                <div className="source-video-startend-item">
                  {!endImage ? (
                    <button
                      type="button"
                      className="source-media-dropzone"
                      style={{ marginTop: 0 }}
                      onClick={() => endImageRef.current?.click()}
                    >
                      <div className="source-media-dropzone__icon">
                        <ImagePlus size={22} />
                      </div>
                      <div className="source-media-dropzone__text">
                        <span className="source-media-dropzone__title">
                          Tải lên ảnh cuối (End frame)
                        </span>
                        <span className="source-media-dropzone__hint">
                          PNG, JPG, WebP · Bấm để chọn ảnh
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="source-reference-preview-box">
                      {endImagePreview && (
                        <img
                          src={endImagePreview}
                          alt={endImage.name}
                          className="source-reference-thumb"
                          style={{ cursor: "pointer" }}
                          title="Bấm để xem ảnh phóng to"
                          onClick={() =>
                            setPreviewImage({
                              url: endImagePreview,
                              title: endImage.name,
                            })
                          }
                        />
                      )}
                      <div
                        className="source-reference-info"
                        style={{ cursor: "pointer" }}
                        title="Bấm để xem ảnh phóng to"
                        onClick={() =>
                          endImagePreview &&
                          setPreviewImage({
                            url: endImagePreview,
                            title: endImage.name,
                          })
                        }
                      >
                        <span
                          className="source-reference-name"
                          title={endImage.name}
                        >
                          {endImage.name}
                        </span>
                        <span className="source-reference-size">
                          {(endImage.size / 1024).toFixed(0)} KB · Ảnh kết thúc
                        </span>
                      </div>
                      <div className="source-reference-actions">
                        <button
                          type="button"
                          className="source-reference-action-btn"
                          title="Xem ảnh phóng to"
                          aria-label={`Xem ảnh ${endImage.name}`}
                          onClick={() =>
                            endImagePreview &&
                            setPreviewImage({
                              url: endImagePreview,
                              title: endImage.name,
                            })
                          }
                        >
                          <Eye
                            size={15}
                            className="source-action-icon--view"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className="source-reference-action-btn"
                          title="Đổi ảnh khác"
                          onClick={() => endImageRef.current?.click()}
                        >
                          <Repeat2
                            size={15}
                            className="source-action-icon--repeat"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className="source-prompt-delete-btn"
                          title="Xóa ảnh này"
                          onClick={() => setEndImage(undefined)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {mode === "charsync" && (
            <div>
              <input
                ref={characterImagesRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  if (files.length) {
                    files.forEach(
                      (f) => void getElectronApi().authorizeFilePath(f),
                    );
                    setCharacterImages((current) => {
                      const remaining = 5 - current.length;
                      if (remaining <= 0) return current;
                      return [...current, ...files.slice(0, remaining)];
                    });
                  }
                  event.target.value = "";
                }}
              />
              <input
                ref={replaceCharImageRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && replaceCharIndex.current !== null) {
                    void getElectronApi().authorizeFilePath(file);
                    const idx = replaceCharIndex.current;
                    setCharacterImages((curr) =>
                      curr.map((item, i) => (i === idx ? file : item)),
                    );
                  }
                  event.target.value = "";
                }}
              />
              {characterImages.length === 0 ? (
                <button
                  type="button"
                  className="source-media-dropzone"
                  onClick={() => characterImagesRef.current?.click()}
                >
                  <div className="source-media-dropzone__icon">
                    <ImagePlus size={22} />
                  </div>
                  <div className="source-media-dropzone__text">
                    <span className="source-media-dropzone__title">
                      Tải lên ảnh nhân vật tham chiếu
                    </span>
                    <span className="source-media-dropzone__hint">
                      Chọn 1 đến 5 ảnh nhân vật (tối đa 5 ảnh) · Bấm để chọn
                      file
                    </span>
                  </div>
                </button>
              ) : (
                <div
                  style={{
                    marginTop: "var(--space-3)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                  }}
                >
                  <div className="source-reference-list">
                    {characterPreviews.map((item, index) => {
                      const charList = characterPreviews.map((p) => ({
                        url: p.url,
                        title: p.file.name,
                      }));
                      return (
                        <div
                          key={index}
                          className="source-reference-preview-box"
                        >
                          <img
                            src={item.url}
                            alt={item.file.name}
                            className="source-reference-thumb"
                            style={{ cursor: "pointer" }}
                            title="Bấm để xem ảnh phóng to"
                            onClick={() =>
                              setPreviewImage({
                                url: item.url,
                                title: item.file.name,
                                items: charList,
                                index,
                              })
                            }
                          />
                          <div
                            className="source-reference-info"
                            style={{ cursor: "pointer" }}
                            title="Bấm để xem ảnh phóng to"
                            onClick={() =>
                              setPreviewImage({
                                url: item.url,
                                title: item.file.name,
                                items: charList,
                                index,
                              })
                            }
                          >
                            <span
                              className="source-reference-name"
                              title={item.file.name}
                            >
                              {item.file.name}
                            </span>
                            <span className="source-reference-size">
                              {(item.file.size / 1024).toFixed(0)} KB · Nhân vật{" "}
                              {index + 1}
                            </span>
                          </div>
                          <div className="source-reference-actions">
                            <button
                              type="button"
                              className="source-reference-action-btn"
                              title="Xem ảnh phóng to"
                              aria-label={`Xem ảnh ${item.file.name}`}
                              onClick={() =>
                                setPreviewImage({
                                  url: item.url,
                                  title: item.file.name,
                                  items: charList,
                                  index,
                                })
                              }
                            >
                              <Eye
                                size={15}
                                className="source-action-icon--view"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              className="source-reference-action-btn"
                              title="Đổi ảnh khác"
                              onClick={() => {
                                replaceCharIndex.current = index;
                                replaceCharImageRef.current?.click();
                              }}
                            >
                              <Repeat2
                                size={15}
                                className="source-action-icon--repeat"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              className="source-prompt-delete-btn"
                              title="Xóa ảnh này"
                              onClick={() =>
                                setCharacterImages((curr) =>
                                  curr.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {characterImages.length < 5 && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="source-prompt-add-btn"
                      onClick={() => characterImagesRef.current?.click()}
                    >
                      <Upload size={16} aria-hidden="true" />
                      Thêm ảnh nhân vật ({characterImages.length}/5)
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "editvideo" && (
            <div>
              <input
                ref={editVideoRef}
                type="file"
                accept="video/*"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void getElectronApi().authorizeFilePath(file);
                    setEditVideo(file);
                  }
                  event.target.value = "";
                }}
              />
              {!editVideo ? (
                <button
                  type="button"
                  className="source-media-dropzone"
                  onClick={() => void handlePickEditVideo()}
                >
                  <div className="source-media-dropzone__icon">
                    <Film size={22} />
                  </div>
                  <div className="source-media-dropzone__text">
                    <span className="source-media-dropzone__title">
                      Tải lên video đầu vào
                    </span>
                    <span className="source-media-dropzone__hint">
                      MP4, WebM, MOV · Bấm để chọn file video
                    </span>
                  </div>
                </button>
              ) : (
                <div
                  className="source-reference-preview-box"
                  style={{ marginTop: "var(--space-3)" }}
                >
                  {editVideoThumb ? (
                    <img
                      src={editVideoThumb}
                      alt={editVideo.name}
                      className="source-reference-thumb"
                      style={{ cursor: "pointer" }}
                      title="Bấm để xem video"
                      onClick={() => setPreviewInputVideo(true)}
                    />
                  ) : editVideoUrl ? (
                    <video
                      src={editVideoUrl}
                      className="source-reference-thumb"
                      style={{ cursor: "pointer" }}
                      title="Bấm để xem video"
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        (e.target as HTMLVideoElement).currentTime = 0.5;
                      }}
                      onClick={() => setPreviewInputVideo(true)}
                    />
                  ) : null}
                  <div
                    className="source-reference-info"
                    style={{ cursor: "pointer" }}
                    title="Bấm để xem video"
                    onClick={() => setPreviewInputVideo(true)}
                  >
                    <span
                      className="source-reference-name"
                      title={editVideo.name}
                    >
                      {editVideo.name}
                    </span>
                    <span className="source-reference-size">
                      {(editVideo.size / (1024 * 1024)).toFixed(1)} MB · Video
                      đầu vào
                    </span>
                  </div>
                  <div className="source-reference-actions">
                    <button
                      type="button"
                      className="source-reference-action-btn"
                      title="Xem video"
                      aria-label={`Xem video ${editVideo.name}`}
                      onClick={() => setPreviewInputVideo(true)}
                    >
                      <Eye
                        size={15}
                        className="source-action-icon--view"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="source-reference-action-btn"
                      title="Đổi video khác"
                      onClick={() => void handlePickEditVideo()}
                    >
                      <Repeat2
                        size={15}
                        className="source-action-icon--repeat"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="source-prompt-delete-btn"
                      title="Xóa video"
                      onClick={() => setEditVideo(undefined)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
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
            <span>{prompts.filter((p) => p.trim()).length} prompt</span>
          </div>
          <div className="source-prompt-list">
            {prompts.map((p, index) => (
              <div className="source-prompt-row" key={index}>
                <textarea
                  value={p}
                  rows={3}
                  aria-label={`Prompt ${index + 1}`}
                  placeholder="Mô tả video cần tạo..."
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
            <Select value={modelId} onValueChange={(val) => setModelId(val)}>
              <SelectTrigger aria-label="Model">
                <SelectValue placeholder="Chọn model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Clock size={16} aria-hidden="true" />
              Thời lượng
            </span>
            <Select
              value={String(duration)}
              onValueChange={(val) => setDuration(Number(val))}
            >
              <SelectTrigger aria-label="Thời lượng">
                <SelectValue placeholder="Chọn thời lượng" />
              </SelectTrigger>
              <SelectContent>
                {(selectedModel?.durations || []).map((val) => (
                  <SelectItem key={val} value={String(val)}>
                    {val}s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Crop size={16} aria-hidden="true" />
              Tỷ lệ
            </span>
            <Select
              value={aspect}
              onValueChange={(val) =>
                setAspect(val as "landscape" | "portrait")
              }
            >
              <SelectTrigger aria-label="Tỷ lệ">
                <SelectValue placeholder="Chọn tỷ lệ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">16:9 (Ngang)</SelectItem>
                <SelectItem value="portrait">9:16 (Dọc)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
        <div className="source-generation-actions-row">
          <Button
            disabled={
              queue.tasks.filter(
                (task) =>
                  task.status === "queued" || task.status === "processing",
              ).length >= 20 ||
              !prompts.some((p) => p.trim()) ||
              !selectedModel ||
              selectedSlotId === null ||
              (mode === "image" && !startImage) ||
              (mode === "startend" && (!startImage || !endImage)) ||
              (mode === "editvideo" && !editVideo) ||
              (mode === "charsync" && !characterImages.length)
            }
            onClick={() => void generate()}
            className="source-generate-main-btn"
          >
            <Sparkles size={17} />
            Thêm vào hàng đợi
          </Button>
        </div>
      </div>
      <section className="source-generation-results" aria-label="Kết quả video">
        <header className="source-results-header">
          <div className="source-results-header__title-group">
            <h2>Hàng đợi và kết quả</h2>
            <span className="source-results-count-badge">
              {queue.tasks.length} video
            </span>
          </div>
          <div className="source-results-header__actions">
            <button
              type="button"
              className={`source-results-header-btn ${queue.paused ? "source-results-header-btn--paused" : ""}`}
              disabled={!queue.tasks.some((task) => task.status === "queued")}
              onClick={() => queue.setPaused(!queue.paused)}
              title={
                queue.paused ? "Tiếp tục chạy hàng đợi" : "Tạm dừng hàng đợi"
              }
            >
              {queue.paused ? (
                <>
                  <Play size={13} className="source-header-btn-icon--play" />
                  Tiếp tục
                </>
              ) : (
                <>
                  <Pause size={13} className="source-header-btn-icon--pause" />
                  Tạm dừng
                </>
              )}
            </button>
            <button
              type="button"
              className="source-results-header-btn source-results-header-btn--clear"
              disabled={
                !queue.tasks.some(
                  (task) =>
                    task.status === "success" || task.status === "error",
                )
              }
              onClick={queue.clearFinished}
              title="Dọn sạch các tác vụ đã hoàn thành hoặc thất bại"
            >
              <Trash2 size={13} className="source-header-btn-icon--clear" />
              Dọn kết quả
            </button>
          </div>
        </header>
        {queue.tasks.length === 0 ? (
          <div className="source-generation-empty">
            <Inbox size={34} aria-hidden="true" />
            <p>Hàng đợi đang trống. Hãy nhập prompt để bắt đầu tạo video.</p>
          </div>
        ) : (
          <div className="source-image-grid">
            {queue.tasks.map((task) => (
              <article
                key={task.id}
                data-status={task.status}
                className="source-image-task-card"
              >
                {task.src || task.thumbnailDataUrl ? (
                  <div
                    className="source-video-task-thumb-container"
                    onClick={() => setPreviewTask(task)}
                    title="Bấm để mở video"
                  >
                    {task.thumbnailDataUrl ? (
                      <img
                        src={task.thumbnailDataUrl}
                        alt={task.prompt}
                        className="source-image-task-thumb"
                      />
                    ) : (
                      <video
                        src={task.localPath || task.src}
                        className="source-image-task-thumb"
                        preload="metadata"
                        muted
                      />
                    )}
                    <div className="source-video-play-overlay">
                      <Play size={22} aria-hidden="true" fill="currentColor" />
                    </div>
                  </div>
                ) : (
                  <div className="source-image-task-placeholder">
                    {task.status === "processing" ? (
                      <div className="source-processing-percent-box">
                        <Clock4
                          size={30}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                        <span
                          className="source-processing-estimate-label"
                          style={{ marginTop: 4 }}
                        >
                          Đang tạo video...
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
                      <span
                        className="source-task-aspect-badge"
                        title={`Thời lượng: ${task.duration || task.request?.duration || 8}s`}
                      >
                        {task.duration || task.request?.duration || 8}s
                      </span>
                      <span
                        className="source-task-aspect-badge"
                        title={`Độ phân giải: ${(task.resolution || task.request?.resolution || "720p").toUpperCase()}`}
                      >
                        {(
                          task.resolution ||
                          task.request?.resolution ||
                          "720p"
                        ).toUpperCase()}
                      </span>
                      <span
                        className="source-task-aspect-badge"
                        title={`Tỷ lệ: ${(task.aspect || task.request?.aspect) === "portrait" ? "9:16" : "16:9"}`}
                      >
                        {(task.aspect || task.request?.aspect) === "portrait"
                          ? "9:16"
                          : "16:9"}
                      </span>
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
                  {task.postError && (
                    <p className="source-task-error-text" role="alert">
                      {task.postError}
                    </p>
                  )}
                  <footer className="source-image-task-actions">
                    {/* 1. Xem */}
                    {task.src && (
                      <button
                        type="button"
                        className="source-task-action-btn"
                        onClick={() => setPreviewTask(task)}
                        title="Xem video phóng to"
                      >
                        <Eye
                          size={14}
                          className="source-action-icon--view"
                          aria-hidden="true"
                        />
                        Xem
                      </button>
                    )}

                    {/* 2. Mở thư mục / Đang tải... */}
                    {task.src &&
                      (task.localPath ? (
                        <button
                          type="button"
                          className="source-task-action-btn"
                          onClick={() => {
                            if (task.localPath) {
                              void videoApi.showInFolder(task.localPath);
                              toast.success(
                                "Đã mở thư mục chứa video trên máy",
                              );
                            }
                          }}
                          title={`Video đã tải về máy: ${task.localPath}. Bấm để mở thư mục.`}
                        >
                          <FolderOpen
                            size={14}
                            className="source-action-icon--folder"
                            aria-hidden="true"
                          />
                          Mở thư mục
                        </button>
                      ) : task.downloadStatus === "downloading" ? (
                        <span
                          className="source-task-action-btn source-task-action-btn--disabled"
                          title="Đang tải video về máy ở chế độ nền..."
                        >
                          <Clock4
                            size={14}
                            className="source-clock-ticking"
                            aria-hidden="true"
                          />
                          Đang tải...
                        </span>
                      ) : null)}

                    {/* 3. Copy prompt */}
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

                    {/* 4. 3 button nâng cấp & hậu kỳ: Tạo GIF, Nâng cấp 1080p, Nâng cấp 4K */}
                    {task.status === "success" && task.mediaId && (
                      <div className="source-video-post-actions">
                        <button
                          type="button"
                          className="source-task-action-btn"
                          disabled={Boolean(postAction)}
                          onClick={() =>
                            void runPostAction(
                              task.id,
                              task.mediaId!,
                              "gif",
                              task.aspect ?? "landscape",
                              task.slotId ?? 0,
                            )
                          }
                          title="Tạo ảnh GIF động từ video này"
                        >
                          {postAction === `${task.id}:gif` ? (
                            <>
                              <Clock4
                                size={14}
                                className="source-clock-ticking"
                                aria-hidden="true"
                              />
                              Đang tạo GIF...
                            </>
                          ) : (
                            <>
                              <BroomSparkles
                                size={14}
                                className="source-action-icon--gif"
                                aria-hidden="true"
                              />
                              Tạo GIF
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="source-task-action-btn"
                          disabled={
                            Boolean(postAction) ||
                            task.resolution === "1080p" ||
                            task.resolution === "4k"
                          }
                          onClick={() =>
                            void runPostAction(
                              task.id,
                              task.mediaId!,
                              "1080p",
                              task.aspect ?? "landscape",
                              task.slotId ?? 0,
                            )
                          }
                          title={
                            task.resolution === "1080p" ||
                            task.resolution === "4k"
                              ? "Video đã đạt 1080p trở lên"
                              : "Nâng cấp độ phân giải lên Full HD 1080p"
                          }
                        >
                          {postAction === `${task.id}:1080p` ? (
                            <>
                              <Clock4
                                size={14}
                                className="source-clock-ticking"
                                aria-hidden="true"
                              />
                              Đang nâng 1080p...
                            </>
                          ) : (
                            <>
                              <Tv
                                size={14}
                                className="source-action-icon--upscale"
                                aria-hidden="true"
                              />
                              Nâng cấp 1080p
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="source-task-action-btn"
                          disabled={
                            Boolean(postAction) || task.resolution === "4k"
                          }
                          onClick={() =>
                            void runPostAction(
                              task.id,
                              task.mediaId!,
                              "4k",
                              task.aspect ?? "landscape",
                              task.slotId ?? 0,
                            )
                          }
                          title={
                            task.resolution === "4k"
                              ? "Video đã đạt 4K"
                              : "Nâng cấp độ phân giải lên Ultra HD 4K"
                          }
                        >
                          {postAction === `${task.id}:4k` ? (
                            <>
                              <Clock4
                                size={14}
                                className="source-clock-ticking"
                                aria-hidden="true"
                              />
                              Đang nâng 4K...
                            </>
                          ) : (
                            <>
                              <Sparkles
                                size={14}
                                className="source-action-icon--upscale"
                                aria-hidden="true"
                              />
                              Nâng cấp 4K
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* 5. Nút Xóa / Ẩn / Bỏ hàng đợi đặt trực tiếp liền kề bên phải Nâng cấp 4K */}
                    {task.status === "processing" ? (
                      <button
                        type="button"
                        className="source-task-action-btn source-task-action-btn--delete"
                        onClick={() => {
                          queue.deleteTask(task.id);
                          toast.info(
                            "Đã ẩn tác vụ khỏi danh sách (tiến trình tạo video vẫn tiếp tục chạy ngầm trên máy chủ).",
                          );
                        }}
                        title="Ẩn khỏi danh sách (không hủy tạo video trên máy chủ)"
                      >
                        <EyeOff
                          size={14}
                          className="source-action-icon--delete"
                          aria-hidden="true"
                        />
                        Ẩn
                      </button>
                    ) : task.status === "queued" ? (
                      <button
                        type="button"
                        className="source-task-action-btn source-task-action-btn--delete"
                        onClick={() => {
                          queue.deleteTask(task.id);
                          toast.info("Đã bỏ tác vụ khỏi hàng đợi chờ.");
                        }}
                        title="Bỏ tác vụ này khỏi hàng đợi chờ"
                      >
                        <X
                          size={14}
                          className="source-action-icon--delete"
                          aria-hidden="true"
                        />
                        Bỏ hàng đợi
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="source-task-action-btn source-task-action-btn--delete"
                        onClick={() => queue.deleteTask(task.id)}
                        title="Xóa kết quả tác vụ này"
                      >
                        <Trash2
                          size={14}
                          className="source-action-icon--delete"
                          aria-hidden="true"
                        />
                        Xóa
                      </button>
                    )}

                    {/* 6. Thử lại (khi lỗi) */}
                    {task.status === "error" && (
                      <button
                        type="button"
                        className="source-task-action-btn source-task-action-btn--retry"
                        onClick={() => handleRetryTask(task)}
                        title="Thử lại tác vụ này"
                      >
                        <RotateCcw
                          size={14}
                          className="source-action-icon--retry"
                          aria-hidden="true"
                        />
                        Thử lại
                      </button>
                    )}
                  </footer>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(activePreviewTask)}
        onOpenChange={(open) => {
          if (!open) setPreviewTask(null);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {activePreviewTask &&
            (activePreviewTask.localPath || activePreviewTask.src) && (
              <>
                <DialogTitle style={{ display: "none" }}>
                  {activePreviewTask.prompt}
                </DialogTitle>
                <DialogDescription style={{ display: "none" }}>
                  Xem chi tiết video đã tạo
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
                    title="Xem video trước (Phím ←)"
                    aria-label="Xem video trước"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToPrev();
                    }}
                  >
                    <ChevronLeft size={28} />
                  </button>
                )}

                <div className="source-media-lightbox__stage">
                  <video
                    key={`${activePreviewTask.id}_${activePreviewTask.localPath || activePreviewTask.src}`}
                    src={activePreviewTask.localPath || activePreviewTask.src}
                    controls
                    autoPlay
                    className="source-media-lightbox__video"
                  />
                </div>

                {hasNext && (
                  <button
                    type="button"
                    className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--next"
                    title="Xem video tiếp theo (Phím →)"
                    aria-label="Xem video tiếp theo"
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
        open={previewInputVideo && Boolean(editVideoUrl)}
        onOpenChange={(open) => {
          if (!open) setPreviewInputVideo(false);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {editVideo && editVideoUrl && (
            <>
              <DialogTitle style={{ display: "none" }}>
                {editVideo.name}
              </DialogTitle>
              <DialogDescription style={{ display: "none" }}>
                Xem video đầu vào
              </DialogDescription>

              <button
                type="button"
                className="source-media-lightbox__btn-close"
                title="Đóng (Esc)"
                aria-label="Đóng"
                onClick={() => setPreviewInputVideo(false)}
              >
                <X size={20} />
              </button>

              <div className="source-media-lightbox__stage">
                <video
                  src={editVideoUrl}
                  controls
                  autoPlay
                  className="source-media-lightbox__video"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null);
        }}
      >
        <DialogContent className="source-media-lightbox" showClose={false}>
          {previewImage && (
            <>
              <DialogTitle style={{ display: "none" }}>
                {previewImage.title}
              </DialogTitle>
              <DialogDescription style={{ display: "none" }}>
                Xem chi tiết ảnh
              </DialogDescription>

              {previewImage.items &&
                previewImage.items.length > 1 &&
                previewImage.index !== undefined && (
                  <div className="source-media-lightbox__counter">
                    {previewImage.index + 1} / {previewImage.items.length}
                  </div>
                )}

              <button
                type="button"
                className="source-media-lightbox__btn-close"
                title="Đóng (Esc)"
                aria-label="Đóng"
                onClick={() => setPreviewImage(null)}
              >
                <X size={20} />
              </button>

              {previewImage.items &&
                previewImage.index !== undefined &&
                previewImage.index > 0 && (
                  <button
                    type="button"
                    className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--prev"
                    title="Xem ảnh trước (Phím ←)"
                    aria-label="Xem ảnh trước"
                    onClick={(e) => {
                      e.stopPropagation();
                      const prevIdx = previewImage.index! - 1;
                      const prevItem = previewImage.items![prevIdx];
                      if (prevItem) {
                        setPreviewImage({
                          ...prevItem,
                          items: previewImage.items,
                          index: prevIdx,
                        });
                      }
                    }}
                  >
                    <ChevronLeft size={28} />
                  </button>
                )}

              <div className="source-media-lightbox__stage">
                <img
                  key={previewImage.url}
                  src={previewImage.url}
                  alt={previewImage.title}
                  className="source-media-lightbox__img"
                />
              </div>

              {previewImage.items &&
                previewImage.index !== undefined &&
                previewImage.index < previewImage.items.length - 1 && (
                  <button
                    type="button"
                    className="source-media-lightbox__btn-nav source-media-lightbox__btn-nav--next"
                    title="Xem ảnh tiếp theo (Phím →)"
                    aria-label="Xem ảnh tiếp theo"
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextIdx = previewImage.index! + 1;
                      const nextItem = previewImage.items![nextIdx];
                      if (nextItem) {
                        setPreviewImage({
                          ...nextItem,
                          items: previewImage.items,
                          index: nextIdx,
                        });
                      }
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
