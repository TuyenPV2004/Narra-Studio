import type {ProjectDetail, TimelineWorkspace} from '@narra/project-store';
import {useEffect, useMemo, useState} from 'react';
import {AudioLines, Captions, CheckCircle2, Clock3, Music2, Save, TriangleAlert, Upload} from 'lucide-react';

const formatTime = (milliseconds: number): string => {
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${(totalSeconds % 60).toFixed(2).padStart(5, '0')}`;
};

export const TimelineWorkspaceView = ({projectId, onProjectRefresh}: {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
}) => {
  const [workspace, setWorkspace] = useState<TimelineWorkspace | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [draft, setDraft] = useState({startMs: 0, endMs: 1, text: ''});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const next = await window.narra.getTimelineWorkspace(projectId);
    setWorkspace(next);
    setSelectedCaptionId((current) => current && next.captions.some(({id}) => id === current) ? current : next.captions[0]?.id ?? null);
  };

  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải dòng thời gian.')); }, [projectId]);
  const selectedCaption = workspace?.captions.find(({id}) => id === selectedCaptionId);
  useEffect(() => {
    if (selectedCaption) setDraft({startMs: selectedCaption.startMs, endMs: selectedCaption.endMs, text: selectedCaption.text});
  }, [selectedCaption?.id, selectedCaption?.startMs, selectedCaption?.endMs, selectedCaption?.text]);

  const durationMs = Math.max(1, (workspace?.durationSec ?? 0) * 1000);
  const errors = workspace?.preflightIssues.filter(({severity}) => severity === 'ERROR') ?? [];
  const audioLayers = useMemo(() => workspace?.assets.filter(({kind, audioRole}) => kind === 'AUDIO' && audioRole) ?? [], [workspace]);

  const run = async (action: () => Promise<TimelineWorkspace | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setWorkspace(next);
      onProjectRefresh(await window.narra.getProject(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác trên dòng thời gian không thành công.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="timeline-empty">Đang tải dòng thời gian…</div>;

  return (
    <section className="timeline-workspace" aria-busy={busy}>
      <header className="timeline-toolbar">
        <div><h3>Lời đọc làm mốc chính · {workspace.durationSec.toFixed(2)} giây</h3><p>Media bám theo thời lượng lời đọc đã duyệt. Âm thanh gốc của video được tắt trừ khi bật riêng cho từng shot.</p></div>
        <div className="actions">
          <button className="secondary" disabled={busy || workspace.segments.some(({durationSec}) => !durationSec)} onClick={() => void run(() => window.narra.generateCaptionsFromNarration(projectId))}><Captions aria-hidden="true" size={16} /> Tạo cue</button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportTimelineAudio(projectId, 'MUSIC'))}><Music2 aria-hidden="true" size={16} /> Thêm nhạc</button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportTimelineAudio(projectId, 'SFX'))}><Upload aria-hidden="true" size={16} /> Thêm hiệu ứng</button>
        </div>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}

      <section className={`preflight-banner ${errors.length ? 'blocked' : 'ready'}`} aria-label="Kiểm tra trước khi kết xuất">
        {errors.length ? <TriangleAlert aria-hidden="true" size={21} /> : <CheckCircle2 aria-hidden="true" size={21} />}
        <div><strong>{errors.length ? `Kết xuất bị chặn bởi ${errors.length} lỗi` : 'Bản dựng thô đã sẵn sàng để kết xuất'}</strong><p>{workspace.preflightIssues.length - errors.length} cảnh báo không chặn · thay đổi chỉ đánh dấu phạm vi kết xuất cần cập nhật.</p></div>
      </section>

      <section className="timeline-ruler" aria-label="Dòng thời gian trực quan của bản dựng thô">
        <header><Clock3 aria-hidden="true" size={16} /><span>0:00</span><span>{formatTime(durationMs / 2)}</span><span>{formatTime(durationMs)}</span></header>
        <div className="timeline-track scenes-track">
          {workspace.scenes.map((scene) => <div key={scene.id} style={{width: `${scene.durationSec / workspace.durationSec * 100}%`}} title={`${scene.title} · ${scene.durationSec.toFixed(2)}s`}><span>{scene.title}</span></div>)}
        </div>
        <div className="timeline-track caption-track">
          {workspace.captions.map((caption) => <button key={caption.id} aria-label={`${caption.id}: ${caption.text}`} className={caption.id === selectedCaptionId ? 'selected' : ''} style={{left: `${caption.startMs / durationMs * 100}%`, width: `${Math.max(0.6, (caption.endMs - caption.startMs) / durationMs * 100)}%`}} onClick={() => setSelectedCaptionId(caption.id)} />)}
        </div>
      </section>

      <div className="timeline-columns">
        <section className="timeline-card">
          <header><h3>{workspace.captions.length} cue phụ đề có thể chỉnh sửa</h3></header>
          <div className="caption-cue-list">
            {workspace.captions.map((caption) => <button className={caption.id === selectedCaptionId ? 'selected' : ''} key={caption.id} onClick={() => setSelectedCaptionId(caption.id)}><span>{formatTime(caption.startMs)} – {formatTime(caption.endMs)}</span><strong>{caption.text}</strong></button>)}
          </div>
          {selectedCaption && <form className="caption-editor" onSubmit={(event) => { event.preventDefault(); void run(() => window.narra.updateCaptionCue(projectId, selectedCaption.id, draft)); }}>
            <div className="time-fields"><label>Bắt đầu (ms)<input type="number" min="0" step="1" value={draft.startMs} onChange={(event) => setDraft({...draft, startMs: Number(event.target.value)})} placeholder="Nhập thời điểm bắt đầu theo ms" /></label><label>Kết thúc (ms)<input type="number" min="1" step="1" value={draft.endMs} onChange={(event) => setDraft({...draft, endMs: Number(event.target.value)})} placeholder="Nhập thời điểm kết thúc theo ms" /></label></div>
            <label>Nội dung phụ đề<textarea rows={3} value={draft.text} onChange={(event) => setDraft({...draft, text: event.target.value})} placeholder="Nhập nội dung phụ đề" /></label>
            <button className="primary" disabled={busy || !draft.text.trim() || draft.endMs <= draft.startMs}><Save aria-hidden="true" size={16} /> Lưu cue</button>
          </form>}
        </section>

        <section className="timeline-card">
          <header><h3>Thiết lập trộn âm nguồn theo shot</h3></header>
          <div className="shot-audio-list">
            {workspace.shots.map((shot) => {
              const asset = workspace.assets.find(({id}) => id === shot.assetId);
              return <article key={shot.id}><div><strong>{shot.id}</strong><small>{asset?.kind === 'VIDEO' ? asset.path : 'Không có track âm thanh video'}</small></div><label>Chế độ<select disabled={busy || asset?.kind !== 'VIDEO'} value={shot.sourceAudioMode} onChange={(event) => void run(() => window.narra.updateShotAudio(projectId, shot.id, {sourceAudioMode: event.target.value as typeof shot.sourceAudioMode, sourceAudioVolume: shot.sourceAudioVolume}))}><option value="MUTE">Tắt tiếng</option><option value="DUCK">Giảm dưới lời đọc</option><option value="KEEP">Giữ nguyên</option></select></label><label>Mức âm <output>{Math.round(shot.sourceAudioVolume * 100)}%</output><input disabled={busy || asset?.kind !== 'VIDEO' || shot.sourceAudioMode === 'MUTE'} type="range" min="0" max="1" step="0.01" value={shot.sourceAudioVolume} onChange={(event) => void run(() => window.narra.updateShotAudio(projectId, shot.id, {sourceAudioMode: shot.sourceAudioMode, sourceAudioVolume: Number(event.target.value)}))} /></label></article>;
            })}
          </div>
          <div className="audio-layer-summary"><AudioLines aria-hidden="true" size={17} /><div><strong>{audioLayers.length} lớp nhạc/hiệu ứng</strong><p>Nhạc được giới hạn ở 8% khi có lời đọc; hiệu ứng dùng mức âm đã lưu.</p></div></div>
        </section>
      </div>

      {workspace.preflightIssues.length > 0 && <section className="timeline-card preflight-list"><header><h3>Sửa các mục được đánh dấu lỗi trước khi kết xuất</h3></header>{workspace.preflightIssues.map((issue) => <article key={`${issue.code}-${issue.subjectId}`} className={issue.severity.toLowerCase()}><strong>{issue.severity === 'ERROR' ? 'Lỗi' : 'Cảnh báo'} · {issue.code}</strong><p>{issue.message}</p></article>)}</section>}
    </section>
  );
};
