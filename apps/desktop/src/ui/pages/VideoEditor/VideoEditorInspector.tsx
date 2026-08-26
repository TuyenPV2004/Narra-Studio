import {
  Captions,
  Droplets,
  Music2,
  Scissors,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import type { VideoEditorProject } from "@/services/electron-api/video-editor";

type InspectorTab = "basic" | "subtitle" | "watermark" | "audio";
interface VideoEditorInspectorProps {
  busy: boolean;
  project: VideoEditorProject;
  transcript: string;
  onChange: (patch: Partial<VideoEditorProject>) => void;
  onDetectWatermark: () => void;
  onGenerateSubtitles: () => void;
  onPickAudio: () => void;
  onPickSubtitle: () => void;
  onRemoveWatermark: (index: number) => void;
  onTranscriptChange: (value: string) => void;
}

export function VideoEditorInspector(props: VideoEditorInspectorProps) {
  const {
    busy,
    onChange,
    onDetectWatermark,
    onGenerateSubtitles,
    onPickAudio,
    onPickSubtitle,
    onRemoveWatermark,
    onTranscriptChange,
    project,
    transcript,
  } = props;
  const [tab, setTab] = useState<InspectorTab>("basic");
  return (
    <aside className="narra-card source-video-editor-inspector">
      <Tabs
        ariaLabel="Công cụ video editor"
        value={tab}
        onChange={setTab}
        options={[
          { value: "basic", label: "Cơ bản", icon: <Scissors size={14} /> },
          { value: "subtitle", label: "Phụ đề", icon: <Captions size={14} /> },
          {
            value: "watermark",
            label: "Watermark",
            icon: <Droplets size={14} />,
          },
          { value: "audio", label: "Âm thanh", icon: <Music2 size={14} /> },
        ]}
      />
      {tab === "basic" && (
        <section>
          <h2>Khoảng cắt và hình ảnh</h2>
          <label>
            Bắt đầu (giây)
            <input
              aria-label="Video editor trim start"
              type="number"
              min={0}
              step={0.1}
              value={project.trimStart}
              onChange={(event) =>
                onChange({ trimStart: Math.max(0, Number(event.target.value)) })
              }
            />
          </label>
          <label>
            Kết thúc (giây)
            <input
              aria-label="Video editor trim end"
              type="number"
              min={0.1}
              step={0.1}
              value={project.trimEnd}
              onChange={(event) =>
                onChange({ trimEnd: Math.max(0, Number(event.target.value)) })
              }
            />
          </label>
          <label>
            <span>
              Tốc độ <output>{project.speed.toFixed(2)}×</output>
            </span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={project.speed}
              onChange={(event) =>
                onChange({ speed: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Xoay
            <select
              value={project.rotate}
              onChange={(event) =>
                onChange({ rotate: Number(event.target.value) })
              }
            >
              <option value={0}>0°</option>
              <option value={90}>90°</option>
              <option value={180}>180°</option>
              <option value={270}>270°</option>
            </select>
          </label>
          <div>
            <Button
              variant="secondary"
              aria-pressed={project.flipH}
              onClick={() => onChange({ flipH: !project.flipH })}
            >
              Lật ngang
            </Button>
            <Button
              variant="secondary"
              aria-pressed={project.flipV}
              onClick={() => onChange({ flipV: !project.flipV })}
            >
              Lật dọc
            </Button>
          </div>
        </section>
      )}
      {tab === "subtitle" && (
        <section>
          <h2>Phụ đề</h2>
          <Button variant="secondary" onClick={onPickSubtitle}>
            Chọn SRT/VTT
          </Button>
          {project.subtitlePath && (
            <p>
              <strong>{project.subtitleName}</strong>
            </p>
          )}
          <label>
            Transcript gợi ý
            <textarea
              rows={4}
              value={transcript}
              onChange={(event) => onTranscriptChange(event.target.value)}
            />
          </label>
          <Button
            disabled={busy || !project.videoSrc}
            onClick={onGenerateSubtitles}
          >
            <WandSparkles size={15} />
            Tạo phụ đề AI
          </Button>
        </section>
      )}
      {tab === "watermark" && (
        <section>
          <h2>Watermark</h2>
          <Button
            disabled={busy || !project.videoSrc}
            onClick={onDetectWatermark}
          >
            <WandSparkles size={15} />
            Phát hiện watermark
          </Button>
          {project.delogoRegions.map((region, index) => (
            <article key={`${region.x}-${region.y}-${index}`}>
              <span>{region.label || `Vùng ${index + 1}`}</span>
              <code>
                {region.x},{region.y} {region.w}×{region.h}
              </code>
              <Button variant="ghost" onClick={() => onRemoveWatermark(index)}>
                Bỏ
              </Button>
            </article>
          ))}
          {!project.delogoRegions.length && (
            <p className="narra-helper-text">Chưa có vùng watermark.</p>
          )}
        </section>
      )}
      {tab === "audio" && (
        <section>
          <h2>Âm thanh</h2>
          <label>
            <span>
              Âm lượng video{" "}
              <output>{Math.round(project.volume * 100)}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={project.volume}
              onChange={(event) =>
                onChange({ volume: Number(event.target.value) })
              }
            />
          </label>
          <Button variant="secondary" onClick={onPickAudio}>
            Chọn nhạc nền
          </Button>
          {project.bgmPath && (
            <p>
              <strong>{project.bgmName}</strong>
            </p>
          )}
          <label>
            <span>
              Âm lượng BGM{" "}
              <output>{Math.round(project.bgmVolume * 100)}%</output>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={project.bgmVolume}
              onChange={(event) =>
                onChange({ bgmVolume: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>
              Fade in <output>{project.fadeIn.toFixed(1)}s</output>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={project.fadeIn}
              onChange={(event) =>
                onChange({ fadeIn: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>
              Fade out <output>{project.fadeOut.toFixed(1)}s</output>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={project.fadeOut}
              onChange={(event) =>
                onChange({ fadeOut: Number(event.target.value) })
              }
            />
          </label>
        </section>
      )}
    </aside>
  );
}
