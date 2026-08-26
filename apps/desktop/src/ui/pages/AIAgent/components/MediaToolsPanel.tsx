import { Crop, FileVideo2, Layers3, Music2, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  mediaToolsApi,
  type LocalAudioSource,
  type LocalVideoSource,
} from "@/services/electron-api/media-tools";

type Action = "crop" | "demux" | "depth" | "stems";

export function MediaToolsPanel() {
  const [source, setSource] = useState<LocalVideoSource | null>(null);
  const [audioSource, setAudioSource] = useState<LocalAudioSource | null>(null);
  const [audioRange, setAudioRange] = useState({ start: 0, end: 0 });
  const [audioTrimming, setAudioTrimming] = useState(false);
  const [action, setAction] = useState<Action>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<unknown>();
  const [operationId, setOperationId] = useState<string>();
  const [progress, setProgress] = useState<{
    percent: number;
    stage: string;
  }>();
  const [bounds, setBounds] = useState({
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  const [depthStyle, setDepthStyle] = useState<
    "grayscale" | "heatmap" | "side-by-side"
  >("grayscale");
  const [stemRole, setStemRole] = useState<"background" | "vocals">("vocals");
  useEffect(
    () =>
      mediaToolsApi.subscribeProgress((payload) => {
        const id =
          typeof payload.jobId === "string"
            ? payload.jobId
            : typeof payload.id === "string"
              ? payload.id
              : "";
        if (operationId && id && id !== operationId) return;
        setProgress({
          percent: Number(payload.percent || 0),
          stage:
            typeof payload.stage === "string"
              ? payload.stage
              : typeof payload.phase === "string"
                ? payload.phase
                : "running",
        });
      }),
    [operationId],
  );

  const selectVideo = async () => {
    const file = await mediaToolsApi.selectVideo();
    if (file) {
      setSource(file);
      setResult(undefined);
      setError(undefined);
    }
  };
  const selectAudio = async () => {
    const file = await mediaToolsApi.selectAudio();
    if (file) {
      setAudioSource(file);
      setAudioRange({ start: 0, end: Math.min(file.duration, 10) });
      setError(undefined);
    }
  };
  const trimAudio = async () => {
    if (!audioSource) return;
    setAudioTrimming(true);
    setError(undefined);
    try {
      const output = await mediaToolsApi.trimAudio(
        audioSource,
        audioRange.start,
        audioRange.end,
      );
      setResult(output);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAudioTrimming(false);
    }
  };
  const run = async (nextAction: Action) => {
    if (!source || action) return;
    const id = `source-media-${crypto.randomUUID()}`;
    setOperationId(id);
    setAction(nextAction);
    setProgress({ percent: 0, stage: "Bắt đầu..." });
    setError(undefined);
    try {
      const value =
        nextAction === "crop"
          ? await mediaToolsApi.crop(source.filePath, bounds)
          : nextAction === "demux"
            ? await mediaToolsApi.demux(source.filePath, id)
            : nextAction === "depth"
              ? await mediaToolsApi.depth(
                  source.filePath,
                  { outputStyle: depthStyle, modelSize: "small" },
                  id,
                )
              : await mediaToolsApi.separateStems(
                  source.filePath,
                  stemRole,
                  id,
                );
      setResult(value);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAction(undefined);
      setOperationId(undefined);
      setProgress(undefined);
    }
  };
  const cancel = async () => {
    if (!operationId || !action || action === "crop") return;
    await mediaToolsApi.cancel(action, operationId);
    setAction(undefined);
    setOperationId(undefined);
    setProgress(undefined);
  };

  return (
    <section
      className="source-agent-media-tools"
      aria-labelledby="media-tools-title"
    >
      {action && (
        <div className="source-agent-operation" role="status">
          <span>
            {progress?.stage || action} · {Math.round(progress?.percent || 0)}%
          </span>
          <progress max={100} value={progress?.percent || 0} />
          {action !== "crop" && (
            <Button
              type="button"
              variant="danger"
              onClick={() => void cancel()}
            >
              Hủy
            </Button>
          )}
        </div>
      )}
      <header className="source-agent-media-tools__header">
        <div>
          <small className="source-agent-hero__tag">LOCAL PROCESSING</small>
          <h2 id="media-tools-title">
            <FileVideo2 size={18} />
            Media Tools
          </h2>
          <p>Xử lý âm thanh, hình ảnh và video local bằng FFmpeg.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void selectVideo()}
        >
          <FileVideo2 size={15} />
          Chọn video
        </Button>
      </header>
      <section className="source-agent-audio-tools narra-card">
        <header>
          <div>
            <h3>
              <Music2 size={17} /> Cắt Audio
            </h3>
            <p>Trích xuất đoạn MP3 hoặc cắt ngắn file âm thanh.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void selectAudio()}
          >
            <Music2 size={15} />
            Chọn audio
          </Button>
        </header>
        {audioSource && (
          <div className="source-agent-audio-tools__content">
            <div className="source-agent-audio-tools__meta">
              <code title={audioSource.filePath}>{audioSource.fileName}</code>
              <small>
                {audioSource.duration.toFixed(2)}s ·{" "}
                {audioSource.sampleRate || "—"}
                Hz · {audioSource.channels || "—"} kênh ·{" "}
                {audioSource.bitrate || "—"}
                kbps
              </small>
            </div>
            <div className="source-agent-audio-tools__inputs">
              <div className="source-control-field">
                <span className="source-control-label-text">
                  Bắt đầu (giây)
                </span>
                <Input
                  aria-label="Audio trim start"
                  type="number"
                  min={0}
                  max={audioSource.duration}
                  step={0.1}
                  value={audioRange.start}
                  onChange={(event) =>
                    setAudioRange((current) => ({
                      ...current,
                      start: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="source-control-field">
                <span className="source-control-label-text">
                  Kết thúc (giây)
                </span>
                <Input
                  aria-label="Audio trim end"
                  type="number"
                  min={0}
                  max={audioSource.duration}
                  step={0.1}
                  value={audioRange.end}
                  onChange={(event) =>
                    setAudioRange((current) => ({
                      ...current,
                      end: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={
                  audioTrimming ||
                  audioRange.end <= audioRange.start ||
                  audioRange.end > audioSource.duration
                }
                onClick={() => void trimAudio()}
              >
                {audioTrimming ? "Đang xử lý..." : "Cắt audio"}
              </Button>
            </div>
          </div>
        )}
      </section>
      {!source ? (
        <div className="source-generation-empty">
          <FileVideo2 size={30} />
          <p>
            Chọn một video local để cắt khung, tạo depth map hoặc tách âm thanh.
          </p>
        </div>
      ) : (
        <div className="source-agent-media-tools__layout">
          <section className="narra-card">
            <h3>{source.fileName}</h3>
            <code title={source.filePath}>{source.filePath}</code>
            <div className="source-agent-media-tools__group">
              <h3>
                <Crop size={17} />
                Cắt khung video (Crop)
              </h3>
              <div className="source-agent-media-tools__grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <div key={key} className="source-control-field">
                    <span className="source-control-label-text">
                      {key.toUpperCase()}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      value={bounds[key]}
                      onChange={(event) =>
                        setBounds((current) => ({
                          ...current,
                          [key]: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={
                  Boolean(action) || bounds.width < 2 || bounds.height < 2
                }
                onClick={() => void run("crop")}
              >
                <Crop size={14} />
                Cắt khung (Crop)
              </Button>
            </div>
            <div className="source-agent-media-tools__group">
              <h3>
                <ScanSearch size={17} />
                Depth Anything (Bản đồ độ sâu)
              </h3>
              <div className="source-control-field">
                <span className="source-control-label-text">Kiểu output</span>
                <Select
                  value={depthStyle}
                  onValueChange={(val) =>
                    setDepthStyle(val as typeof depthStyle)
                  }
                >
                  <SelectTrigger aria-label="Kiểu output">
                    <SelectValue placeholder="Chọn kiểu output" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grayscale">Grayscale</SelectItem>
                    <SelectItem value="heatmap">Heatmap</SelectItem>
                    <SelectItem value="side-by-side">Side by side</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={Boolean(action)}
                onClick={() => void run("depth")}
              >
                <ScanSearch size={14} />
                Tạo depth map
              </Button>
            </div>
            <div className="source-agent-media-tools__group">
              <h3>
                <Music2 size={17} />
                Tách âm thanh &amp; Vocals
              </h3>
              <div className="source-agent-media-tools__actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(action)}
                  onClick={() => void run("demux")}
                >
                  <Music2 size={14} />
                  Tách riêng Audio
                </Button>
                <div className="source-control-field" style={{ minWidth: 180 }}>
                  <span className="source-control-label-text">Thành phần</span>
                  <Select
                    value={stemRole}
                    onValueChange={(val) => setStemRole(val as typeof stemRole)}
                  >
                    <SelectTrigger aria-label="Thành phần">
                      <SelectValue placeholder="Chọn thành phần" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vocals">Giọng nói (Vocals)</SelectItem>
                      <SelectItem value="background">
                        Nhạc nền (Background)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={Boolean(action)}
                  onClick={() => void run("stems")}
                >
                  <Layers3 size={14} />
                  Tách stem
                </Button>
              </div>
            </div>
          </section>
          <section className="narra-card source-agent-media-tools__result">
            <h3>Kết quả</h3>
            {action ? (
              <p role="status">Đang xử lý {action}…</p>
            ) : error ? (
              <p role="alert" className="source-generation-error">
                {error}
              </p>
            ) : result ? (
              <pre>{JSON.stringify(result, null, 2)}</pre>
            ) : (
              <p className="narra-helper-text">
                Đường dẫn và metadata output sẽ hiển thị tại đây.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
