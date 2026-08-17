import { Crop, FileVideo2, Layers3, Music2, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
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
            : typeof payload.operationId === "string"
              ? payload.operationId
              : "";
        if (!operationId || id !== operationId) return;
        const value =
          typeof payload.percent === "number"
            ? payload.percent
            : typeof payload.progress === "number"
              ? payload.progress
              : 0;
        setProgress({
          percent: Math.max(0, Math.min(100, value)),
          stage:
            typeof payload.stage === "string" ? payload.stage : "processing",
        });
      }),
    [operationId],
  );

  const selectVideo = async () => {
    setError(undefined);
    const selected = await mediaToolsApi.selectVideo();
    if (selected) setSource(selected);
  };
  const selectAudio = async () => {
    setError(undefined);
    const selected = await mediaToolsApi.selectAudio();
    if (!selected) return;
    setAudioSource(selected);
    setAudioRange({ start: 0, end: selected.duration });
  };
  const trimAudio = async () => {
    if (
      !audioSource ||
      audioTrimming ||
      audioRange.start < 0 ||
      audioRange.end <= audioRange.start ||
      audioRange.end > audioSource.duration
    )
      return;
    setAudioTrimming(true);
    setError(undefined);
    try {
      setResult(
        await mediaToolsApi.trimAudio(
          audioSource,
          audioRange.start,
          audioRange.end,
        ),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAudioTrimming(false);
    }
  };
  const run = async (next: Action) => {
    if (!source || action) return;
    const id = `source-${next}-${Date.now()}`;
    setAction(next);
    setOperationId(id);
    setProgress({ percent: 0, stage: "starting" });
    setError(undefined);
    setResult(undefined);
    try {
      const value =
        next === "crop"
          ? await mediaToolsApi.crop(source.filePath, bounds)
          : next === "depth"
            ? await mediaToolsApi.depth(
                source.filePath,
                { outputStyle: depthStyle, modelSize: "small" },
                id,
              )
            : next === "demux"
              ? await mediaToolsApi.demux(source.filePath, id)
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
    }
  };
  const cancel = async () => {
    if (!action || action === "crop" || !operationId) return;
    try {
      await mediaToolsApi.cancel(action, operationId);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
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
            <Button variant="danger" onClick={() => void cancel()}>
              Hủy
            </Button>
          )}
        </div>
      )}
      <header>
        <div>
          <small>LOCAL PROCESSING</small>
          <h2 id="media-tools-title">
            <FileVideo2 size={19} />
            Media Tools
          </h2>
          <p>
            Các tác vụ chạy trên file local bằng contract FFmpeg/model hiện có.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void selectVideo()}>
          Chọn video
        </Button>
      </header>
      <section className="source-agent-audio-tools narra-card">
        <header>
          <div>
            <h3>
              <Music2 size={17} /> Trim audio
            </h3>
            <p>Đọc metadata bằng FFprobe và xuất đoạn MP3 bằng FFmpeg local.</p>
          </div>
          <Button variant="secondary" onClick={() => void selectAudio()}>
            Chọn audio
          </Button>
        </header>
        {audioSource && (
          <div>
            <div>
              <code title={audioSource.filePath}>{audioSource.fileName}</code>
              <small>
                {audioSource.duration.toFixed(2)}s ·{" "}
                {audioSource.sampleRate || "—"}
                Hz · {audioSource.channels || "—"} kênh ·{" "}
                {audioSource.bitrate || "—"}
                kbps
              </small>
            </div>
            <label>
              Bắt đầu
              <input
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
            </label>
            <label>
              Kết thúc
              <input
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
            </label>
            <Button
              disabled={
                audioTrimming ||
                audioRange.end <= audioRange.start ||
                audioRange.end > audioSource.duration
              }
              onClick={() => void trimAudio()}
            >
              {audioTrimming ? "Đang trim..." : "Trim audio"}
            </Button>
          </div>
        )}
      </section>
      {!source ? (
        <div className="source-generation-empty">
          <FileVideo2 size={30} />
          <p>Chọn một video local để crop, tạo depth map hoặc tách audio.</p>
        </div>
      ) : (
        <div className="source-agent-media-tools__layout">
          <section className="narra-card">
            <h3>{source.fileName}</h3>
            <code title={source.filePath}>{source.filePath}</code>
            <div className="source-agent-media-tools__group">
              <h3>
                <Crop size={17} />
                Crop video
              </h3>
              <div className="source-agent-media-tools__grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {key.toUpperCase()}
                    <input
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
                  </label>
                ))}
              </div>
              <Button
                disabled={
                  Boolean(action) || bounds.width < 2 || bounds.height < 2
                }
                onClick={() => void run("crop")}
              >
                Crop
              </Button>
            </div>
            <div className="source-agent-media-tools__group">
              <h3>
                <ScanSearch size={17} />
                Depth Anything
              </h3>
              <label>
                Kiểu output
                <select
                  value={depthStyle}
                  onChange={(event) =>
                    setDepthStyle(event.target.value as typeof depthStyle)
                  }
                >
                  <option value="grayscale">Grayscale</option>
                  <option value="heatmap">Heatmap</option>
                  <option value="side-by-side">Side by side</option>
                </select>
              </label>
              <Button
                disabled={Boolean(action)}
                onClick={() => void run("depth")}
              >
                Tạo depth map
              </Button>
            </div>
            <div className="source-agent-media-tools__group">
              <h3>
                <Music2 size={17} />
                Tách audio
              </h3>
              <div className="source-agent-media-tools__actions">
                <Button
                  variant="secondary"
                  disabled={Boolean(action)}
                  onClick={() => void run("demux")}
                >
                  Audio + video im lặng
                </Button>
                <label>
                  Stem
                  <select
                    value={stemRole}
                    onChange={(event) =>
                      setStemRole(event.target.value as typeof stemRole)
                    }
                  >
                    <option value="vocals">Giọng nói</option>
                    <option value="background">Âm thanh nền</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  disabled={Boolean(action)}
                  onClick={() => void run("stems")}
                >
                  <Layers3 size={15} />
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
