import type {ProjectDetail, VoiceWorkspace} from '@narra/project-store';
import {useEffect, useState} from 'react';
import {AudioLines, Captions, Clock3, RefreshCw, Upload} from 'lucide-react';

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

export const VoiceWorkspaceView = ({projectId, onProjectRefresh}: Props) => {
  const [workspace, setWorkspace] = useState<VoiceWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const next = await window.narra.getVoiceWorkspace(projectId);
    setWorkspace(next);
    setSelectedId((current) => current && next.segments.some(({id}) => id === current) ? current : next.segments[0]?.id ?? null);
  };

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load voice workspace.'));
  }, [projectId]);

  const run = async (action: () => Promise<VoiceWorkspace | null>): Promise<void> => {
    setBusy(true);
    setError(null);
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

  if (!workspace) return <div className="voice-empty">Loading voice workspace…</div>;

  const selected = workspace.segments.find(({id}) => id === selectedId);
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
          <button className="secondary" disabled={busy || workspace.segments.length === 0} onClick={() => void run(() => window.narra.chooseAndImportCaptions(projectId))}><Captions aria-hidden="true" size={16} /> Import captions</button>
          <button className="primary" disabled={busy || !audioReady} onClick={() => void run(() => window.narra.fitTimelineToNarration(projectId))}><Clock3 aria-hidden="true" size={16} /> Fit timeline to audio</button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Updating narration and timeline…</div>}

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

                {selected.audioPath ? (
                  <audio className="audio-player" controls preload="metadata" src={narrationUrl(projectId, selected.id)} />
                ) : (
                  <div className="audio-placeholder">No audio imported for this segment.</div>
                )}

                <div className="audio-import-row">
                  <div>
                    <strong>{selected.audioPath ? `Audio version ${selected.version}` : 'Manual provider workflow'}</strong>
                    <p>Generate or record this segment outside Narra, then import the resulting audio file.</p>
                  </div>
                  <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportNarrationAudio(projectId, selected.id))}>
                    <Upload aria-hidden="true" size={16} /> {selected.audioPath ? 'Replace segment audio' : 'Import segment audio'}
                  </button>
                </div>

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
