import { Clapperboard, Layers, Play, Square, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { agentApi, type ScriptStage } from "@/services/electron-api/agent";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export function ScriptStudioPanel() {
  const [script, setScript] = useState("");
  const [project, setProject] = useState<unknown>();
  const [stage, setStage] = useState<ScriptStage>("confirm-camera");
  const [videoSource, setVideoSource] = useState("");
  const [result, setResult] = useState<unknown>();
  const [progress, setProgress] = useState("");
  const [progressId, setProgressId] = useState<string>();
  const [error, setError] = useState<string>();
  const projectRecord = useMemo(() => record(project), [project]);
  const shots = Array.isArray(projectRecord.shots) ? projectRecord.shots : [];
  const canRun =
    stage === "confirm-camera" ? Boolean(script.trim()) : Boolean(project);

  const runStage = async () => {
    if (!canRun || progressId) return;
    const id = `source-script-${crypto.randomUUID()}`;
    setProgressId(id);
    setError(undefined);
    setProgress(`Đang chạy ${stage}...`);
    try {
      const response = await agentApi.runScriptStage(
        stage,
        { project, script, shots },
        id,
        (value) => {
          const update = record(value);
          const shotCount = Number(update.shots || 0);
          const characters = Number(update.chars || 0);
          setProgress(
            shotCount > 0
              ? `${shotCount} phân cảnh · ${(characters / 1000).toFixed(1)}K ký tự`
              : `Đang chạy ${stage}...`,
          );
        },
      );
      const data = record(response).data ?? response;
      setProject(data);
      setResult(response);
      setProgress(`Hoàn tất ${stage}.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setProgressId(undefined);
    }
  };
  const cancel = async () => {
    if (!progressId) return;
    await agentApi.cancelScriptStage(progressId);
    setProgress("Đã yêu cầu dừng và giữ checkpoint gần nhất.");
  };
  const analyzeStory = async () => {
    if (!videoSource.trim() || progressId) return;
    const id = `source-story-${crypto.randomUUID()}`;
    setProgressId(id);
    setError(undefined);
    setProgress("Đang phân tích Video Story...");
    try {
      const response = await agentApi.analyzeVideoStory(videoSource.trim());
      setResult(response);
      setProgress("Hoàn tất Video Story Analysis.");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setProgressId(undefined);
    }
  };

  return (
    <details className="source-script-studio">
      <summary>
        <Clapperboard size={16} /> Script Studio &amp; Video Story
      </summary>
      <div className="source-script-studio__grid">
        <section>
          <div className="source-control-field">
            <span className="source-control-label-text">Kịch bản</span>
            <textarea
              rows={5}
              value={script}
              onChange={(event) => setScript(event.target.value)}
              placeholder="Dán kịch bản để xác nhận camera và phân cảnh..."
            />
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              <Layers size={14} />
              Giai đoạn (Stage)
            </span>
            <Select
              value={stage}
              onValueChange={(val) => setStage(val as ScriptStage)}
            >
              <SelectTrigger aria-label="Stage">
                <SelectValue placeholder="Chọn stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confirm-camera">
                  Xác nhận phân cảnh
                </SelectItem>
                <SelectItem value="prepare-assets">Chuẩn bị assets</SelectItem>
                <SelectItem value="synthesize-prompts">
                  Tổng hợp prompts
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={!canRun || Boolean(progressId)}
              onClick={() => void runStage()}
            >
              <WandSparkles size={15} /> Chạy stage
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!progressId}
              onClick={() => void cancel()}
            >
              <Square size={14} /> Dừng
            </Button>
          </div>
        </section>
        <section>
          <div className="source-control-field">
            <span className="source-control-label-text">
              Video source URL / Đường dẫn
            </span>
            <Input
              value={videoSource}
              onChange={(event) => setVideoSource(event.target.value)}
              placeholder="https://... hoặc file path"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!videoSource.trim() || Boolean(progressId)}
            onClick={() => void analyzeStory()}
          >
            <Play size={14} />
            Phân tích Video Story
          </Button>
          {progress && <p role="status">{progress}</p>}
          {error && (
            <p role="alert" className="source-generation-error">
              {error}
            </p>
          )}
          {Boolean(result) && <pre>{JSON.stringify(result, null, 2)}</pre>}
        </section>
      </div>
    </details>
  );
}
