import type {ProjectDetail, VoiceWorkspace} from '@narra/project-store';
import {useEffect, useRef, useState} from 'react';
import {AudioLines, Captions, Clock3, Gauge, Mic2, RefreshCw, Sparkles, Upload} from 'lucide-react';

type Props = {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
};

const formatSeconds = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)}s`;

const narrationUrl = (projectId: string, segmentId: string): string =>
  `narra-media://narration/${encodeURIComponent(projectId)}/${encodeURIComponent(segmentId)}`;

const formatLabel = (value: string): string => {
  const normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

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
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load voice workspace.'));
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
      setError(reason instanceof Error ? reason.message : 'Voice operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const generateSelected = (): Promise<void> => run(async () => {
    if (!selected) throw new Error('Select a narration segment first.');
    const next = await window.narra.generateNarrationSegment(projectId, {
      segmentId: selected.id,
      presetId,
      speed,
      ...(pronunciationNotes.trim() ? {pronunciationNotes: pronunciationNotes.trim()} : {}),
    });
    setMessage(`Generated ${selected.id} locally with Kokoro. Review the audio before fitting the timeline.`);
    return next;
  });

  const generateMissing = (): Promise<void> => run(async () => {
    const next = await window.narra.generateMissingNarration(projectId, {presetId, speed});
    setMessage('Generated all narration segments that did not already have audio. Existing segment versions were preserved.');
    return next;
  });

  if (!workspace) return <div className="voice-empty">Loading voice workspace…</div>;

  const warning = workspace.timelineWarnings.find(({sceneId}) => sceneId === selected?.sceneId);
  const issues = workspace.qaIssues.filter(({segmentId}) => segmentId === selectedId);
  const audioReady = workspace.segments.length > 0 && workspace.segments.every(({audioPath, durationSec}) => audioPath && durationSec);

  return (
    <section className="voice-workspace" aria-busy={busy} aria-label="Voice, captions and timeline sync">
      <header className="voice-toolbar">
        <div>
          <p className="section-label">Voice and captions</p>
          <p>{workspace.segments.length} segments · {workspace.captions.length} cues · {workspace.qaIssues.length} QA issues</p>
        </div>
        <div className="voice-actions">
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.syncNarrationSegments(projectId))}><RefreshCw aria-hidden="true" size={16} /> Sync from storyboard</button>
          <button className="secondary" disabled={busy || !workspace.runtime.available || workspace.segments.every(({audioPath}) => audioPath)} onClick={() => void generateMissing()}><Sparkles aria-hidden="true" size={16} /> Generate missing</button>
          <button className="secondary" disabled={busy || workspace.segments.length === 0} onClick={() => void run(() => window.narra.chooseAndImportCaptions(projectId))}><Captions aria-hidden="true" size={16} /> Import captions</button>
          <button className="primary" disabled={busy || !audioReady} onClick={() => void run(() => window.narra.fitTimelineToNarration(projectId))}><Clock3 aria-hidden="true" size={16} /> Fit timeline to audio</button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Updating narration and timeline…</div>}
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}

      <section className={`voice-runtime-card ${workspace.runtime.available ? 'ready' : 'missing'}`} aria-label="Local voice runtime status">
        <Mic2 aria-hidden="true" size={20} />
        <div><strong>{workspace.runtime.available ? 'Kokoro local runtime ready' : 'Kokoro local runtime needs setup'}</strong><p>{workspace.runtime.licenseSummary}</p>{!workspace.runtime.available && <small>Missing: {workspace.runtime.missing.join(', ')}</small>}</div>
        <span className={`health ${workspace.runtime.available ? 'valid' : 'pending'}`}>{workspace.runtime.available ? `Model ${workspace.runtime.modelVersion}` : 'Unavailable'}</span>
        {!workspace.runtime.available && <code>{workspace.runtime.setupCommand}</code>}
      </section>

      {workspace.segments.length === 0 ? (
        <div className="voice-empty">
          <h3>No narration segments</h3>
          <p>Import a storyboard, then sync one editable narration segment per scene.</p>
          <button className="primary" disabled={busy} onClick={() => void run(() => window.narra.syncNarrationSegments(projectId))}>Create segments</button>
        </div>
      ) : (
        <div className="voice-columns">
          <nav className="segment-list" aria-label="Narration segments">
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
                  <small>{formatLabel(segment.status)} · {formatSeconds(segment.durationSec)}</small>
                  <span className={`timing-state ${(segmentWarning?.kind ?? 'MISSING_AUDIO').toLowerCase()}`}>
                    {issueCount > 0 ? `${issueCount} QA` : segmentWarning ? formatLabel(segmentWarning.kind) : 'Missing audio'}
                  </span>
                </button>
              );
            })}
          </nav>

          <article className="voice-inspector">
            {selected ? (
              <>
                <header className="inspector-heading">
                  <div><p className="section-label">Narration segment</p><h3>{selected.id}</h3></div>
                  <span className={`health ${selected.status === 'READY' ? 'valid' : 'pending'}`}>{formatLabel(selected.status)}</span>
                </header>

                <section className="narration-copy" aria-label="Narration text">
                  <p>{selected.text}</p>
                  {selected.pronunciationNotes && <small>Pronunciation: {selected.pronunciationNotes}</small>}
                </section>

                <section className="voice-generation-card" aria-label="Kokoro voice settings">
                  <header><div><p className="section-label">Local generation</p><h3>Kokoro voice and delivery</h3></div><Gauge aria-hidden="true" size={20} /></header>
                  <div className="voice-generation-fields">
                    <label>Voice preset<select value={presetId} onChange={(event) => {
                      const nextId = event.target.value;
                      setPresetId(nextId);
                      const preset = workspace.presets.find(({id}) => id === nextId);
                      if (preset) setSpeed(preset.defaultSpeed);
                    }}>{workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><small>{workspace.presets.find(({id}) => id === presetId)?.description}</small></label>
                    <label>Speed <output>{speed.toFixed(2)}×</output><input aria-label="Narration speed" type="range" min="0.8" max="1.2" step="0.01" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
                  </div>
                  <label>Pronunciation dictionary<textarea rows={3} value={pronunciationNotes} onChange={(event) => setPronunciationNotes(event.target.value)} placeholder="OpenAI=Open A I; API=A P I" /><small>Use one <code>term=spoken form</code> entry per line or separate entries with semicolons.</small></label>
                  <div className="voice-generation-actions"><button className="primary" disabled={busy || !workspace.runtime.available} onClick={() => void generateSelected()}><Sparkles aria-hidden="true" size={16} /> {selected.audioPath ? 'Regenerate segment' : 'Generate segment'}</button><span>Runs fully local. Existing audio is replaced with a new segment version only after generation succeeds.</span></div>
                </section>

                {selected.audioPath ? (
                  <div className="audio-review"><Waveform src={narrationUrl(projectId, selected.id)} label={`Waveform for ${selected.id}`} /><audio className="audio-player" controls preload="metadata" src={narrationUrl(projectId, selected.id)} /></div>
                ) : (
                  <div className="audio-placeholder">No audio imported for this segment.</div>
                )}

                <div className="audio-import-row">
                  <div>
                    <strong>{selected.audioPath ? `Audio version ${selected.version}` : 'Manual import fallback'}</strong>
                    <p>Use this when audio was recorded or generated by another reviewed provider.</p>
                  </div>
                  <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportNarrationAudio(projectId, selected.id))}>
                    <Upload aria-hidden="true" size={16} /> {selected.audioPath ? 'Replace segment audio' : 'Import segment audio'}
                  </button>
                </div>

                {selected.generation && (
                  <details className="voice-provenance" open>
                    <summary>Generation provenance · {selected.generation.model} {selected.generation.modelVersion}</summary>
                    <dl><div><dt>Voice</dt><dd>{selected.generation.voice}</dd></div><div><dt>Language</dt><dd>{selected.generation.language}</dd></div><div><dt>Speed</dt><dd>{selected.generation.speed.toFixed(2)}×</dd></div><div><dt>Target</dt><dd>{selected.generation.loudnessTargetLufs} LUFS</dd></div></dl>
                    <p>{selected.generation.normalizedText}</p>
                  </details>
                )}

                <dl className="voice-metadata">
                  <div><dt>Planned</dt><dd>{formatSeconds(selected.plannedDurationSec)}</dd></div>
                  <div><dt>Actual</dt><dd>{formatSeconds(selected.durationSec)}</dd></div>
                  <div><dt>Codec</dt><dd>{selected.audioMetadata?.audioCodec ?? '—'}</dd></div>
                  <div><dt>Sample rate</dt><dd>{selected.audioMetadata?.sampleRate ? `${selected.audioMetadata.sampleRate} Hz` : '—'}</dd></div>
                  <div><dt>Channels</dt><dd>{selected.audioMetadata?.channels ?? '—'}</dd></div>
                  <div><dt>Container</dt><dd>{selected.audioMetadata?.format ?? '—'}</dd></div>
                </dl>

                {warning && (
                  <div className={`timing-warning ${warning.kind.toLowerCase()}`}>
                    <strong>{formatLabel(warning.kind)}</strong>
                    <p>{warning.message}</p>
                  </div>
                )}

                {issues.length > 0 && (
                  <section className="voice-qa-list" aria-label="Transcript mismatch issues">
                    <p className="section-label">Transcript QA</p>
                    {issues.map((issue) => (
                      <article key={`${issue.segmentId}-${issue.message}`}>
                        <strong>{formatLabel(issue.severity)} · {Math.round(issue.similarity * 100)}% match</strong>
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
        <div><p className="section-label"><AudioLines aria-hidden="true" size={15} /> Caption input</p><h3>SRT, WebVTT or word timestamps JSON</h3></div>
        <p>Word JSON may use <code>startMs/endMs</code> or seconds-based <code>start/end</code>. Set <code>timebase: "segment"</code> when each segment starts at zero.</p>
      </section>
    </section>
  );
};
