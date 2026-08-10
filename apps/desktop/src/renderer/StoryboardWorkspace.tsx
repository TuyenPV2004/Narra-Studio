import type {Asset} from '@narra/contracts';
import type {CreateAssetTaskInput, FlowCandidate, FlowWorkspace, ProjectDetail, StoryboardWorkspace} from '@narra/project-store';
import type {DragEvent, FormEvent} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {Check, Copy, Download, ExternalLink, FileUp, FolderOpen, RefreshCw, Upload, WandSparkles, X} from 'lucide-react';

type Props = {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
};

const needsAsset = (visualType: string): boolean => ['AI_IMAGE', 'AI_VIDEO', 'STOCK'].includes(visualType);
const previewUrl = (projectId: string, assetId: string): string =>
  `narra-media://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
const candidatePreviewUrl = (projectId: string, candidateId: string): string =>
  `narra-media://flow-candidate/${encodeURIComponent(projectId)}/${encodeURIComponent(candidateId)}`;

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
  const [flowWorkspace, setFlowWorkspace] = useState<FlowWorkspace | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [candidateToConfirm, setCandidateToConfirm] = useState<FlowCandidate | null>(null);
  const [candidateAssetId, setCandidateAssetId] = useState('');
  const [task, setTask] = useState<CreateAssetTaskInput>({
    shotId: '', kind: 'IMAGE', provider: 'GOOGLE_FLOW', brief: '', prompt: '', rightsNote: '',
  });

  const load = async (): Promise<void> => {
    const [next, flow] = await Promise.all([window.narra.getStoryboard(projectId), window.narra.getFlowWorkspace(projectId)]);
    setWorkspace(next);
    setFlowWorkspace(flow);
    setSelectedShotId((current) => current && next.shots.some(({id}) => id === current) ? current : next.shots[0]?.id ?? null);
  };

  useEffect(() => {
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load storyboard.'));
  }, [projectId]);

  useEffect(() => {
    if (!flowWorkspace?.watchDirectory) return;
    const timer = window.setInterval(() => {
      void window.narra.scanFlowCandidates(projectId).then(setFlowWorkspace).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [projectId, flowWorkspace?.watchDirectory]);

  const selectedShot = workspace?.shots.find(({id}) => id === selectedShotId);
  const selectedScene = workspace?.scenes.find(({id}) => id === selectedShot?.sceneId);
  const selectedAsset = workspace?.assets.find(({id}) => id === selectedShot?.assetId);
  const flowCandidates = useMemo(() => flowWorkspace?.candidates.filter((candidate) =>
    candidate.status !== 'REJECTED' && (!candidate.suggestedShotId || candidate.suggestedShotId === selectedShotId),
  ) ?? [], [flowWorkspace, selectedShotId]);
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
    setMessage(null);
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

  const runFlow = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      onProjectRefresh(await window.narra.getProject(projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google Flow assisted operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const prepareFlow = (): Promise<void> => runFlow(async () => {
    if (!selectedShot) throw new Error('Select a shot first.');
    const next = await window.narra.prepareFlowAssetTask(projectId, {
      shotId: selectedShot.id,
      kind: selectedShot.visualType === 'AI_VIDEO' ? 'VIDEO' : 'IMAGE',
    });
    setWorkspace(next);
    setFlowWorkspace(await window.narra.getFlowWorkspace(projectId));
    setMessage(selectedAsset ? 'Flow prompt package regenerated. Existing media remains available until replacement.' : 'Flow prompt package created.');
  });

  const chooseWatchDirectory = (): Promise<void> => runFlow(async () => {
    const next = await window.narra.chooseFlowWatchDirectory(projectId);
    if (next) {
      setFlowWorkspace(next);
      setMessage('Google Flow download folder saved locally.');
    }
  });

  const scanCandidates = (): Promise<void> => runFlow(async () => {
    setFlowWorkspace(await window.narra.scanFlowCandidates(projectId));
    setMessage('Download folder scanned. New files are listed as candidates only.');
  });

  const copyPrompt = (value: string, label: string): Promise<void> => runFlow(async () => {
    await window.narra.copyText(value);
    setMessage(`${label} copied to clipboard.`);
  });

  const openFlow = (): Promise<void> => runFlow(async () => {
    await window.narra.openExternalUrl(flowWorkspace?.flowUrl ?? 'https://labs.google/fx/tools/flow');
    setMessage('Google Flow opened in your browser. Narra does not click Generate or spend credits.');
  });

  const confirmCandidate = (candidate: FlowCandidate): void => {
    const suggested = workspace?.assets.find((asset) => asset.shotId === candidate.suggestedShotId && asset.kind === candidate.kind);
    setCandidateAssetId(suggested?.id ?? (selectedAsset?.kind === candidate.kind ? selectedAsset.id : ''));
    setCandidateToConfirm(candidate);
  };

  const selectCandidate = (): Promise<void> => runFlow(async () => {
    if (!candidateToConfirm || !candidateAssetId) throw new Error('Choose the target asset task before importing.');
    setWorkspace(await window.narra.selectFlowCandidate(projectId, candidateToConfirm.id, candidateAssetId));
    setFlowWorkspace(await window.narra.getFlowWorkspace(projectId));
    setCandidateToConfirm(null);
    setMessage('Flow candidate copied into the project and selected. Run asset QA when ready.');
  });

  const rejectCandidate = (candidateId: string): Promise<void> => runFlow(async () => {
    setFlowWorkspace(await window.narra.rejectFlowCandidate(projectId, candidateId));
    setMessage('Candidate rejected; the source download was not deleted.');
  });

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
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}
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
                    <div className="flow-quick-start">
                      <WandSparkles aria-hidden="true" size={20} />
                      <div><strong>Google Flow Assisted</strong><p>Create both Nano Banana image and Veo video prompts from this approved shot.</p></div>
                      <button className="primary" disabled={busy} type="button" onClick={() => void prepareFlow()}>Prepare Flow package</button>
                    </div>
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

                    {selectedAsset.task?.flow && (
                      <section className="flow-assistant-panel" aria-label="Google Flow assisted workflow">
                        <header>
                          <div><p className="section-label">Google Flow Assisted</p><h3>{selectedAsset.task.flow.shotToken}</h3></div>
                          <span className="status-pill">Prompt v{selectedAsset.task.flow.version}</span>
                        </header>
                        <dl className="flow-settings-grid">
                          <div><dt>Image model</dt><dd>{selectedAsset.task.flow.imageModel}</dd></div>
                          <div><dt>Video model</dt><dd>{selectedAsset.task.flow.videoModel}</dd></div>
                          <div><dt>Aspect</dt><dd>{selectedAsset.task.flow.aspectRatio}</dd></div>
                          <div><dt>Clip length</dt><dd>{selectedAsset.task.flow.generationDurationSec}s</dd></div>
                        </dl>
                        <div className="flow-prompt-grid">
                          <article><header><strong>Image prompt</strong><button className="secondary" onClick={() => void copyPrompt(selectedAsset.task!.flow!.imagePrompt, 'Image prompt')}><Copy aria-hidden="true" size={15} /> Copy</button></header><p>{selectedAsset.task.flow.imagePrompt}</p></article>
                          <article><header><strong>Video prompt</strong><button className="secondary" onClick={() => void copyPrompt(selectedAsset.task!.flow!.videoPrompt, 'Video prompt')}><Copy aria-hidden="true" size={15} /> Copy</button></header><p>{selectedAsset.task.flow.videoPrompt}</p></article>
                        </div>
                        <details className="flow-negative"><summary>Negative guidance and ingredients</summary><p>{selectedAsset.task.flow.negativeGuidance}</p><small>{selectedAsset.task.flow.ingredients.join(' · ') || 'No reference ingredients required.'}</small></details>
                        <div className="flow-action-row">
                          <button className="primary" disabled={busy} onClick={() => void openFlow()}><ExternalLink aria-hidden="true" size={16} /> Open Google Flow</button>
                          {selectedAsset.status === 'PLANNED' && <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.updateAssetStatus(projectId, selectedAsset.id, {status: 'AWAITING_HUMAN'}))}><Check aria-hidden="true" size={16} /> Mark as generating</button>}
                          <button className="secondary" disabled={busy} onClick={() => void prepareFlow()}><RefreshCw aria-hidden="true" size={16} /> Regenerate prompt</button>
                        </div>

                        <section className="flow-inbox">
                          <header><div><strong>Download inbox</strong><small>{flowWorkspace?.watchDirectory ?? 'No folder selected'}</small></div><div><button className="secondary" disabled={busy} onClick={() => void chooseWatchDirectory()}><FolderOpen aria-hidden="true" size={16} /> Choose folder</button><button className="secondary" disabled={busy || !flowWorkspace?.watchDirectory} onClick={() => void scanCandidates()}><RefreshCw aria-hidden="true" size={16} /> Scan now</button></div></header>
                          <div className="flow-candidate-grid">
                            {flowCandidates.map((candidate) => <article className="flow-candidate" key={candidate.id}>
                              <div className="candidate-preview">{candidate.kind === 'VIDEO' ? <video controls preload="metadata" src={candidatePreviewUrl(projectId, candidate.id)} /> : <img loading="lazy" alt={`Flow candidate ${candidate.fileName}`} src={candidatePreviewUrl(projectId, candidate.id)} />}</div>
                              <div className="candidate-copy"><strong>{candidate.fileName}</strong><small>{formatLabel(candidate.kind)} · {(candidate.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</small><span className={`table-status ${candidate.status === 'SELECTED' ? 'fresh' : 'stale'}`}>{formatLabel(candidate.status)}</span>{candidate.suggestedShotId && <small>Suggested: {candidate.suggestedShotId}</small>}</div>
                              <div className="candidate-actions"><button className="primary" disabled={busy || candidate.status === 'SELECTED'} onClick={() => confirmCandidate(candidate)}><Check aria-hidden="true" size={15} /> Review mapping</button><button className="danger" disabled={busy || candidate.status === 'SELECTED'} onClick={() => void rejectCandidate(candidate.id)}><X aria-hidden="true" size={15} /> Reject</button></div>
                            </article>)}
                          </div>
                          {flowCandidates.length === 0 && <p className="flow-empty">Download an image/video from Flow, preferably with token <code>{selectedAsset.task.flow.shotToken}</code> in its filename, then scan.</p>}
                        </section>
                      </section>
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
      {candidateToConfirm && (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCandidateToConfirm(null); }}>
          <section className="candidate-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-dialog-title">
            <header><div><p className="section-label">Confirm Flow import</p><h3 id="candidate-dialog-title">Map candidate to an asset task</h3></div><button className="icon-button" aria-label="Close candidate dialog" onClick={() => setCandidateToConfirm(null)}><X aria-hidden="true" size={17} /></button></header>
            <div className="dialog-preview">{candidateToConfirm.kind === 'VIDEO' ? <video controls src={candidatePreviewUrl(projectId, candidateToConfirm.id)} /> : <img alt={candidateToConfirm.fileName} src={candidatePreviewUrl(projectId, candidateToConfirm.id)} />}</div>
            <p className="candidate-file-name">{candidateToConfirm.fileName}</p>
            <label>Target shot and asset task<select value={candidateAssetId} onChange={(event) => setCandidateAssetId(event.target.value)}><option value="">Select a target…</option>{workspace.assets.filter((asset) => asset.kind === candidateToConfirm.kind && asset.task?.provider === 'GOOGLE_FLOW').map((asset) => <option key={asset.id} value={asset.id}>{asset.shotId} · {asset.id}</option>)}</select></label>
            <div className="dialog-note"><strong>No automatic approval</strong><p>Narra will copy this file into the project, attach prompt provenance, and set it to Selected. Asset QA remains pending.</p></div>
            <footer><button className="secondary" onClick={() => setCandidateToConfirm(null)}>Cancel</button><button className="primary" disabled={busy || !candidateAssetId} onClick={() => void selectCandidate()}><Check aria-hidden="true" size={16} /> Import and select</button></footer>
          </section>
        </div>
      )}
    </section>
  );
};
