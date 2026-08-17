import { Download, Mic2, Play, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { voiceApi, type FlowVoice } from "@/services/electron-api";

interface VoiceResult {
  id: string;
  sampleUrl: string;
  text: string;
  voiceName: string;
}

export function VoicePage() {
  const [text, setText] = useState("");
  const [taskName, setTaskName] = useState("");
  const [voices, setVoices] = useState<FlowVoice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [results, setResults] = useState<VoiceResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await voiceApi.listVoices();
      setVoices(next);
      setSelectedId((current) => current || next[0]?.mediaId || "");
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : String(runtimeError),
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const generate = useCallback(async () => {
    const voice = voices.find((item) => item.mediaId === selectedId);
    const dialog = text.trim();
    if (!voice || !dialog || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const output = await voiceApi.generate(dialog, voice);
      setResults((current) => [
        {
          id: output.mediaId,
          sampleUrl: output.sampleUrl,
          text: dialog,
          voiceName: voice.name,
        },
        ...current,
      ]);
    } catch (runtimeError) {
      setError(
        runtimeError instanceof Error
          ? runtimeError.message
          : String(runtimeError),
      );
    } finally {
      setGenerating(false);
    }
  }, [generating, selectedId, text, voices]);

  const save = useCallback(
    async (result: VoiceResult) => {
      setError(null);
      try {
        await voiceApi.save(result.sampleUrl, taskName || result.voiceName);
      } catch (runtimeError) {
        setError(
          runtimeError instanceof Error
            ? runtimeError.message
            : String(runtimeError),
        );
      }
    },
    [taskName],
  );

  return (
    <section
      className="source-voice-page"
      aria-labelledby="voice-title"
      data-loading={loading}
    >
      <header>
        <span>
          <Mic2 size={22} />
        </span>
        <div>
          <small>VOICE STUDIO</small>
          <h1 id="voice-title">Giọng nói</h1>
        </div>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-voice-workbench">
        <section className="source-voice-editor">
          <label className="source-voice-task">
            Tên tác vụ
            <input
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="Tên tác vụ"
            />
          </label>
          <textarea
            value={text}
            maxLength={120}
            onChange={(event) => setText(event.target.value)}
            placeholder="Nhập nội dung bạn muốn chuyển thành giọng đọc..."
            aria-label="Nội dung giọng đọc"
          />
          <div className="source-voice-editor__footer">
            <span>{text.length}/120</span>
            <Button
              disabled={!text.trim() || !selectedId || generating}
              onClick={() => void generate()}
            >
              <Sparkles size={16} />
              {generating ? "Đang tạo..." : "Tạo giọng đọc"}
            </Button>
          </div>
        </section>
        <aside className="source-voice-settings" aria-label="Cài đặt giọng">
          <div className="source-control-card__heading">
            <h2>Google Flow Voice</h2>
            <button
              type="button"
              onClick={() => void loadVoices()}
              aria-label="Làm mới voice"
            >
              <RefreshCw size={15} className={loading ? "is-spinning" : ""} />
            </button>
          </div>
          <label>
            Giọng đọc
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={loading}
            >
              {voices.length ? (
                voices.map((voice) => (
                  <option key={voice.mediaId} value={voice.mediaId}>
                    {voice.name}
                  </option>
                ))
              ) : (
                <option value="">Chưa có voice</option>
              )}
            </select>
          </label>
          {voices.find((voice) => voice.mediaId === selectedId)?.sampleUrl && (
            <audio
              controls
              preload="metadata"
              src={
                voices.find((voice) => voice.mediaId === selectedId)?.sampleUrl
              }
            />
          )}
          <p>
            {voices.find((voice) => voice.mediaId === selectedId)
              ?.description || "Chọn voice có sẵn trong dự án Google Flow."}
          </p>
        </aside>
      </div>
      <section className="source-voice-history">
        <header>
          <h2>Lịch sử phiên này</h2>
          <span>{results.length}</span>
        </header>
        {results.length === 0 ? (
          <div className="source-generation-empty">
            <Play size={28} />
            <p>Chưa có âm thanh.</p>
          </div>
        ) : (
          results.map((result) => (
            <article key={result.id}>
              <div>
                <strong>{taskName || result.voiceName}</strong>
                <p>{result.text}</p>
              </div>
              <audio controls src={result.sampleUrl} />
              <Button variant="secondary" onClick={() => void save(result)}>
                <Download size={15} />
                Tải xuống
              </Button>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
