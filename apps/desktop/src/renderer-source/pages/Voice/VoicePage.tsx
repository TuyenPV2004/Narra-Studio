import {
  AudioLines,
  Download,
  Inbox,
  Info,
  MicAudioLines,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
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
      <header className="source-voice-hero">
        <span className="source-voice-hero__icon">
          <MicAudioLines size={28} aria-hidden="true" />
        </span>
        <div>
          <h1 id="voice-title">Giọng nói</h1>
          <p>Tạo giọng đọc tự nhiên từ văn bản với các mô hình giọng nói AI.</p>
        </div>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-voice-workbench">
        <section className="source-voice-editor">
          <label className="source-voice-field">
            <span className="source-voice-field__label">
              Tên tác vụ <span className="source-required-mark">*</span>
            </span>
            <input
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              placeholder="Nhập tên tác vụ..."
            />
          </label>

          <label className="source-voice-field">
            <span className="source-voice-field__label">
              Nội dung văn bản <span className="source-required-mark">*</span>
            </span>
            <textarea
              value={text}
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
              placeholder="Nhập nội dung bạn muốn chuyển thành giọng đọc..."
              aria-label="Nội dung văn bản"
            />
          </label>

          <div className="source-voice-editor__footer">
            <span>{text.length}/120 ký tự</span>
            <Button
              disabled={!text.trim() || !selectedId || generating}
              onClick={() => void generate()}
            >
              <AudioLines size={16} />
              {generating ? "Đang tạo..." : "Tạo giọng đọc"}
            </Button>
          </div>
        </section>
        <aside className="source-voice-settings" aria-label="Cài đặt giọng">
          <div className="source-control-card__heading">
            <h2>Google Flow Voice</h2>
          </div>
          <div className="source-voice-field">
            <span className="source-voice-field__label">
              Giọng đọc <span className="source-required-mark">*</span>
            </span>
            <Select
              value={selectedId || ""}
              onValueChange={(val) => setSelectedId(val)}
              disabled={loading || !voices.length}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loading
                      ? "Đang tải danh sách voice..."
                      : voices.length
                        ? "Chọn giọng đọc"
                        : "Chưa có voice"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {voices.map((voice) => (
                  <SelectItem key={voice.mediaId} value={voice.mediaId}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {voices.find((voice) => voice.mediaId === selectedId)
            ?.description && (
            <div className="source-voice-desc">
              <span className="source-voice-desc__label">
                <Info size={14} aria-hidden="true" />
                <span>Mô tả :</span>
              </span>
              <span className="source-voice-desc__text">
                {
                  voices.find((voice) => voice.mediaId === selectedId)
                    ?.description
                }
              </span>
            </div>
          )}

          {voices.find((voice) => voice.mediaId === selectedId)?.sampleUrl && (
            <div className="source-voice-player">
              <audio
                controls
                preload="metadata"
                src={
                  voices.find((voice) => voice.mediaId === selectedId)
                    ?.sampleUrl
                }
              />
            </div>
          )}
        </aside>
      </div>
      <section className="source-voice-history">
        <header>
          <h2>Lịch sử phiên này</h2>
          <span>{results.length}</span>
        </header>
        {results.length === 0 ? (
          <div className="source-generation-empty source-voice-empty">
            <span className="source-voice-empty__icon">
              <Inbox size={34} aria-hidden="true" />
            </span>
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
