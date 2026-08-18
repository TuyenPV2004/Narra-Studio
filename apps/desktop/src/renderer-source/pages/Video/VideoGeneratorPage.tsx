import {
  Film,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  videoApi,
  type VideoGenerationRequest,
  type VideoMode,
  type VideoModel,
} from "@/services/electron-api/video";
import { useVideoQueue } from "@/pages/Video/useVideoQueue";
import type { ProviderId } from "@/types/electron-api";

const flowModels: VideoModel[] = [
  {
    id: "abra_t2v_8s",
    label: "Google Abra T2V (Tiêu chuẩn / Miễn phí)",
    durations: [4, 6, 8],
    resolutions: ["720p"],
  },
  {
    id: "veo_3_1_t2v_fast_ultra",
    label: "VEO 3.1 Fast (Ultra)",
    durations: [4, 6, 8],
    resolutions: ["720p"],
  },
  {
    id: "veo_3_1_t2v_quality_ultra",
    label: "VEO 3.1 Quality (Ultra)",
    durations: [4, 6, 8],
    resolutions: ["1080p"],
  },
];
const defaultFlowModel = flowModels[0]!;

export function VideoGeneratorPage({ providerId }: { providerId: ProviderId }) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<VideoMode>("text");
  const models = flowModels;
  const [modelId, setModelId] = useState(defaultFlowModel.id);
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState("720p");
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [startImage, setStartImage] = useState<File>();
  const [endImage, setEndImage] = useState<File>();
  const [editVideo, setEditVideo] = useState<File>();
  const [characterImages, setCharacterImages] = useState<File[]>([]);
  const [postAction, setPostAction] = useState<string>();
  const selectedModel = useMemo(
    () => models.find((item) => item.id === modelId) || models[0],
    [modelId, models],
  );
  const queue = useVideoQueue(videoApi.generate);
  const running = queue.tasks.some((task) => task.status === "processing");

  useEffect(() => {
    setDuration(selectedModel?.durations[0] || 5);
    setResolution(selectedModel?.resolutions[0] || "720p");
  }, [selectedModel]);

  const requestFor = useCallback(
    (value: string): VideoGenerationRequest | null =>
      selectedModel
        ? {
            aspect,
            duration,
            generateAudio,
            mode,
            model: selectedModel.id,
            prompt: value,
            providerId,
            resolution,
            ...(startImage ? { startImage } : {}),
            ...(endImage ? { endImage } : {}),
            ...(editVideo ? { editVideo } : {}),
            ...(characterImages.length ? { characterImages } : {}),
          }
        : null,
    [
      aspect,
      characterImages,
      duration,
      editVideo,
      endImage,
      generateAudio,
      mode,
      providerId,
      resolution,
      selectedModel,
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
    const requests = prompt
      .split(/\n\s*\n/)
      .map((value) => requestFor(value.trim()))
      .filter((value): value is VideoGenerationRequest =>
        Boolean(value?.prompt),
      );
    if (!requests.length) return;
    queue.enqueue(requests);
    setPrompt("");
  }, [
    characterImages.length,
    editVideo,
    endImage,
    mode,
    prompt,
    queue.enqueue,
    requestFor,
    startImage,
  ]);
  const runPostAction = useCallback(
    async (taskId: string, mediaId: string, action: "gif" | "1080p" | "4k") => {
      const actionId = `${taskId}:${action}`;
      setPostAction(actionId);
      queue.updateTask(taskId, { postError: undefined });
      try {
        if (action === "gif") await videoApi.createGif(mediaId);
        else {
          const src = await videoApi.upscale(mediaId, action, aspect);
          queue.updateTask(taskId, { src });
        }
      } catch (error) {
        queue.updateTask(taskId, {
          postError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPostAction(undefined);
      }
    },
    [aspect, queue.updateTask],
  );

  return (
    <section
      className="source-generation-page source-video-page"
      aria-labelledby="video-title"
    >
      <div className="source-generation-controls">
        <header>
          <Film size={22} />
          <div>
            <h1 id="video-title">Tạo video</h1>
            <p>Google Flow video qua phiên tài khoản hiện tại.</p>
          </div>
        </header>
        <section className="source-control-card">
          <h2>Chế độ</h2>
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
          {(mode === "image" || mode === "startend") && (
            <div className="source-reference-inputs">
              <label>
                <ImagePlus size={16} />
                Ảnh đầu
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setStartImage(event.target.files?.[0])}
                />
              </label>
              {mode === "startend" && (
                <label>
                  <ImagePlus size={16} />
                  Ảnh cuối
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setEndImage(event.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          )}
          {mode === "charsync" && (
            <div className="source-reference-inputs">
              <label>
                <ImagePlus size={16} />
                Ảnh nhân vật
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) =>
                    setCharacterImages(Array.from(event.target.files || []))
                  }
                />
              </label>
            </div>
          )}
          {mode === "editvideo" && (
            <div className="source-reference-inputs">
              <label>
                <Film size={16} />
                Video đầu vào
                <input
                  type="file"
                  accept="video/*"
                  onChange={(event) => setEditVideo(event.target.files?.[0])}
                />
              </label>
            </div>
          )}
        </section>
        <section className="source-control-card">
          <label>
            Prompt
            <textarea
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Mô tả video cần tạo..."
            />
          </label>
        </section>
        <section className="source-control-card source-control-grid">
          <label>
            Model
            <select
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thời lượng
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {(selectedModel?.durations || []).map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
          </label>
          <label>
            Độ phân giải
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            >
              {(selectedModel?.resolutions || []).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Tỷ lệ
            <select
              value={aspect}
              onChange={(event) =>
                setAspect(event.target.value as "landscape" | "portrait")
              }
            >
              <option value="landscape">16:9</option>
              <option value="portrait">9:16</option>
            </select>
          </label>
          <label className="source-check">
            <input
              type="checkbox"
              checked={generateAudio}
              onChange={(event) => setGenerateAudio(event.target.checked)}
            />
            Tạo âm thanh
          </label>
        </section>
        <Button
          disabled={
            queue.tasks.filter(
              (task) =>
                task.status === "queued" || task.status === "processing",
            ).length >= 20 ||
            !prompt.trim() ||
            !selectedModel ||
            (mode === "image" && !startImage) ||
            (mode === "startend" && (!startImage || !endImage)) ||
            (mode === "editvideo" && !editVideo) ||
            (mode === "charsync" && !characterImages.length)
          }
          onClick={() => void generate()}
        >
          <Sparkles size={17} />
          Thêm vào hàng đợi
        </Button>
      </div>
      <section className="source-generation-results">
        <header>
          <h2>Hàng đợi và kết quả</h2>
          <div>
            <span>{queue.tasks.length}</span>
            <Button
              variant="ghost"
              disabled={!queue.tasks.some((task) => task.status === "queued")}
              onClick={() => queue.setPaused(!queue.paused)}
            >
              {queue.paused ? (
                <>
                  <Play size={14} />
                  Tiếp tục
                </>
              ) : (
                <>
                  <Pause size={14} />
                  Tạm dừng
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              disabled={
                !queue.tasks.some(
                  (task) =>
                    task.status === "success" || task.status === "error",
                )
              }
              onClick={queue.clearFinished}
            >
              <Trash2 size={14} />
              Dọn kết quả
            </Button>
          </div>
        </header>
        {queue.tasks.length === 0 ? (
          <div className="source-generation-empty">
            <Film size={30} />
            <p>Chưa có tác vụ video.</p>
          </div>
        ) : (
          queue.tasks.map((task) => (
            <article
              className="source-video-result"
              key={task.id}
              data-status={task.status}
            >
              {task.src && <video controls src={task.src} />}
              <strong>
                {task.status === "queued"
                  ? "Đang chờ"
                  : task.status === "processing"
                    ? "Đang tạo"
                    : task.status === "success"
                      ? "Hoàn tất"
                      : "Có lỗi"}
              </strong>
              <p>{task.error || task.prompt}</p>
              {task.postError && (
                <p className="source-error-text" role="alert">
                  {task.postError}
                </p>
              )}
              {providerId === "veo3" &&
                task.status === "success" &&
                task.mediaId && (
                  <div className="source-video-post-actions">
                    {(["gif", "1080p", "4k"] as const).map((action) => (
                      <Button
                        key={action}
                        variant="ghost"
                        disabled={Boolean(postAction)}
                        onClick={() =>
                          void runPostAction(task.id, task.mediaId!, action)
                        }
                      >
                        {postAction === `${task.id}:${action}`
                          ? "Đang xử lý..."
                          : action === "gif"
                            ? "Tạo GIF"
                            : `Nâng cấp ${action.toUpperCase()}`}
                      </Button>
                    ))}
                  </div>
                )}
              {task.status === "error" && requestFor(task.prompt) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const request = requestFor(task.prompt);
                    if (request) queue.retry(task.id, request);
                  }}
                >
                  <RotateCcw size={14} />
                  Thử lại
                </Button>
              )}
            </article>
          ))
        )}
      </section>
    </section>
  );
}
