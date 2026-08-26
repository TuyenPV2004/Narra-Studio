import {
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Layers2,
  Play,
  Sparkles,
  Square,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
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
          status: "queued",
        },
      ];
    });
  const items = Array.isArray(plan.runItems) ? plan.runItems.map(object) : [];
  return items.flatMap((item, index) => {
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!prompt) return [];
    return [
      {
        id: typeof item.id === "string" ? item.id : `run-${index + 1}`,
        kind: item.kind === "image" ? "image" : "video",
        title:
          typeof item.title === "string" ? item.title : `Task ${index + 1}`,
        prompt,
        status: "queued",
      },
    ];
  });
};

export function WorkflowPanel({ providerId }: { providerId: ProviderId }) {
  const [brief, setBrief] = useState("");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<"campaign" | "image" | "video">("campaign");
  const [aspect, setAspect] = useState<"landscape" | "portrait">("landscape");
  const [outputKind, setOutputKind] = useState<"image" | "video">("image");
  const [outputUrl, setOutputUrl] = useState("");
  const [running, setRunning] = useState<WorkflowAction>();
  const [result, setResult] = useState<unknown>();
  const [plan, setPlan] = useState<unknown>();
  const [runItems, setRunItems] = useState<WorkflowRunItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: WorkflowAction) => {
    if (running) return;
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
          Workflow sáng tạo
        </h2>
        <div className="source-control-field">
          <span className="source-control-label-text">
            Ý tưởng / Creative brief{" "}
            <span className="source-required-mark">*</span>
          </span>
          <textarea
            id="workflow-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Mô tả mục tiêu, phong cách, nhân vật, bối cảnh..."
          />
        </div>
        <div className="source-control-field">
          <span className="source-control-label-text">Yêu cầu bổ sung</span>
          <textarea
            id="workflow-instruction"
            rows={2}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Ghi chú điều chỉnh hoặc phạm vi thực thi..."
          />
        </div>
        <div className="source-agent-workflow__controls">
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Layers2 size={15} />
              Thể loại
            </span>
            <Select
              value={kind}
              onValueChange={(val) => setKind(val as typeof kind)}
            >
              <SelectTrigger aria-label="Thể loại">
                <SelectValue placeholder="Chọn thể loại" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="campaign">Chiến dịch (Campaign)</SelectItem>
                <SelectItem value="image">Bộ ảnh (Image)</SelectItem>
                <SelectItem value="video">Video ngắn (Video)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Square size={15} />
              Tỷ lệ khung hình
            </span>
            <Select
              value={aspect}
              onValueChange={(val) => setAspect(val as typeof aspect)}
            >
              <SelectTrigger aria-label="Tỷ lệ khung hình">
                <SelectValue placeholder="Chọn tỷ lệ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">Ngang (16:9)</SelectItem>
                <SelectItem value="portrait">Dọc (9:16)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="source-agent-workflow__actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("intent")}
          >
            <Sparkles size={14} />
            Phân loại ý định
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("analyze")}
          >
            <WandSparkles size={14} />
            Phân tích sâu
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!brief.trim() || Boolean(running)}
            onClick={() => void run("workflow")}
          >
            <Play size={14} />
            Tạo workflow
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!plan || Boolean(running)}
            onClick={() => void run("polish")}
          >
            <Sparkles size={14} />
            Chuốt prompt
          </Button>
        </div>
        {runItems.length > 0 && (
          <div className="source-workflow-render">
            <label className="source-workflow-render__confirm">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>
                Xác nhận tạo tự động {runItems.length} tác vụ bằng provider.
              </span>
            </label>
            <Button
              type="button"
              variant="primary"
              aria-label="Render toàn bộ workflow"
              disabled={!approved || Boolean(running)}
              onClick={() => void renderWorkflow()}
            >
              <Play size={15} />
              Render {runItems.length} tác vụ
            </Button>
            <ol className="source-workflow-render__list">
              {runItems.map((item) => (
                <li
                  key={item.id}
                  className="source-workflow-render__item"
                  data-status={item.status}
                >
                  <div className="source-workflow-render__item-info">
                    <strong>{item.title}</strong>
                    <span className="source-workflow-render__item-prompt">
                      {item.prompt}
                    </span>
                  </div>
                  <span className="source-workflow-render__item-badge">
                    {item.status === "done"
                      ? "Hoàn tất"
                      : item.status === "processing"
                        ? "Đang chạy"
                        : "Đang chờ"}
                  </span>
                  {item.error && <em>{item.error}</em>}
                </li>
              ))}
            </ol>
          </div>
        )}
        <details className="source-workflow-review-details">
          <summary>Đánh giá &amp; Kiểm tra output</summary>
          <div className="source-workflow-review-form">
            <div className="source-control-field">
              <span className="source-control-label-text">Loại output</span>
              <Select
                value={outputKind}
                onValueChange={(val) => setOutputKind(val as typeof outputKind)}
              >
                <SelectTrigger aria-label="Loại output">
                  <SelectValue placeholder="Chọn loại output" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Ảnh (Image)</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="source-control-field">
              <span className="source-control-label-text">
                Output URL hoặc đường dẫn
              </span>
              <Input
                value={outputUrl}
                onChange={(event) => setOutputUrl(event.target.value)}
                placeholder="https://... hoặc đường dẫn file"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!brief.trim() || Boolean(running)}
              onClick={() => void run("review")}
            >
              <CheckCircle2 size={14} />
              Đánh giá output
            </Button>
          </div>
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
        <header className="source-agent-workflow__result-header">
          <h2>
            <CheckCircle2 size={18} />
            Kết quả phân tích &amp; Workflow
          </h2>
          {Boolean(result) && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(format(result));
              }}
            >
              Sao chép JSON
            </Button>
          )}
        </header>
        {result ? (
          <pre>{format(result)}</pre>
        ) : (
          <div className="source-generation-empty">
            <Sparkles size={28} />
            <p>Kết quả phân tích và kế hoạch workflow sẽ xuất hiện tại đây.</p>
          </div>
        )}
      </div>
    </section>
  );
}
