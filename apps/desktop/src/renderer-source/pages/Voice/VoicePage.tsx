import {
  AudioLines,
  Check,
  CircleX,
  Clock4,
  Copy,
  FolderOpen,
  Inbox,
  MicAudioLines,
  RefreshCw,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  XTTS_DEFAULT_SPEAKERS,
  XTTS_LANGUAGES,
  voiceApi,
  type XttsVoiceMode,
  type XttsVoiceReference,
  type XttsVoiceStatus,
} from "@/services/electron-api";
import { getElectronApi } from "@/services/electron-api/client";
import { useVoiceQueue } from "@/pages/Voice/useVoiceQueue";
import { VoiceAudioCard } from "@/components/audio/VoiceAudioCard";

export function VoicePage() {
  const queue = useVoiceQueue();
  const [text, setText] = useState("");
  const [taskName, setTaskName] = useState("");
  const [mode, setMode] = useState<XttsVoiceMode>("preset");
  const [speaker, setSpeaker] = useState<string>(XTTS_DEFAULT_SPEAKERS[0]);
  const [references, setReferences] = useState<XttsVoiceReference[]>([]);
  const [language, setLanguage] = useState("en");
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<XttsVoiceStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const speakersList = useMemo(
    () =>
      status?.speakers && status.speakers.length > 0
        ? status.speakers
        : XTTS_DEFAULT_SPEAKERS,
    [status?.speakers],
  );

  const copyText = useCallback(async (content: string, id: string) => {
    try {
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        await getElectronApi().copyToClipboard(content);
      }
      setCopiedId(id);
      toast.success("Đã sao chép văn bản.");
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      toast.error(
        "Không thể sao chép văn bản: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      const nextStatus = await voiceApi.status();
      setStatus(nextStatus);
      if (nextStatus?.speakers && nextStatus.speakers.length > 0) {
        const defaultSpeaker = nextStatus.speakers[0] || "";
        setSpeaker((current) =>
          current && nextStatus.speakers!.includes(current)
            ? current
            : defaultSpeaker,
        );
      }
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
    if (status?.speakers && status.speakers.length > 0) {
      if (!speaker || !status.speakers.includes(speaker)) {
        setSpeaker(status.speakers[0] || "");
      }
    }
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
      const remaining = 5 - references.length;
      if (remaining <= 0) return;
      const selected = await voiceApi.importReferences(remaining);
      if (selected.length > 0) {
        setReferences((current) => {
          const known = new Set(current.map((item) => item.localPath));
          return [
            ...current,
            ...selected.filter((item) => !known.has(item.localPath)),
          ].slice(0, 5);
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [references.length]);

  const canGenerate =
    Boolean(status?.installed && taskName.trim() && text.trim()) &&
    (mode !== "preset" || Boolean(speaker)) &&
    (mode !== "clone" || references.length > 0);

  const generate = useCallback(() => {
    if (!canGenerate) return;
    const accepted = queue.enqueue({
      taskName: taskName.trim(),
      text: text.trim(),
      mode,
      language,
      ...(speaker ? { speaker } : {}),
      speed,
      ...(references.length > 0
        ? { referencePaths: references.map((item) => item.localPath) }
        : {}),
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
    references,
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
                  <SelectValue placeholder="Chọn giọng dựng sẵn" />
                </SelectTrigger>
                <SelectContent>
                  {speakersList.map((name: string) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "clone" && (
            <div className="source-voice-reference-picker">
              <Button
                variant="secondary"
                disabled={references.length >= 5}
                onClick={() => void chooseReference()}
              >
                <Upload size={15} />
                {references.length > 0
                  ? `Thêm giọng mẫu (${references.length}/5)`
                  : "Chọn giọng mẫu (tối đa 5)"}
              </Button>
              {references.length > 0 && (
                <ul
                  className="source-voice-reference-list"
                  aria-label="Các file giọng mẫu đã chọn"
                >
                  {references.map((reference) => (
                    <li
                      key={reference.localPath}
                      className="source-voice-reference-item"
                    >
                      <span title={reference.name}>{reference.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setReferences((current) =>
                            current.filter(
                              (item) => item.localPath !== reference.localPath,
                            ),
                          )
                        }
                        aria-label={`Bỏ giọng mẫu ${reference.name}`}
                        title="Bỏ giọng mẫu"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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

      <section
        className="source-voice-history"
        aria-label="Hàng đợi và lịch sử giọng nói"
      >
        <header className="source-results-header">
          <div className="source-results-header__title-group">
            <h2>Hàng đợi và kết quả</h2>
            <span className="source-results-count-badge">
              {queue.tasks.length} giọng đọc
            </span>
          </div>
          <div className="source-results-header__actions">
            <button
              type="button"
              className="source-results-header-btn source-results-header-btn--clear"
              disabled={
                !queue.tasks.some(
                  (task) =>
                    task.status === "success" || task.status === "error",
                )
              }
              onClick={queue.clearFinished}
              title="Dọn sạch các tác vụ đã hoàn thành hoặc thất bại"
            >
              <Trash2 size={13} className="source-header-btn-icon--clear" />
              Dọn kết quả
            </button>
          </div>
        </header>

        {queue.tasks.length === 0 ? (
          <div className="source-generation-empty">
            <Inbox size={34} aria-hidden="true" />
            <p>
              Hàng đợi đang trống. Hãy nhập nội dung để bắt đầu tạo giọng đọc.
            </p>
          </div>
        ) : (
          <div className="source-voice-grid">
            {queue.tasks.map((task) => (
              <article
                key={task.id}
                data-status={task.status}
                className="source-image-task-card"
              >
                {task.fileUrl ? (
                  <VoiceAudioCard
                    src={task.fileUrl}
                    filename={task.filename}
                    title={task.snapshot.taskName}
                    subtitle={`${task.snapshot.mode === "preset" ? task.snapshot.speaker || "Giọng đọc" : "Giọng mẫu"} · ${task.snapshot.language.toUpperCase()} · ${task.snapshot.speed.toFixed(1)}×`}
                  />
                ) : (
                  <div className="source-image-task-placeholder source-voice-task-placeholder">
                    {task.status === "processing" ? (
                      <div className="source-processing-percent-box">
                        <Clock4
                          size={30}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                        <span
                          className="source-processing-estimate-label"
                          style={{ marginTop: 4 }}
                        >
                          {task.progress
                            ? `Đã tạo ${task.progress.completedSegments}/${task.progress.totalSegments} đoạn${task.progress.resumedSegments > 0 ? ` · tiếp tục từ ${task.progress.resumedSegments} đoạn` : ""}`
                            : "Đang chuẩn bị giọng đọc local..."}
                        </span>
                      </div>
                    ) : task.status === "error" ? (
                      <div className="source-error-icon-box">
                        <CircleX
                          size={30}
                          className="source-error-icon"
                          aria-hidden="true"
                        />
                      </div>
                    ) : (
                      <div className="source-queued-icon-box">
                        <Clock4
                          size={30}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                        <span
                          className="source-processing-estimate-label"
                          style={{ marginTop: 4 }}
                        >
                          Đang chờ...
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="source-image-task-content">
                  <header className="source-image-task-header">
                    <div className="source-image-task-badges">
                      <span
                        className={`source-task-badge source-task-badge--${task.status}`}
                      >
                        {task.status === "queued"
                          ? "Đang chờ"
                          : task.status === "processing"
                            ? "Đang tạo"
                            : task.status === "success"
                              ? "Hoàn tất"
                              : "Thất bại"}
                      </span>
                      <span className="source-task-aspect-badge" title="Chế độ">
                        {task.snapshot.mode === "preset"
                          ? "Dựng sẵn"
                          : "Nhân bản"}
                      </span>
                      <span className="source-task-ref-badge" title="Giọng đọc">
                        <Volume2 size={11} aria-hidden="true" />
                        {task.snapshot.speaker ||
                          (task.snapshot.mode === "clone"
                            ? "Nhân bản"
                            : "Giọng đọc")}
                      </span>
                      <span className="source-task-slot-badge">
                        {task.snapshot.language.toUpperCase()} •{" "}
                        {task.snapshot.speed.toFixed(1)}×
                      </span>
                    </div>
                  </header>

                  <div className="source-voice-task-body">
                    <p className="source-voice-task-name">
                      <strong>{task.snapshot.taskName}</strong>
                    </p>
                    <p
                      className="source-task-prompt-text"
                      title={task.snapshot.text}
                    >
                      <strong className="source-task-prompt-label">
                        Văn bản:{" "}
                      </strong>
                      {task.snapshot.text}
                    </p>
                  </div>

                  {task.error && (
                    <p className="source-task-error-text" role="alert">
                      {task.error}
                    </p>
                  )}

                  <footer className="source-image-task-actions">
                    {task.localPath && (
                      <button
                        type="button"
                        className="source-task-action-btn"
                        onClick={() =>
                          void voiceApi.showInFolder(task.localPath!)
                        }
                        title="Mở thư mục chứa file âm thanh"
                      >
                        <FolderOpen
                          size={14}
                          className="source-action-icon--folder"
                          aria-hidden="true"
                        />
                        Mở thư mục
                      </button>
                    )}
                    <button
                      type="button"
                      className="source-task-action-btn"
                      onClick={() => void copyText(task.snapshot.text, task.id)}
                      title="Sao chép văn bản"
                    >
                      {copiedId === task.id ? (
                        <Check
                          size={14}
                          className="source-action-icon--check"
                          aria-hidden="true"
                        />
                      ) : (
                        <Copy
                          size={14}
                          className="source-action-icon--copy"
                          aria-hidden="true"
                        />
                      )}
                      Copy
                    </button>
                    {task.status === "error" && (
                      <button
                        type="button"
                        className="source-task-action-btn"
                        onClick={() => queue.retry(task.id)}
                        title="Thử lại"
                      >
                        <RefreshCw
                          size={14}
                          className="source-action-icon--retry"
                          aria-hidden="true"
                        />
                        Thử lại
                      </button>
                    )}
                    <button
                      type="button"
                      className="source-task-action-btn source-task-action-btn--delete"
                      aria-label={
                        task.status === "processing"
                          ? "Dừng tác vụ"
                          : "Xóa tác vụ"
                      }
                      onClick={() => void queue.remove(task)}
                      title={
                        task.status === "processing"
                          ? "Dừng tác vụ đang tạo"
                          : task.status === "queued"
                            ? "Bỏ tác vụ khỏi hàng đợi"
                            : "Xóa tác vụ này"
                      }
                    >
                      {task.status === "processing" ? (
                        <X size={14} aria-hidden="true" />
                      ) : (
                        <Trash2
                          size={14}
                          className="source-action-icon--delete"
                          aria-hidden="true"
                        />
                      )}
                      {task.status === "processing" ? "Dừng" : "Xóa"}
                    </button>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
