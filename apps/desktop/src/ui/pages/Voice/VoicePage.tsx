import {
  AudioLines,
  Check,
  CircleX,
  Clock4,
  Copy,
  FolderOpen,
  Inbox,
  Mars,
  MicAudioLines,
  RefreshCw,
  Trash2,
  Upload,
  User,
  Venus,
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
import { CountryFlag } from "@/components/ui/CountryFlag";
import {
  XTTS_DEFAULT_SPEAKERS,
  XTTS_LANGUAGES,
  XTTS_PRESET_VOICES,
  voiceApi,
  type XttsPresetVoice,
  type XttsVoiceMode,
  type XttsVoiceReference,
  type XttsVoiceStatus,
} from "@/services/electron-api";
import { getElectronApi } from "@/services/electron-api/client";
import {
  useVoiceQueue,
  type VoiceQueueTask,
} from "@/pages/Voice/useVoiceQueue";
import { VoiceAudioCard } from "@/components/audio/VoiceAudioCard";
import { readStorageJson, writeStorageValue } from "@/storage/safe-storage";
import { storageKeys } from "@/storage/keys";

const presetVoiceByName = new Map<string, XttsPresetVoice>(
  XTTS_PRESET_VOICES.map((voice) => [voice.name, voice]),
);
const languageById = new Map<string, { id: string; label: string }>(
  XTTS_LANGUAGES.map((item) => [item.id, item]),
);

interface VoiceDraft {
  language: string;
  mode: XttsVoiceMode;
  references: XttsVoiceReference[];
  speaker: string;
  speed: number;
  taskName: string;
  text: string;
}

function readVoiceDraft(): VoiceDraft {
  const stored = readStorageJson<Partial<VoiceDraft>>(
    storageKeys.voiceDraft,
    {},
  );
  const references = Array.isArray(stored.references)
    ? stored.references
        .filter((item): item is XttsVoiceReference =>
          Boolean(
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.localPath === "string" &&
            typeof item.fileUrl === "string",
          ),
        )
        .slice(0, 5)
    : [];
  const speed = Number(stored.speed);
  return {
    language: typeof stored.language === "string" ? stored.language : "en",
    mode: stored.mode === "clone" ? "clone" : "preset",
    references,
    speaker:
      typeof stored.speaker === "string"
        ? stored.speaker
        : (XTTS_DEFAULT_SPEAKERS[0] ?? ""),
    speed: Number.isFinite(speed) && speed >= 0.5 && speed <= 2 ? speed : 1,
    taskName:
      typeof stored.taskName === "string" ? stored.taskName.slice(0, 80) : "",
    text: typeof stored.text === "string" ? stored.text.slice(0, 20000) : "",
  };
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function taskProgressLabel(
  progress:
    | {
        completedSegments: number;
        event: string;
        resumedSegments: number;
        segmentIndex: number;
        totalSegments: number;
      }
    | undefined,
  startedAt: number | undefined,
  now: number,
) {
  const elapsed = startedAt ? ` · ${formatElapsed(now - startedAt)}` : "";
  if (!progress?.totalSegments) return `Đang nạp model local${elapsed}`;
  const resume = progress.resumedSegments
    ? ` · tiếp tục từ ${progress.resumedSegments} đoạn`
    : "";
  if (progress.event === "segment_started" && progress.segmentIndex > 0) {
    return `Đang xử lý đoạn ${progress.segmentIndex}/${progress.totalSegments}${resume}${elapsed}`;
  }
  return `Đã tạo ${progress.completedSegments}/${progress.totalSegments} đoạn${resume}${elapsed}`;
}

function PresetVoiceLabel({ voice }: { voice: XttsPresetVoice }) {
  const isFemale = voice.gender === "female";
  const GenderIcon = isFemale ? Venus : Mars;
  const genderLabel = isFemale ? "nữ" : "nam";

  return (
    <span
      className="source-voice-preset-option"
      aria-label={`${voice.name}, giọng ${genderLabel}, phù hợp ${voice.useCases.join(", ")}`}
      title={`${voice.name} – ${voice.useCases.join(", ")}`}
    >
      <GenderIcon
        size={16}
        className={`source-voice-preset-option__gender source-voice-preset-option__gender--${voice.gender}`}
        aria-hidden="true"
      />
      <span className="source-voice-preset-option__name">{voice.name}</span>
      <span
        className="source-voice-preset-option__separator"
        aria-hidden="true"
      >
        –
      </span>
      <span className="source-voice-preset-option__uses">
        {voice.useCases.join(", ")}
      </span>
    </span>
  );
}

export function VoicePage() {
  const queue = useVoiceQueue();
  const initialDraft = useMemo(readVoiceDraft, []);
  const [text, setText] = useState(initialDraft.text);
  const [taskName, setTaskName] = useState(initialDraft.taskName);
  const [mode, setMode] = useState<XttsVoiceMode>(initialDraft.mode);
  const [speaker, setSpeaker] = useState(initialDraft.speaker);
  const [references, setReferences] = useState<XttsVoiceReference[]>(
    initialDraft.references,
  );
  const [language, setLanguage] = useState(initialDraft.language);
  const [speed, setSpeed] = useState(initialDraft.speed);
  const [status, setStatus] = useState<XttsVoiceStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [presetGender, setPresetGender] = useState<"all" | "female" | "male">(
    "all",
  );
  const [now, setNow] = useState(Date.now());

  const releaseDraftReferences = useCallback(
    (items: XttsVoiceReference[]) => {
      const retained = new Set(
        queue.tasks.flatMap((task) => [
          ...(task.snapshot.referencePaths ?? []),
          ...(task.snapshot.referencePath ? [task.snapshot.referencePath] : []),
        ]),
      );
      const releasable = items
        .map((item) => item.localPath)
        .filter((localPath) => !retained.has(localPath));
      if (!releasable.length) return;
      void voiceApi.releaseReferences(releasable).catch(() => {
        toast.error("Không thể xóa file giọng mẫu khỏi thư viện local.");
      });
    },
    [queue.tasks],
  );

  const speakersList = useMemo(
    () =>
      status?.speakers && status.speakers.length > 0
        ? status.speakers
        : XTTS_DEFAULT_SPEAKERS,
    [status?.speakers],
  );
  const languagesList = useMemo(() => {
    const ids = status?.languages?.length
      ? status.languages
      : XTTS_LANGUAGES.map((item) => item.id);
    return ids.map((id) => languageById.get(id) ?? { id, label: id });
  }, [status?.languages]);
  const filteredSpeakers = useMemo(() => {
    return speakersList.filter((name) => {
      const voice = presetVoiceByName.get(name);
      if (presetGender !== "all" && voice?.gender !== presetGender)
        return false;
      return true;
    });
  }, [presetGender, speakersList]);
  const selectedPresetVoice = presetVoiceByName.get(speaker);
  const hasProcessingTask = queue.tasks.some(
    (task) => task.status === "processing",
  );
  const queuedPositionById = useMemo(() => {
    const positions = new Map<string, number>();
    queue.tasks
      .filter((task) => task.status === "queued")
      .reverse()
      .forEach((task, index) => positions.set(task.id, index + 1));
    return positions;
  }, [queue.tasks]);

  useEffect(() => {
    writeStorageValue(
      storageKeys.voiceDraft,
      JSON.stringify({
        language,
        mode,
        references,
        speaker,
        speed,
        taskName,
        text,
      } satisfies VoiceDraft),
    );
  }, [language, mode, references, speaker, speed, taskName, text]);

  useEffect(() => {
    if (!hasProcessingTask) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasProcessingTask]);

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

  useEffect(() => {
    if (!languagesList.some((item) => item.id === language)) {
      setLanguage(languagesList[0]?.id ?? "en");
    }
  }, [language, languagesList]);

  useEffect(() => {
    if (!hasProcessingTask) return;
    void voiceApi
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, [hasProcessingTask]);

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

  const removeReference = useCallback(
    (reference: XttsVoiceReference) => {
      setReferences((current) =>
        current.filter((item) => item.localPath !== reference.localPath),
      );
      releaseDraftReferences([reference]);
    },
    [releaseDraftReferences],
  );

  const changeMode = useCallback(
    (value: string) => {
      const nextMode: XttsVoiceMode = value === "clone" ? "clone" : "preset";
      if (nextMode === "preset" && references.length > 0) {
        releaseDraftReferences(references);
        setReferences([]);
        toast.info("Đã bỏ các file mẫu không còn dùng cho chế độ dựng sẵn.");
      }
      setMode(nextMode);
    },
    [references, releaseDraftReferences],
  );

  const showTaskInFolder = useCallback(async (localPath: string) => {
    try {
      await voiceApi.showInFolder(localPath);
    } catch (error) {
      toast.error(
        "Không thể mở file giọng đọc: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }, []);

  const retryTask = useCallback(
    (taskId: string) => {
      if (!queue.retry(taskId)) {
        toast.error("Hàng đợi đã đầy (tối đa 20 tác vụ).");
        return;
      }
      toast.success("Đã đưa tác vụ vào cuối hàng đợi chờ.");
    },
    [queue],
  );

  const removeTask = useCallback(
    async (task: VoiceQueueTask) => {
      try {
        await queue.remove(task);
      } catch (error) {
        toast.error(
          "Không thể dừng hoặc xóa tác vụ: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    },
    [queue],
  );

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
      ...(mode === "preset" && speaker ? { speaker } : {}),
      speed,
      ...(mode === "clone" && references.length > 0
        ? { referencePaths: references.map((item) => item.localPath) }
        : {}),
    });
    if (!accepted) {
      toast.error("Hàng đợi đã đầy (tối đa 20 tác vụ).");
      return;
    }
    setText("");
    setTaskName("");
    setReferences([]);
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
            Chuyển đổi văn bản thành giọng đọc tự nhiên và nhân bản giọng nói
            với AI.
          </p>
        </div>
      </header>

      {!status?.installed && !checking && (
        <div className="source-generation-error" role="alert">
          <p>
            XTTS-v2 chưa sẵn sàng. Hãy khởi động lại ứng dụng và kiểm tra log
            XTTS-V2 để xác định runtime hoặc model còn thiếu.
            {status?.reason ? " Runtime đã trả về trạng thái lỗi." : ""}
          </p>
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

        <aside className="source-voice-settings" aria-label="Cài đặt giọng nói">
          <div className="source-voice-field">
            <span id="voice-mode-label" className="source-voice-field__label">
              Chế độ <span className="source-required-mark">*</span>
            </span>
            <Select value={mode} onValueChange={changeMode}>
              <SelectTrigger aria-labelledby="voice-mode-label">
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
              <span
                id="voice-preset-label"
                className="source-voice-field__label"
              >
                Giọng dựng sẵn <span className="source-required-mark">*</span>
              </span>
              <div className="source-voice-preset-tools">
                <div
                  className="source-voice-gender-filter"
                  role="group"
                  aria-label="Lọc giới tính giọng dựng sẵn"
                >
                  {(
                    [
                      ["all", "Tất cả"],
                      ["female", "Nữ"],
                      ["male", "Nam"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={presetGender === value}
                      onClick={() => setPresetGender(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Select value={speaker} onValueChange={setSpeaker}>
                <SelectTrigger
                  className="source-voice-preset-trigger"
                  aria-labelledby="voice-preset-label"
                >
                  <SelectValue placeholder="Chọn giọng dựng sẵn">
                    {selectedPresetVoice ? (
                      <PresetVoiceLabel voice={selectedPresetVoice} />
                    ) : (
                      speaker || undefined
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="source-voice-preset-content">
                  {filteredSpeakers.map((name: string) => {
                    const voice = presetVoiceByName.get(name);
                    return (
                      <SelectItem key={name} value={name}>
                        {voice ? <PresetVoiceLabel voice={voice} /> : name}
                      </SelectItem>
                    );
                  })}
                  {filteredSpeakers.length === 0 && (
                    <div className="source-voice-preset-empty">
                      Không có giọng phù hợp.
                    </div>
                  )}
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
              <p className="source-voice-field__hint">
                Chọn 1–5 bản ghi của cùng một người. Hỗ trợ WAV, MP3, FLAC, OGG
                và M4A; tổng dung lượng tối đa 100 MB.
              </p>
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
                        onClick={() => removeReference(reference)}
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
            <span
              id="voice-language-label"
              className="source-voice-field__label"
            >
              Ngôn ngữ <span className="source-required-mark">*</span>
            </span>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger aria-labelledby="voice-language-label">
                <SelectValue>
                  {(() => {
                    const selected = languagesList.find(
                      (item) => item.id === language,
                    );
                    if (!selected) return undefined;
                    return (
                      <span className="source-voice-language-option">
                        <CountryFlag
                          code={selected.id}
                          width={20}
                          height={14}
                        />
                        <span>{selected.label}</span>
                      </span>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languagesList.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span className="source-voice-language-option">
                      <CountryFlag code={item.id} width={20} height={14} />
                      <span>{item.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="source-voice-field">
            <span className="source-voice-field__label">
              Tốc độ <span className="source-required-mark">*</span>
            </span>
            <div className="source-voice-speed-slider">
              <div className="source-voice-speed-slider__labels">
                <span>Chậm</span>
                <span>Nhanh</span>
              </div>
              <div className="source-voice-speed-slider__track-wrapper">
                <div
                  className="source-voice-speed-slider__tooltip"
                  style={{
                    left: `calc(8px + (100% - 16px) * ${(speed - 0.5) / 1.5})`,
                  }}
                >
                  {speed.toFixed(1)}
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  className="source-voice-speed-input"
                  style={{
                    background: `linear-gradient(to right, #18181b 0%, #18181b ${((speed - 0.5) / 1.5) * 100}%, #e4e4e7 ${((speed - 0.5) / 1.5) * 100}%, #e4e4e7 100%)`,
                  }}
                  aria-label="Tốc độ đọc"
                />
              </div>
            </div>
          </div>
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
                  <VoiceAudioCard src={task.fileUrl} filename={task.filename} />
                ) : (
                  <div className="source-image-task-placeholder source-voice-task-placeholder">
                    {task.status === "processing" ? (
                      <div className="source-processing-percent-box">
                        <Clock4
                          size={20}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                        <span className="source-processing-estimate-label">
                          {taskProgressLabel(
                            task.progress,
                            task.startedAt,
                            now,
                          )}
                        </span>
                      </div>
                    ) : task.status === "error" ? (
                      <div className="source-error-icon-box">
                        <CircleX
                          size={20}
                          className="source-error-icon"
                          aria-hidden="true"
                        />
                        <span className="source-processing-estimate-label">
                          Tạo giọng đọc thất bại
                        </span>
                      </div>
                    ) : (
                      <div className="source-queued-icon-box">
                        <Clock4
                          size={20}
                          className="source-clock-ticking"
                          aria-hidden="true"
                        />
                        <span className="source-processing-estimate-label">
                          Đang chờ · vị trí{" "}
                          {queuedPositionById.get(task.id) ?? 1}
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
                      <span className="source-task-ref-badge" title="Giọng đọc">
                        <User size={11} aria-hidden="true" />
                        {task.snapshot.mode === "clone"
                          ? "Nhân bản"
                          : task.snapshot.speaker || "Giọng đọc"}
                      </span>
                      <span className="source-task-slot-badge">
                        {languagesList.find(
                          (l) => l.id === task.snapshot.language,
                        )?.label || task.snapshot.language}{" "}
                        • {task.snapshot.speed.toFixed(1)}
                      </span>
                    </div>
                  </header>

                  <div className="source-voice-task-body">
                    {task.snapshot.taskName && (
                      <p
                        className="source-task-prompt-text source-voice-task-name"
                        title={task.snapshot.taskName}
                      >
                        <strong className="source-task-prompt-label">
                          Tác vụ:{" "}
                        </strong>
                        {task.snapshot.taskName}
                      </p>
                    )}
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
                        onClick={() => void showTaskInFolder(task.localPath!)}
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
                        onClick={() => retryTask(task.id)}
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
                      onClick={() => void removeTask(task)}
                      title={
                        task.status === "processing"
                          ? "Dừng tác vụ đang tạo"
                          : task.status === "queued"
                            ? "Bỏ tác vụ khỏi hàng đợi"
                            : "Xóa tác vụ này"
                      }
                    >
                      {task.status === "processing" ? (
                        <X
                          size={14}
                          className="source-action-icon--cancel"
                          aria-hidden="true"
                        />
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
