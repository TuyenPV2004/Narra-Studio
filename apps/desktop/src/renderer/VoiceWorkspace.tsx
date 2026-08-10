import type {ProjectDetail, VoiceWorkspace} from '@narra/project-store';
import {useEffect, useRef, useState} from 'react';
import {Captions, Clock3, Gauge, Mic2, RefreshCw, Sparkles, Upload} from 'lucide-react';
import {formatUiLabel} from './ui-locale';

type Props = {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
};

const formatSeconds = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)}s`;

const narrationUrl = (projectId: string, segmentId: string): string =>
  `narra-media://narration/${encodeURIComponent(projectId)}/${encodeURIComponent(segmentId)}`;

const Waveform = ({src, label}: {src: string; label: string}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = async (): Promise<void> => {
      const response = await fetch(src);
      const bytes = await response.arrayBuffer();
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(bytes);
        if (cancelled) return;
        const samples = audio.getChannelData(0);
        const bars = 72;
        const block = Math.max(1, Math.floor(samples.length / bars));
        const peaks = Array.from({length: bars}, (_, index) => {
          let peak = 0;
          for (let offset = index * block; offset < Math.min(samples.length, (index + 1) * block); offset += 1) {
            peak = Math.max(peak, Math.abs(samples[offset] ?? 0));
          }
          return peak;
        });
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, canvas.clientWidth);
        const height = 72;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        const drawing = canvas.getContext('2d');
        if (!drawing) return;
        drawing.scale(ratio, ratio);
        drawing.clearRect(0, 0, width, height);
        drawing.fillStyle = '#6675d8';
        const gap = 3;
        const barWidth = Math.max(2, width / bars - gap);
        peaks.forEach((peak, index) => {
          const barHeight = Math.max(3, peak * (height - 8));
          drawing.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
        });
      } finally {
        await context.close();
      }
    };
    void draw().catch(() => undefined);
    return () => { cancelled = true; };
  }, [src]);
  return <canvas className="audio-waveform" ref={canvasRef} role="img" aria-label={label} />;
};

export const VoiceWorkspaceView = ({projectId, onProjectRefresh}: Props) => {
  const [workspace, setWorkspace] = useState<VoiceWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('documentary-neutral-us');
  const [speed, setSpeed] = useState(1);
  const [pronunciationNotes, setPronunciationNotes] = useState('');

  const load = async (): Promise<void> => {
    const next = await window.narra.getVoiceWorkspace(projectId);
    setWorkspace(next);
    setSelectedId((current) => current && next.segments.some(({id}) => id === current) ? current : next.segments[0]?.id ?? null);
  };

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải không gian lời đọc.'));
  }, [projectId]);

  const selected = workspace?.segments.find(({id}) => id === selectedId);

  useEffect(() => {
    if (!selected) return;
    setPresetId(selected.generation?.preset ?? 'documentary-neutral-us');
    setSpeed(selected.generation?.speed ?? 1);
    setPronunciationNotes(selected.pronunciationNotes ?? '');
  }, [selected?.id, selected?.version]);

  const run = async (action: () => Promise<VoiceWorkspace | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await action();
      if (next) setWorkspace(next);
      onProjectRefresh(await window.narra.getProject(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác lời đọc không thành công.');
    } finally {
      setBusy(false);
    }
  };

  const generateSelected = (): Promise<void> => run(async () => {
    if (!selected) throw new Error('Hãy chọn một đoạn lời đọc trước.');
    const next = await window.narra.generateNarrationSegment(projectId, {
      segmentId: selected.id,
      presetId,
      speed,
      ...(pronunciationNotes.trim() ? {pronunciationNotes: pronunciationNotes.trim()} : {}),
    });
    setMessage(`Đã tạo ${selected.id} bằng Kokoro trên máy. Hãy nghe duyệt trước khi khớp dòng thời gian.`);
    return next;
  });

  const generateMissing = (): Promise<void> => run(async () => {
    const next = await window.narra.generateMissingNarration(projectId, {presetId, speed});
    setMessage('Đã tạo các đoạn lời đọc còn thiếu âm thanh. Phiên bản của các đoạn hiện có được giữ nguyên.');
    return next;
  });

  if (!workspace) return <div className="voice-empty">Đang tải không gian lời đọc…</div>;

  const warning = workspace.timelineWarnings.find(({sceneId}) => sceneId === selected?.sceneId);
  const issues = workspace.qaIssues.filter(({segmentId}) => segmentId === selectedId);
  const audioReady = workspace.segments.length > 0 && workspace.segments.every(({audioPath, durationSec}) => audioPath && durationSec);

  return (
    <section className="voice-workspace" aria-busy={busy} aria-label="Lời đọc, phụ đề và đồng bộ dòng thời gian">
      <header className="voice-toolbar">
        <div>
          <p>{workspace.segments.length} đoạn · {workspace.captions.length} cue · {workspace.qaIssues.length} vấn đề QA</p>
        </div>
        <div className="voice-actions">
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.syncNarrationSegments(projectId))}><RefreshCw aria-hidden="true" size={16} /> Đồng bộ từ storyboard</button>
          <button className="secondary" disabled={busy || !workspace.runtime.available || workspace.segments.every(({audioPath}) => audioPath)} onClick={() => void generateMissing()}><Sparkles aria-hidden="true" size={16} /> Tạo phần còn thiếu</button>
          <button className="secondary" disabled={busy || workspace.segments.length === 0} onClick={() => void run(() => window.narra.chooseAndImportCaptions(projectId))}><Captions aria-hidden="true" size={16} /> Nhập phụ đề</button>
          <button className="primary" disabled={busy || !audioReady} onClick={() => void run(() => window.narra.fitTimelineToNarration(projectId))}><Clock3 aria-hidden="true" size={16} /> Khớp dòng thời gian</button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Đang cập nhật lời đọc và dòng thời gian…</div>}
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}

      <section className={`voice-runtime-card ${workspace.runtime.available ? 'ready' : 'missing'}`} aria-label="Trạng thái bộ máy giọng đọc cục bộ">
        <Mic2 aria-hidden="true" size={20} />
        <div><strong>{workspace.runtime.available ? 'Kokoro trên máy đã sẵn sàng' : 'Kokoro trên máy cần được thiết lập'}</strong><p>{workspace.runtime.licenseSummary}</p>{!workspace.runtime.available && <small>Còn thiếu: {workspace.runtime.missing.join(', ')}</small>}</div>
        <span className={`health ${workspace.runtime.available ? 'valid' : 'pending'}`}>{workspace.runtime.available ? `Model ${workspace.runtime.modelVersion}` : 'Chưa khả dụng'}</span>
        {!workspace.runtime.available && <code>{workspace.runtime.setupCommand}</code>}
      </section>

      {workspace.segments.length === 0 ? (
        <div className="voice-empty">
          <h3>Chưa có đoạn lời đọc</h3>
          <p>Nhập storyboard, sau đó đồng bộ một đoạn lời đọc có thể chỉnh sửa cho mỗi cảnh.</p>
          <button className="primary" disabled={busy} onClick={() => void run(() => window.narra.syncNarrationSegments(projectId))}>Tạo các đoạn</button>
        </div>
      ) : (
        <div className="voice-columns">
          <nav className="segment-list" aria-label="Các đoạn lời đọc">
            {workspace.segments.map((segment) => {
              const segmentWarning = workspace.timelineWarnings.find(({sceneId}) => sceneId === segment.sceneId);
              const issueCount = workspace.qaIssues.filter(({segmentId}) => segmentId === segment.id).length;
              return (
                <button
                  aria-selected={selectedId === segment.id}
                  className={`segment-row ${selectedId === segment.id ? 'selected' : ''}`}
                  key={segment.id}
                  onClick={() => setSelectedId(segment.id)}
                >
                  <span className="segment-order">VO {String(segment.order + 1).padStart(2, '0')}</span>
                  <strong>{segment.text}</strong>
                  <small>{formatUiLabel(segment.status)} · {formatSeconds(segment.durationSec)}</small>
                  <span className={`timing-state ${(segmentWarning?.kind ?? 'MISSING_AUDIO').toLowerCase()}`}>
                    {issueCount > 0 ? `${issueCount} QA` : segmentWarning ? formatUiLabel(segmentWarning.kind) : 'Thiếu âm thanh'}
                  </span>
                </button>
              );
            })}
          </nav>

          <article className="voice-inspector">
            {selected ? (
              <>
                <header className="inspector-heading">
                  <h3>Đoạn lời đọc · {selected.id}</h3>
                  <span className={`health ${selected.status === 'READY' ? 'valid' : 'pending'}`}>{formatUiLabel(selected.status)}</span>
                </header>

                <section className="narration-copy" aria-label="Nội dung lời đọc">
                  <p>{selected.text}</p>
                  {selected.pronunciationNotes && <small>Phát âm: {selected.pronunciationNotes}</small>}
                </section>

                <section className="voice-generation-card" aria-label="Thiết lập giọng Kokoro">
                  <header><h3>Giọng đọc và cách thể hiện Kokoro</h3><Gauge aria-hidden="true" size={20} /></header>
                  <div className="voice-generation-fields">
                    <label>Mẫu giọng<select value={presetId} onChange={(event) => {
                      const nextId = event.target.value;
                      setPresetId(nextId);
                      const preset = workspace.presets.find(({id}) => id === nextId);
                      if (preset) setSpeed(preset.defaultSpeed);
                    }}>{workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><small>{workspace.presets.find(({id}) => id === presetId)?.description}</small></label>
                    <label>Tốc độ <output>{speed.toFixed(2)}×</output><input aria-label="Tốc độ lời đọc" type="range" min="0.8" max="1.2" step="0.01" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
                  </div>
                  <label>Từ điển phát âm<textarea rows={3} value={pronunciationNotes} onChange={(event) => setPronunciationNotes(event.target.value)} placeholder="Nhập từ và cách đọc theo định dạng từ=cách đọc" /><small>Mỗi dòng dùng một mục <code>từ=cách đọc</code>, hoặc ngăn cách các mục bằng dấu chấm phẩy.</small></label>
                  <div className="voice-generation-actions"><button className="primary" disabled={busy || !workspace.runtime.available} onClick={() => void generateSelected()}><Sparkles aria-hidden="true" size={16} /> {selected.audioPath ? 'Tạo lại đoạn' : 'Tạo đoạn'}</button><span>Chạy hoàn toàn trên máy. Âm thanh cũ chỉ được thay bằng phiên bản mới sau khi tạo thành công.</span></div>
                </section>

                {selected.audioPath ? (
                  <div className="audio-review"><Waveform src={narrationUrl(projectId, selected.id)} label={`Waveform for ${selected.id}`} /><audio className="audio-player" controls preload="metadata" src={narrationUrl(projectId, selected.id)} /></div>
                ) : (
                  <div className="audio-placeholder">Đoạn này chưa có âm thanh.</div>
                )}

                <div className="audio-import-row">
                  <div>
                    <strong>{selected.audioPath ? `Phiên bản âm thanh ${selected.version}` : 'Phương án nhập thủ công'}</strong>
                    <p>Dùng khi âm thanh được thu hoặc tạo bởi một nhà cung cấp khác đã được duyệt.</p>
                  </div>
                  <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportNarrationAudio(projectId, selected.id))}>
                    <Upload aria-hidden="true" size={16} /> {selected.audioPath ? 'Thay âm thanh đoạn' : 'Nhập âm thanh đoạn'}
                  </button>
                </div>

                {selected.generation && (
                  <details className="voice-provenance" open>
                    <summary>Nguồn gốc tạo âm thanh · {selected.generation.model} {selected.generation.modelVersion}</summary>
                    <dl><div><dt>Giọng</dt><dd>{selected.generation.voice}</dd></div><div><dt>Ngôn ngữ</dt><dd>{selected.generation.language}</dd></div><div><dt>Tốc độ</dt><dd>{selected.generation.speed.toFixed(2)}×</dd></div><div><dt>Mục tiêu</dt><dd>{selected.generation.loudnessTargetLufs} LUFS</dd></div></dl>
                    <p>{selected.generation.normalizedText}</p>
                  </details>
                )}

                <dl className="voice-metadata">
                  <div><dt>Dự kiến</dt><dd>{formatSeconds(selected.plannedDurationSec)}</dd></div>
                  <div><dt>Thực tế</dt><dd>{formatSeconds(selected.durationSec)}</dd></div>
                  <div><dt>Codec</dt><dd>{selected.audioMetadata?.audioCodec ?? '—'}</dd></div>
                  <div><dt>Tần số mẫu</dt><dd>{selected.audioMetadata?.sampleRate ? `${selected.audioMetadata.sampleRate} Hz` : '—'}</dd></div>
                  <div><dt>Số kênh</dt><dd>{selected.audioMetadata?.channels ?? '—'}</dd></div>
                  <div><dt>Định dạng chứa</dt><dd>{selected.audioMetadata?.format ?? '—'}</dd></div>
                </dl>

                {warning && (
                  <div className={`timing-warning ${warning.kind.toLowerCase()}`}>
                    <strong>{formatUiLabel(warning.kind)}</strong>
                    <p>{warning.message}</p>
                  </div>
                )}

                {issues.length > 0 && (
                  <section className="voice-qa-list" aria-label="Các vấn đề sai lệch bản chép lời">
                    <h4 className="panel-title">QA bản chép lời</h4>
                    {issues.map((issue) => (
                      <article key={`${issue.segmentId}-${issue.message}`}>
                        <strong>{formatUiLabel(issue.severity)} · khớp {Math.round(issue.similarity * 100)}%</strong>
                        <p>{issue.message}</p>
                      </article>
                    ))}
                  </section>
                )}
              </>
            ) : null}
          </article>
        </div>
      )}

      <section className="caption-summary">
        <h3>SRT, WebVTT hoặc JSON mốc thời gian theo từ</h3>
        <p>JSON theo từ có thể dùng <code>startMs/endMs</code> hoặc <code>start/end</code> theo giây. Đặt <code>timebase: "segment"</code> khi mỗi đoạn bắt đầu từ 0.</p>
      </section>
    </section>
  );
};
