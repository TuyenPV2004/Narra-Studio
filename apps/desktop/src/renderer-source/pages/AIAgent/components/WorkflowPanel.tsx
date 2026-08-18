import { CheckCircle2, Play, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { agentApi } from "@/services/electron-api/agent";
import { imageApi } from "@/services/electron-api/image";
import { videoApi } from "@/services/electron-api/video";
import type { ProviderId } from "@/types/electron-api";
import { ScriptStudioPanel } from "@/pages/AIAgent/components/ScriptStudioPanel";

type WorkflowAction = "analyze" | "intent" | "polish" | "review" | "workflow";
const format = (value: unknown) => JSON.stringify(value, null, 2);
interface WorkflowRunItem {
  id: string;
  kind: "image" | "video";
  title: string;
  prompt: string;
  status: "done" | "error" | "processing" | "queued";
  src?: string | undefined;
  error?: string | undefined;
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const materializePlan = (value: unknown): WorkflowRunItem[] => {
  const plan = object(value);
  const scenes = Array.isArray(plan.scenes) ? plan.scenes.map(object) : [];
  if (scenes.length)
    return scenes.flatMap((scene, index) => {
      const prompt =
        typeof scene.prompt === "string" ? scene.prompt.trim() : "";
      if (!prompt) return [];
      return [
        {
          id: typeof scene.id === "string" ? scene.id : `scene-${index + 1}`,
          kind: scene.intent === "image" ? "image" : "video",
          title:
            typeof scene.title === "string"
              ? scene.title
              : `Scene ${index + 1}`,
          prompt,
          status: "queued" as const,
        },
      ];
    });
  const images = Array.isArray(plan.imagePrompts) ? plan.imagePrompts : [];
  const videos = Array.isArray(plan.videoPrompts) ? plan.videoPrompts : [];
  return [
    ...images.flatMap((prompt, index) =>
      typeof prompt === "string" && prompt.trim()
        ? [
            {
              id: `image-${index + 1}`,
              kind: "image" as const,
              title: `Image ${index + 1}`,
              prompt,
              status: "queued" as const,
            },
          ]
        : [],
    ),
    ...videos.flatMap((prompt, index) =>
      typeof prompt === "string" && prompt.trim()
        ? [
            {
              id: `video-${index + 1}`,
              kind: "video" as const,
              title: `Video ${index + 1}`,
              prompt,
              status: "queued" as const,
            },
          ]
        : [],
    ),
  ];
};

export function WorkflowPanel({
  providerId = "veo3",
}: {
  providerId?: ProviderId;
}) {
  const [brief, setBrief] = useState("");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<"campaign" | "image" | "video">("campaign");
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [outputKind, setOutputKind] = useState<"image" | "video">("image");
  const [outputUrl, setOutputUrl] = useState("");
  const [plan, setPlan] = useState<unknown>();
  const [result, setResult] = useState<unknown>();
  const [runItems, setRunItems] = useState<WorkflowRunItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [running, setRunning] = useState<WorkflowAction>();
  const [error, setError] = useState<string>();
  const run = async (action: WorkflowAction) => {
    if (!brief.trim()) return;
    setRunning(action);
    setError(undefined);
    try {
      const value =
        action === "intent"
          ? await agentApi.intent(brief)
          : action === "analyze"
            ? await agentApi.deepAnalyze(brief)
            : action === "workflow"
              ? await agentApi.workflow(brief, instruction, kind, aspect)
              : action === "polish"
                ? await agentApi.polishWorkflow(brief, instruction, plan)
                : await agentApi.reviewOutput(brief, outputKind, outputUrl);
      setResult(value);
      if (action === "workflow" || action === "polish") {
        const nextPlan = (value as { plan?: unknown })?.plan ?? value;
        setPlan(nextPlan);
        setRunItems(materializePlan(nextPlan));
        setApproved(false);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setRunning(undefined);
    }
  };
  const renderWorkflow = async () => {
    if (!approved || !runItems.length) return;
    setRunning("workflow");
    setError(undefined);
    try {
      for (const item of runItems) {
        setRunItems((items) =>
          items.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "processing", error: undefined }
              : entry,
          ),
        );
        try {
          const output =
            item.kind === "image"
              ? await imageApi.generate({
                  providerId,
                  prompt: item.prompt,
                  model: "NARWHAL",
                  aspect: "IMAGE_ASPECT_RATIO_LANDSCAPE",
                  resolution: "2k",
                  seed: Math.floor(Math.random() * 9_999_999),
                })
              : await videoApi.generate({
                  providerId,
                  prompt: item.prompt,
                  model: "abra_t2v_8s",
                  aspect: "landscape",
                  duration: 8,
                  resolution: "720p",
                  generateAudio: false,
                  mode: "text",
                });
          setRunItems((items) =>
            items.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: "done",
                    src: output.src,
                    error: undefined,
                  }
                : entry,
            ),
          );
        } catch (value) {
          const message =
            value instanceof Error ? value.message : String(value);
          setRunItems((items) =>
            items.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "error", error: message }
                : entry,
            ),
          );
          throw value;
        }
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setRunning(undefined);
    }
  };
  return (
    <section className="source-agent-workflow" aria-label="Workflow AI Agent">
      <div className="source-agent-workflow__form narra-card">
        <h2>
          <WandSparkles size={18} />
          Creative workflow
        </h2>
        <label htmlFor="workflow-brief">Creative brief</label>
        <textarea
          id="workflow-brief"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="Mục tiêu, đối tượng, phong cách, số lượng nội dung..."
        />
        <label htmlFor="workflow-instruction">Yêu cầu cuối cùng</label>
        <textarea
          id="workflow-instruction"
          rows={3}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Điều chỉnh hoặc phạm vi đã chốt..."
        />
        <div className="source-agent-workflow__controls">
          <label>
            Loại
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="campaign">Campaign</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label>
            Tỷ lệ
            <select
              value={aspect}
              onChange={(event) =>
                setAspect(event.target.value as typeof aspect)
              }
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </label>
        </div>
        <div className="source-agent-workflow__actions">
          <Button
            variant="secondary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("intent")}
          >
            Phân loại ý định
          </Button>
          <Button
            variant="secondary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("analyze")}
          >
            Phân tích sâu
          </Button>
          <Button
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("workflow")}
          >
            <Sparkles size={15} />
            Tạo workflow
          </Button>
          <Button
            variant="secondary"
            disabled={!plan || Boolean(running)}
            onClick={() => void run("polish")}
          >
            Polish workflow
          </Button>
        </div>
        {runItems.length > 0 && (
          <div className="source-workflow-render">
            <label>
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              Tôi xác nhận chạy {runItems.length} tác vụ và có thể sử dụng
              credit provider.
            </label>
            <Button
              aria-label="Render toàn bộ workflow"
              disabled={!approved || Boolean(running)}
              onClick={() => void renderWorkflow()}
            >
              <Play size={15} />
              Render workflow
            </Button>
            <ol>
              {runItems.map((item) => (
                <li key={item.id} data-status={item.status}>
                  <span>{item.title}</span>
                  <small>{item.status}</small>
                  {item.error && <em>{item.error}</em>}
                </li>
              ))}
            </ol>
          </div>
        )}
        <details>
          <summary>Review prompt/output</summary>
          <label>
            Loại output
            <select
              value={outputKind}
              onChange={(event) =>
                setOutputKind(event.target.value as typeof outputKind)
              }
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label>
            Output URL (tùy chọn)
            <input
              value={outputUrl}
              onChange={(event) => setOutputUrl(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("review")}
          >
            Review output
          </Button>
        </details>
        {running && <p role="status">Đang xử lý {running}...</p>}
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
        <ScriptStudioPanel />
      </div>
      <div className="source-agent-workflow__result narra-card">
        <h2>
          <CheckCircle2 size={18} />
          Kết quả có cấu trúc
        </h2>
        {result ? (
          <pre>{format(result)}</pre>
        ) : (
          <div className="source-generation-empty">
            <Sparkles size={28} />
            <p>
              Kết quả intent, analysis, workflow hoặc review sẽ hiển thị tại
              đây.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
