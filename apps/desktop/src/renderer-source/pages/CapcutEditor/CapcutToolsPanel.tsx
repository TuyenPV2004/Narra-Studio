import {
  AudioLines,
  FolderOpen,
  ScanLine,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { editorApi, type EditorClip } from "@/services/electron-api/editor";

interface CapcutToolsPanelProps {
  clip: EditorClip;
  onMediaReady?: (path: string, type: "audio" | "video", name: string) => void;
  onDeflicker?: (suggestion: {
    mode: "flashlight" | "timelapse";
    level: "weak" | "recommended" | "strong";
  }) => void;
  onLipSyncChange?: (config: Record<string, unknown>) => void;
}

const message = (value: unknown) =>
  value instanceof Error ? value.message : String(value);

export function CapcutToolsPanel({
  clip,
  onDeflicker,
  onLipSyncChange,
  onMediaReady,
}: CapcutToolsPanelProps) {
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [ollamaReady, setOllamaReady] = useState<boolean>();
  const [speechText, setSpeechText] = useState("");
  const [voiceId, setVoiceId] = useState("vi_VN-vais1000-medium");
  const [audioSource, setAudioSource] = useState("");
  const [resultPath, setResultPath] = useState("");
  const [keepBackground, setKeepBackground] = useState(true);

  useEffect(() => {
    let current = true;
    void editorApi
      .ollamaReady()
      .then((ready) => {
        if (current) setOllamaReady(ready);
      })
      .catch(() => {
        if (current) setOllamaReady(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setError(undefined);
    setStatus(undefined);
    try {
      await action();
    } catch (value) {
      setError(message(value));
    } finally {
      setBusyAction(undefined);
    }
  };

  const extractAudio = () =>
    run("extract", async () => {
      const path = await editorApi.extractAudio(clip.path);
      setAudioSource(path);
      setResultPath(path);
      setStatus("Đã tách audio WAV từ clip.");
      onLipSyncChange?.({ mode: "audio", audioPath: path, status: "ready" });
      onMediaReady?.(path, "audio", `Audio - ${clip.name}`);
    });
  const analyzeDeflicker = () =>
    run("deflicker", async () => {
      const suggestion = await editorApi.suggestDeflicker(clip);
      onDeflicker?.({ mode: suggestion.mode, level: suggestion.level });
      setStatus(
        `Đề xuất ${suggestion.mode} / ${suggestion.level} · ${Math.round(suggestion.confidence)}%${suggestion.reason ? ` — ${suggestion.reason}` : ""}`,
      );
    });
  const generateSpeech = () =>
    run("speech", async () => {
      const path = await editorApi.textToSpeech(
        speechText.trim(),
        voiceId.trim(),
      );
      setAudioSource(path);
      setResultPath(path);
      setStatus("Đã tạo audio giọng đọc.");
      onLipSyncChange?.({
        mode: "text",
        text: speechText.trim(),
        voiceId: voiceId.trim(),
        voiceProvider: "local-piper",
        generatedAudioPath: path,
        generatedAt: new Date().toISOString(),
        status: "ready",
      });
      onMediaReady?.(path, "audio", "Giọng đọc AI");
    });
  const lipSync = () =>
    run("lip-sync", async () => {
      const path = await editorApi.lipSync(clip, audioSource, keepBackground);
      setResultPath(path);
      setStatus("Đã tạo video Lip sync.");
      onLipSyncChange?.({
        mode: speechText.trim() ? "text" : "audio",
        text: speechText.trim(),
        voiceId: voiceId.trim(),
        audioPath: audioSource,
        keepBgSound: keepBackground,
        renderOutputUrl: path,
        renderProgress: 100,
        renderPlayable: true,
        renderCompletedAt: Date.now(),
        status: "done",
      });
      onMediaReady?.(path, "video", `Lip sync - ${clip.name}`);
    });

  return (
    <details className="source-capcut-tools">
      <summary>
        <WandSparkles size={16} />
        Công cụ clip
      </summary>
      <div className="source-capcut-tools__body">
        <section aria-labelledby="capcut-audio-tools">
          <h3 id="capcut-audio-tools">
            <AudioLines size={15} />
            Audio
          </h3>
          <Button
            variant="secondary"
            disabled={Boolean(busyAction) || clip.trackType === "audio"}
            onClick={() => void extractAudio()}
          >
            {busyAction === "extract" ? "Đang tách…" : "Tách audio WAV"}
          </Button>
        </section>
        <section aria-labelledby="capcut-deflicker-tools">
          <h3 id="capcut-deflicker-tools">
            <ScanLine size={15} />
            Khử nhấp nháy AI
          </h3>
          <p>
            {ollamaReady === undefined
              ? "Đang kiểm tra cấu hình…"
              : ollamaReady
                ? "Ollama đã sẵn sàng."
                : "Cần cấu hình Ollama trong Cài đặt."}
          </p>
          <Button
            variant="secondary"
            disabled={
              Boolean(busyAction) || !ollamaReady || clip.trackType === "audio"
            }
            onClick={() => void analyzeDeflicker()}
          >
            {busyAction === "deflicker" ? "Đang phân tích…" : "Phân tích clip"}
          </Button>
        </section>
        <section aria-labelledby="capcut-voice-tools">
          <h3 id="capcut-voice-tools">
            <Sparkles size={15} />
            Giọng đọc & Lip sync
          </h3>
          <label>
            Nội dung giọng đọc
            <textarea
              aria-label="Nội dung giọng đọc Lip sync"
              rows={3}
              value={speechText}
              onChange={(event) => setSpeechText(event.target.value)}
            />
          </label>
          <label>
            Voice ID
            <input
              aria-label="Voice ID Lip sync"
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={
              Boolean(busyAction) || !speechText.trim() || !voiceId.trim()
            }
            onClick={() => void generateSpeech()}
          >
            {busyAction === "speech" ? "Đang tạo…" : "Tạo giọng đọc local"}
          </Button>
          {busyAction === "speech" && (
            <Button
              variant="danger"
              onClick={() => void editorApi.cancelTextToSpeech()}
            >
              Hủy tạo giọng đọc
            </Button>
          )}
          <label>
            Audio cho Lip sync
            <input
              aria-label="Audio nguồn Lip sync"
              value={audioSource}
              onChange={(event) => setAudioSource(event.target.value)}
              placeholder="Đường dẫn local hoặc URL"
            />
          </label>
          <label className="source-capcut-tools__check">
            <input
              type="checkbox"
              checked={keepBackground}
              onChange={(event) => setKeepBackground(event.target.checked)}
            />
            Giữ âm thanh nền
          </label>
          <Button
            disabled={
              Boolean(busyAction) ||
              !audioSource.trim() ||
              clip.trackType === "audio"
            }
            onClick={() => void lipSync()}
          >
            {busyAction === "lip-sync" ? "Đang đồng bộ…" : "Tạo Lip sync"}
          </Button>
        </section>
        {status && (
          <p role="status" className="source-capcut-tools__status">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
        {resultPath && (
          <Button
            variant="ghost"
            onClick={() => void editorApi.showInFolder(resultPath)}
          >
            <FolderOpen size={15} />
            Mở trong thư mục
          </Button>
        )}
      </div>
    </details>
  );
}
