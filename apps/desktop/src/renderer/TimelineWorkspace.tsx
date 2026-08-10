import type {ProjectDetail, TimelineWorkspace} from '@narra/project-store';
import {useEffect, useMemo, useState} from 'react';
import {AudioLines, Captions, CheckCircle2, Clock3, Music2, Save, SlidersHorizontal, TriangleAlert, Upload} from 'lucide-react';

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

  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load timeline.')); }, [projectId]);
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
      setError(reason instanceof Error ? reason.message : 'Timeline operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="timeline-empty">Loading timeline…</div>;

  return (
    <section className="timeline-workspace" aria-busy={busy}>
      <header className="timeline-toolbar">
        <div><p className="section-label">Rough cut timeline</p><h3>Narration master · {workspace.durationSec.toFixed(2)}s</h3><p>Media follows the approved voice timing. Source video audio is muted unless enabled per shot.</p></div>
        <div className="actions">
          <button className="secondary" disabled={busy || workspace.segments.some(({durationSec}) => !durationSec)} onClick={() => void run(() => window.narra.generateCaptionsFromNarration(projectId))}><Captions aria-hidden="true" size={16} /> Generate cues</button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportTimelineAudio(projectId, 'MUSIC'))}><Music2 aria-hidden="true" size={16} /> Add music</button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportTimelineAudio(projectId, 'SFX'))}><Upload aria-hidden="true" size={16} /> Add SFX</button>
        </div>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}

      <section className={`preflight-banner ${errors.length ? 'blocked' : 'ready'}`} aria-label="Render preflight">
        {errors.length ? <TriangleAlert aria-hidden="true" size={21} /> : <CheckCircle2 aria-hidden="true" size={21} />}
        <div><strong>{errors.length ? `Render blocked by ${errors.length} issue${errors.length === 1 ? '' : 's'}` : 'Rough cut preflight ready'}</strong><p>{workspace.preflightIssues.length - errors.length} non-blocking warnings · changes mark only the render scope stale.</p></div>
      </section>

      <section className="timeline-ruler" aria-label="Visual rough-cut timeline">
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
          <header><div><p className="section-label"><Captions aria-hidden="true" size={15} /> Caption cues</p><h3>{workspace.captions.length} editable cues</h3></div></header>
          <div className="caption-cue-list">
            {workspace.captions.map((caption) => <button className={caption.id === selectedCaptionId ? 'selected' : ''} key={caption.id} onClick={() => setSelectedCaptionId(caption.id)}><span>{formatTime(caption.startMs)} – {formatTime(caption.endMs)}</span><strong>{caption.text}</strong></button>)}
          </div>
          {selectedCaption && <form className="caption-editor" onSubmit={(event) => { event.preventDefault(); void run(() => window.narra.updateCaptionCue(projectId, selectedCaption.id, draft)); }}>
            <div className="time-fields"><label>Start (ms)<input type="number" min="0" step="1" value={draft.startMs} onChange={(event) => setDraft({...draft, startMs: Number(event.target.value)})} /></label><label>End (ms)<input type="number" min="1" step="1" value={draft.endMs} onChange={(event) => setDraft({...draft, endMs: Number(event.target.value)})} /></label></div>
            <label>Caption text<textarea rows={3} value={draft.text} onChange={(event) => setDraft({...draft, text: event.target.value})} /></label>
            <button className="primary" disabled={busy || !draft.text.trim() || draft.endMs <= draft.startMs}><Save aria-hidden="true" size={16} /> Save cue</button>
          </form>}
        </section>

        <section className="timeline-card">
          <header><div><p className="section-label"><SlidersHorizontal aria-hidden="true" size={15} /> Source audio</p><h3>Shot-level mix policy</h3></div></header>
          <div className="shot-audio-list">
            {workspace.shots.map((shot) => {
              const asset = workspace.assets.find(({id}) => id === shot.assetId);
              return <article key={shot.id}><div><strong>{shot.id}</strong><small>{asset?.kind === 'VIDEO' ? asset.path : 'No video audio track'}</small></div><label>Mode<select disabled={busy || asset?.kind !== 'VIDEO'} value={shot.sourceAudioMode} onChange={(event) => void run(() => window.narra.updateShotAudio(projectId, shot.id, {sourceAudioMode: event.target.value as typeof shot.sourceAudioMode, sourceAudioVolume: shot.sourceAudioVolume}))}><option value="MUTE">Mute</option><option value="DUCK">Duck under narration</option><option value="KEEP">Keep</option></select></label><label>Level <output>{Math.round(shot.sourceAudioVolume * 100)}%</output><input disabled={busy || asset?.kind !== 'VIDEO' || shot.sourceAudioMode === 'MUTE'} type="range" min="0" max="1" step="0.01" value={shot.sourceAudioVolume} onChange={(event) => void run(() => window.narra.updateShotAudio(projectId, shot.id, {sourceAudioMode: shot.sourceAudioMode, sourceAudioVolume: Number(event.target.value)}))} /></label></article>;
            })}
          </div>
          <div className="audio-layer-summary"><AudioLines aria-hidden="true" size={17} /><div><strong>{audioLayers.length} music/SFX layers</strong><p>Music is capped at 8% while narration is present; SFX uses its saved level.</p></div></div>
        </section>
      </div>

      {workspace.preflightIssues.length > 0 && <section className="timeline-card preflight-list"><header><div><p className="section-label">Preflight detail</p><h3>Fix before render where marked error</h3></div></header>{workspace.preflightIssues.map((issue) => <article key={`${issue.code}-${issue.subjectId}`} className={issue.severity.toLowerCase()}><strong>{issue.severity} · {issue.code}</strong><p>{issue.message}</p></article>)}</section>}
    </section>
  );
};
