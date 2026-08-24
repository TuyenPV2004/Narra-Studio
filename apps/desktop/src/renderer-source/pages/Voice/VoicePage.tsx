import {
  AudioLines,
  FolderOpen,
  Inbox,
  MicAudioLines,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import {
  XTTS_LANGUAGES,
  voiceApi,
  type XttsVoiceMode,
  type XttsVoiceReference,
  type XttsVoiceStatus,
} from "@/services/electron-api";
import { useVoiceQueue } from "@/pages/Voice/useVoiceQueue";

export function VoicePage() {
  const queue = useVoiceQueue();
  const [text, setText] = useState("");
  const [taskName, setTaskName] = useState("");
  const [mode, setMode] = useState<XttsVoiceMode>("preset");
  const [speaker, setSpeaker] = useState("");
  const [reference, setReference] = useState<XttsVoiceReference | null>(null);
  const [language, setLanguage] = useState("en");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<XttsVoiceStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [preparing, setPreparing] = useState(false);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await voiceApi.status());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!speaker && status?.speakers?.[0]) setSpeaker(status.speakers[0]);
  }, [speaker, status?.speakers]);

  const prepare = useCallback(async () => {
    setPreparing(true);
    try {
      const nextStatus = await voiceApi.prepare();
      setStatus(nextStatus);
      toast.success("Đã cài đặt XTTS-v2.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPreparing(false);
    }
  }, []);

  const chooseReference = useCallback(async () => {
    try {
      const selected = await voiceApi.importReference();
      if (selected) setReference(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const canGenerate =
    Boolean(status?.installed && taskName.trim() && text.trim()) &&
    (mode !== "preset" || Boolean(speaker)) &&
    (mode !== "clone" || Boolean(reference));

  const generate = useCallback(() => {
    if (!canGenerate) return;
    const accepted = queue.enqueue({
      taskName: taskName.trim(),
      text: text.trim(),
      mode,
      language,
      ...(speaker ? { speaker } : {}),
      speed,
      ...(reference ? { referencePath: reference.localPath } : {}),
    });
    if (!accepted) {
      toast.error("Hàng đợi đã đầy (tối đa 20 tác vụ).");
      return;
    }
    setText("");
    setTaskName("");
    toast.success("Đã thêm tác vụ XTTS-v2 vào hàng đợi.");
  }, [
    canGenerate,
    language,
    mode,
    queue,
    reference,
    speaker,
    speed,
    taskName,
    text,
  ]);

  return (
    <section
      className="source-voice-page"
      aria-labelledby="voice-title"
      data-loading={checking}
    >
      <header className="source-voice-hero">
        <span className="source-voice-hero__icon">
          <MicAudioLines size={28} aria-hidden="true" />
        </span>
        <div>
          <h1 id="voice-title">Giọng nói</h1>
          <p>
            Tạo giọng đọc local bằng XTTS-v2 — không dùng credit Google Flow.
          </p>
        </div>
      </header>

      {!status?.installed && !checking && (
        <div className="source-generation-error" role="status">
          <p>
            XTTS-v2 chưa sẵn sàng. Trình cài sẽ tải model và runtime Python
            local; toàn bộ model chạy trên CUDA khi khả dụng, nếu không sẽ chạy
            trên CPU.
          </p>
          <Button onClick={() => void prepare()} disabled={preparing}>
            <RefreshCw size={15} className={preparing ? "spin" : ""} />
            {preparing ? "Đang cài đặt..." : "Cài XTTS-v2"}
          </Button>
        </div>
      )}

      <div className="source-voice-workbench">
        <section className="source-voice-editor">
          <label className="source-voice-field">
            <span className="source-voice-field__label">
              Tên tác vụ <span className="source-required-mark">*</span>
            </span>
            <input
              value={taskName}
              maxLength={80}
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
              maxLength={20000}
              onChange={(event) => setText(event.target.value)}
              placeholder="Nhập nội dung bạn muốn chuyển thành giọng đọc..."
              aria-label="Nội dung văn bản"
            />
          </label>
          <div className="source-voice-editor__footer">
            <span>{text.length}/20000 ký tự</span>
            <Button disabled={!canGenerate} onClick={generate}>
              <AudioLines size={16} />
              Tạo giọng đọc
            </Button>
          </div>
        </section>

        <aside className="source-voice-settings" aria-label="Cài đặt XTTS-v2">
          <div className="source-control-card__heading">
            <h2>XTTS-v2 local</h2>
          </div>
          <div className="source-voice-field">
            <span className="source-voice-field__label">Chế độ</span>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as XttsVoiceMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preset">Giọng dựng sẵn</SelectItem>
                <SelectItem value="clone">Nhân bản giọng</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "preset" && (
            <div className="source-voice-field">
              <span className="source-voice-field__label">Giọng dựng sẵn</span>
              <Select value={speaker} onValueChange={setSpeaker}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn giọng" />
                </SelectTrigger>
                <SelectContent>
                  {(status?.speakers || []).map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "clone" && (
            <Button variant="secondary" onClick={() => void chooseReference()}>
              <Upload size={15} />
              {reference ? reference.name : "Chọn giọng mẫu"}
            </Button>
          )}
          <div className="source-voice-field">
            <span className="source-voice-field__label">Ngôn ngữ</span>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {XTTS_LANGUAGES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="source-voice-field">
            <span className="source-voice-field__label">
              Tốc độ: {speed.toFixed(1)}×
            </span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </label>
        </aside>
      </div>

      <section className="source-voice-history">
        <header>
          <h2>Hàng đợi và lịch sử</h2>
          <span>{queue.tasks.length}</span>
        </header>
        {queue.tasks.length === 0 ? (
          <div className="source-generation-empty source-voice-empty">
            <span className="source-voice-empty__icon">
              <Inbox size={34} aria-hidden="true" />
            </span>
            <p>Chưa có âm thanh.</p>
          </div>
        ) : (
          queue.tasks.map((task) => (
            <article key={task.id} data-status={task.status}>
              <div>
                <strong>{task.snapshot.taskName}</strong>
                <p>{task.snapshot.text}</p>
                <small>
                  {task.status === "queued"
                    ? "Đang chờ"
                    : task.status === "processing"
                      ? "Đang tạo local..."
                      : task.status === "error"
                        ? task.error
                        : task.filename}
                </small>
              </div>
              {task.fileUrl && (
                <audio controls preload="metadata" src={task.fileUrl} />
              )}
              {task.status === "error" && (
                <Button
                  variant="secondary"
                  onClick={() => queue.retry(task.id)}
                >
                  <RefreshCw size={15} />
                  Thử lại
                </Button>
              )}
              {task.localPath && (
                <Button
                  variant="secondary"
                  onClick={() => void voiceApi.showInFolder(task.localPath!)}
                >
                  <FolderOpen size={15} />
                  Mở thư mục
                </Button>
              )}
              <Button
                variant="secondary"
                aria-label={
                  task.status === "processing" ? "Dừng tác vụ" : "Xóa tác vụ"
                }
                onClick={() => void queue.remove(task)}
              >
                {task.status === "processing" ? (
                  <X size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                {task.status === "processing" ? "Dừng" : "Xóa"}
              </Button>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
