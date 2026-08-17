import {
  Download,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { imageApi } from "@/services/electron-api";
import type { ProviderId } from "@/types/electron-api";

type TaskStatus = "cancelled" | "error" | "processing" | "queued" | "success";
interface ImageTask {
  error?: string;
  id: string;
  prompt: string;
  src?: string;
  status: TaskStatus;
}
const veoModels = [
  { value: "NARWHAL", label: "Nano Banana 2" },
  { value: "GEM_PIX_2", label: "Banana Pro" },
  { value: "IMAGEN_3_5", label: "Imagen 4" },
];
export function ImageGeneratorPage({ providerId }: { providerId: ProviderId }) {
  void providerId;
  const models = veoModels;
  const [prompts, setPrompts] = useState<string[]>([""]);
  const [model, setModel] = useState("NARWHAL");
  const [aspect, setAspect] = useState("IMAGE_ASPECT_RATIO_LANDSCAPE");
  const [quantity, setQuantity] = useState(1);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    const usable = prompts.map((prompt) => prompt.trim()).filter(Boolean);
    if (!usable.length || running) return;
    const queued = usable.flatMap((prompt) =>
      Array.from({ length: quantity }, () => ({
        id: crypto.randomUUID(),
        prompt,
        status: "queued" as const,
      })),
    );
    setTasks((current) => [...queued, ...current]);
    setPrompts([""]);
    setRunning(true);
    for (const queuedTask of queued) {
      setTasks((current) =>
        current.map((task) =>
          task.id === queuedTask.id ? { ...task, status: "processing" } : task,
        ),
      );
      try {
        const result = await imageApi.generate({
          aspect,
          model,
          prompt: queuedTask.prompt,
          providerId,
          resolution: "2k",
          seed: Math.floor(Math.random() * 9_999_999),
        });
        await imageApi.save(result.src).catch(() => "");
        setTasks((current) =>
          current.map((task) =>
            task.id === queuedTask.id
              ? { ...task, src: result.src, status: "success" }
              : task,
          ),
        );
      } catch (error) {
        setTasks((current) =>
          current.map((task) =>
            task.id === queuedTask.id
              ? {
                  ...task,
                  error: error instanceof Error ? error.message : String(error),
                  status: "error",
                }
              : task,
          ),
        );
      }
    }
    setRunning(false);
  }, [aspect, model, prompts, providerId, quantity, running]);
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
        <header>
          <ImageIcon size={22} />
          <div>
            <h1 id="image-title">Tạo hình ảnh</h1>
            <p>Tạo ảnh qua Google VEO3 và CAPTCHA bridge.</p>
          </div>
        </header>
        <section className="source-control-card">
          <div className="source-control-card__heading">
            <h2>Prompt</h2>
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
                  disabled={prompts.length === 1}
                  aria-label={`Xóa prompt ${index + 1}`}
                  onClick={() =>
                    setPrompts((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={() => setPrompts((current) => [...current, ""])}
          >
            <Plus size={16} />
            Thêm prompt
          </Button>
        </section>
        <section className="source-control-card">
          <h2>Thiết lập</h2>
          <label>
            Model
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tỷ lệ
            <select
              value={aspect}
              onChange={(event) => setAspect(event.target.value)}
            >
              {[
                "IMAGE_ASPECT_RATIO_LANDSCAPE",
                "IMAGE_ASPECT_RATIO_PORTRAIT",
                "IMAGE_ASPECT_RATIO_SQUARE",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.includes("LANDSCAPE")
                    ? "16:9"
                    : value.includes("PORTRAIT")
                      ? "9:16"
                      : value.includes("SQUARE")
                        ? "1:1"
                        : value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Số lượng
            <select
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  x{value}
                </option>
              ))}
            </select>
          </label>
        </section>
        <Button
          disabled={running || !prompts.some((prompt) => prompt.trim())}
          onClick={() => void run()}
        >
          <Sparkles size={17} />
          {running ? "Đang xử lý..." : "Tạo hình ảnh"}
        </Button>
        <small>Ctrl+Enter để thêm vào hàng đợi</small>
      </div>
      <section
        className="source-generation-results"
        aria-label="Kết quả hình ảnh"
      >
        <header>
          <h2>Hàng đợi và kết quả</h2>
          <span>{tasks.length}</span>
        </header>
        {tasks.length === 0 ? (
          <div className="source-generation-empty">
            <ImageIcon size={30} />
            <p>Chưa có tác vụ. Nhập prompt để bắt đầu.</p>
          </div>
        ) : (
          <div className="source-image-grid">
            {tasks.map((task) => (
              <article key={task.id} data-status={task.status}>
                {task.src && <img src={task.src} alt={task.prompt} />}
                <div>
                  <strong>
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
                  <p>{task.error || task.prompt}</p>
                  {task.src && (
                    <a href={task.src} download>
                      <Download size={15} />
                      Tải ảnh
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
