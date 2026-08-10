import type {Asset} from '@narra/contracts';
import type {CreateAssetTaskInput, ProjectDetail, StoryboardWorkspace} from '@narra/project-store';
import type {DragEvent, FormEvent} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {Download, FileUp, Upload, WandSparkles} from 'lucide-react';

type Props = {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
};

const needsAsset = (visualType: string): boolean => ['AI_IMAGE', 'AI_VIDEO', 'STOCK'].includes(visualType);
const previewUrl = (projectId: string, assetId: string): string =>
  `narra-media://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;

const formatDuration = (seconds?: number): string =>
  seconds === undefined ? '—' : `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;

const formatLabel = (value: string): string => {
  const normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const statusActions = (status: Asset['status']): Array<{label: string; next: Asset['status']; tone?: 'danger'}> => {
  if (status === 'PLANNED') return [{label: 'Send to creator', next: 'AWAITING_HUMAN'}];
  if (status === 'IMPORTED') return [{label: 'Select', next: 'SELECTED'}, {label: 'QA pass', next: 'QA_PASS'}, {label: 'Reject', next: 'REJECTED', tone: 'danger'}];
  if (status === 'SELECTED') return [{label: 'QA pass', next: 'QA_PASS'}, {label: 'QA fail', next: 'QA_FAIL', tone: 'danger'}, {label: 'Reject', next: 'REJECTED', tone: 'danger'}];
  if (status === 'QA_PASS') return [{label: 'Reopen QA', next: 'QA_FAIL', tone: 'danger'}];
  if (status === 'QA_FAIL' || status === 'REJECTED') return [{label: 'Request replacement', next: 'AWAITING_HUMAN'}];
  return [];
};

export const StoryboardWorkspaceView = ({projectId, onProjectRefresh}: Props) => {
  const [workspace, setWorkspace] = useState<StoryboardWorkspace | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [task, setTask] = useState<CreateAssetTaskInput>({
    shotId: '', kind: 'IMAGE', provider: 'GOOGLE_FLOW', brief: '', prompt: '', rightsNote: '',
  });

  const load = async (): Promise<void> => {
    const next = await window.narra.getStoryboard(projectId);
    setWorkspace(next);
    setSelectedShotId((current) => current && next.shots.some(({id}) => id === current) ? current : next.shots[0]?.id ?? null);
  };

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load storyboard.'));
  }, [projectId]);

  const selectedShot = workspace?.shots.find(({id}) => id === selectedShotId);
  const selectedScene = workspace?.scenes.find(({id}) => id === selectedShot?.sceneId);
  const selectedAsset = workspace?.assets.find(({id}) => id === selectedShot?.assetId);
  const shotsByScene = useMemo(() => new Map(
    workspace?.scenes.map((scene) => [scene.id, workspace.shots.filter(({sceneId}) => sceneId === scene.id)]) ?? [],
  ), [workspace]);

  useEffect(() => {
    if (!selectedShot) return;
    setTask((current) => ({
      ...current,
      shotId: selectedShot.id,
      kind: selectedShot.visualType === 'AI_VIDEO' ? 'VIDEO' : 'IMAGE',
      brief: selectedShot.visualPurpose,
      prompt: current.shotId === selectedShot.id ? current.prompt : selectedShot.visualPurpose,
    }));
  }, [selectedShot]);

  const run = async (action: () => Promise<StoryboardWorkspace | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setWorkspace(next);
      onProjectRefresh(await window.narra.getProject(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Storyboard operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const createTask = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await run(() => window.narra.createAssetTask(projectId, task));
  };

  const importDroppedFile = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file || !selectedAsset) return;
    await run(() => window.narra.importDroppedAssetMedia(projectId, selectedAsset.id, file));
  };

  const exportRenderInput = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setExportedPath(await window.narra.exportStoryboardRenderInput(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export render input.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="storyboard-empty">Loading storyboard…</div>;

  return (
    <section className="storyboard-workspace" aria-busy={busy} aria-label="Storyboard and asset manager">
      <header className="storyboard-toolbar">
        <div>
          <p className="section-label">Storyboard</p>
          <p>{workspace.scenes.length} scenes · {workspace.shots.length} shots · {workspace.assets.length} assets</p>
        </div>
        <div className="scope-row" aria-label="Downstream freshness">
          {workspace.staleScopes.map((scope) => (
            <span className={`scope-chip ${scope.stale ? 'stale' : 'fresh'}`} key={scope.scope} title={scope.reason ?? 'Up to date'}>
              {formatLabel(scope.scope)} · {scope.stale ? 'Needs update' : 'Current'}
            </span>
          ))}
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportStoryboard(projectId))}>
            <FileUp aria-hidden="true" size={16} /> Import storyboard
          </button>
          <button
            className="secondary"
            disabled={busy || workspace.shots.length === 0}
            onClick={() => void exportRenderInput()}
          ><Download aria-hidden="true" size={16} /> Export render input</button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Updating the local workspace…</div>}
      {exportedPath && <div className="notice success-notice" role="status">Render input saved to {exportedPath}</div>}

      {workspace.scenes.length === 0 ? (
        <div className="storyboard-empty">
          <h3>No storyboard imported</h3>
          <p>Select both <code>scenes.json</code> and <code>shots.json</code> generated by Codex.</p>
        </div>
      ) : (
        <div className="storyboard-columns">
          <nav className="scene-browser" aria-label="Scenes and shots">
            {workspace.scenes.map((scene) => (
              <section className="scene-block" key={scene.id}>
                <header><span>Scene {scene.order + 1}</span><strong>{scene.title}</strong><small>{formatDuration(scene.durationSec)}</small></header>
                {(shotsByScene.get(scene.id) ?? []).map((shot) => {
                  const asset = workspace.assets.find(({id}) => id === shot.assetId);
                  return (
                    <button
                      aria-selected={selectedShotId === shot.id}
                      className={`shot-row ${selectedShotId === shot.id ? 'selected' : ''}`}
                      key={shot.id}
                      onClick={() => setSelectedShotId(shot.id)}
                    >
                      <span className="shot-order">{shot.order + 1}</span>
                      <span><strong>{formatLabel(shot.visualType)}</strong><small>{shot.visualPurpose}</small></span>
                      <span className={`asset-dot ${asset?.status.toLowerCase().replaceAll('_', '-') ?? 'missing'}`} title={asset?.status ?? 'No asset'} />
                    </button>
                  );
                })}
              </section>
            ))}
          </nav>

          <article className="shot-inspector">
            {selectedShot && selectedScene ? (
              <>
                <header className="inspector-heading">
                  <div><p className="section-label">Shot {selectedShot.order + 1}</p><h3>{selectedShot.visualPurpose}</h3></div>
                  <span className="status-pill">{formatDuration(selectedShot.durationSec)}</span>
                </header>
                <dl className="shot-facts">
                  <div><dt>Scene</dt><dd>{selectedScene.title}</dd></div>
                  <div><dt>Visual type</dt><dd>{formatLabel(selectedShot.visualType)}</dd></div>
                  <div><dt>Route</dt><dd>{selectedShot.assetRoute ?? 'Not specified'}</dd></div>
                  <div><dt>Evidence</dt><dd>{selectedShot.evidenceRequired ? 'Required' : 'Not required'}</dd></div>
                </dl>

                {!needsAsset(selectedShot.visualType) ? (
                  <div className="storyboard-empty compact"><p>This shot is rendered from structured data and does not require imported media.</p></div>
                ) : !selectedAsset ? (
                  <form className="asset-task-form" onSubmit={(event) => void createTask(event)}>
                    <div><p className="section-label">Asset task</p><h3>Create prompt package</h3></div>
                    <div className="form-pair">
                      <label>Kind<select value={task.kind} onChange={(event) => setTask({...task, kind: event.target.value as 'IMAGE' | 'VIDEO'})}><option value="IMAGE">Image</option><option value="VIDEO">Video</option></select></label>
                      <label>Provider<select value={task.provider} onChange={(event) => setTask({...task, provider: event.target.value as CreateAssetTaskInput['provider']})}><option value="GOOGLE_FLOW">Google Flow</option><option value="STOCK">Stock</option><option value="LOCAL">Local</option><option value="OTHER">Other</option></select></label>
                    </div>
                    <label>Visual brief<textarea rows={2} value={task.brief} onChange={(event) => setTask({...task, brief: event.target.value})} required /></label>
                    <label>Generation/search prompt<textarea rows={4} value={task.prompt} onChange={(event) => setTask({...task, prompt: event.target.value})} required /></label>
                    <label>Negative prompt<textarea rows={2} value={task.negativePrompt ?? ''} onChange={(event) => setTask({...task, negativePrompt: event.target.value})} /></label>
                    <label>Rights note<input value={task.rightsNote} onChange={(event) => setTask({...task, rightsNote: event.target.value})} required /></label>
                    <button className="primary" disabled={busy} type="submit"><WandSparkles aria-hidden="true" size={16} /> Create asset task</button>
                  </form>
                ) : (
                  <section className="asset-detail">
                    <div className="asset-status-bar">
                      <div><p className="section-label">Asset</p><h3>{selectedAsset.id}</h3></div>
                      <span className={`health ${selectedAsset.status === 'QA_PASS' ? 'valid' : 'pending'}`}>{formatLabel(selectedAsset.status)}</span>
                    </div>

                    {selectedAsset.path ? (
                      <div className="media-preview">
                        {selectedAsset.kind === 'VIDEO' ? <video controls src={previewUrl(projectId, selectedAsset.id)} /> : <img alt={selectedShot.visualPurpose} src={previewUrl(projectId, selectedAsset.id)} />}
                      </div>
                    ) : <div className="media-preview empty-preview">No media imported</div>}

                    {selectedAsset.task && (
                      <details className="prompt-package" open>
                        <summary>Prompt package · {formatLabel(selectedAsset.task.provider)}</summary>
                        <p>{selectedAsset.task.brief}</p>
                        <pre>{selectedAsset.task.prompt}</pre>
                        {selectedAsset.task.negativePrompt && <small>Negative: {selectedAsset.task.negativePrompt}</small>}
                      </details>
                    )}

                    {selectedAsset.status === 'AWAITING_HUMAN' || selectedAsset.status === 'QA_FAIL' || selectedAsset.status === 'IMPORTED' || selectedAsset.status === 'SELECTED' || selectedAsset.status === 'QA_PASS' ? (
                      <div
                        className={`drop-zone ${dragActive ? 'active' : ''}`}
                        onDragEnter={(event) => {event.preventDefault(); setDragActive(true);}}
                        onDragOver={(event) => event.preventDefault()}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={(event) => void importDroppedFile(event)}
                      >
                        <p>Drop a replacement file here, or choose one from disk.</p>
                        <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportAssetMedia(projectId, selectedAsset.id))}><Upload aria-hidden="true" size={16} /> Import media</button>
                      </div>
                    ) : null}

                    {selectedAsset.metadata && (
                      <dl className="media-metadata">
                        <div><dt>Format</dt><dd>{selectedAsset.metadata.format}</dd></div>
                        <div><dt>Codec</dt><dd>{selectedAsset.metadata.videoCodec ?? selectedAsset.metadata.audioCodec ?? '—'}</dd></div>
                        <div><dt>Resolution</dt><dd>{selectedAsset.metadata.width && selectedAsset.metadata.height ? `${selectedAsset.metadata.width}×${selectedAsset.metadata.height}` : '—'}</dd></div>
                        <div><dt>Aspect</dt><dd>{selectedAsset.metadata.aspectRatio ?? '—'}</dd></div>
                        <div><dt>Duration</dt><dd>{formatDuration(selectedAsset.metadata.durationSec)}</dd></div>
                      </dl>
                    )}

                    <div className="asset-actions">
                      {statusActions(selectedAsset.status).map((action) => (
                        <button
                          className={action.tone === 'danger' ? 'danger' : 'secondary'}
                          disabled={busy}
                          key={action.next}
                          onClick={() => void run(() => window.narra.updateAssetStatus(projectId, selectedAsset.id, {status: action.next}))}
                        >{action.label}</button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : <div className="storyboard-empty">Select a shot to inspect it.</div>}
          </article>
        </div>
      )}
    </section>
  );
};
