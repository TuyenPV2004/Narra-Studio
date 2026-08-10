import type {Asset} from '@narra/contracts';
import type {CreateAssetTaskInput, FlowCandidate, FlowWorkspace, ProjectDetail, StoryboardWorkspace} from '@narra/project-store';
import type {DragEvent, FormEvent} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {Check, Copy, Download, ExternalLink, FileUp, FolderOpen, RefreshCw, Upload, WandSparkles, X} from 'lucide-react';
import {formatUiLabel} from './ui-locale';

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

const statusActions = (status: Asset['status']): Array<{label: string; next: Asset['status']; tone?: 'danger'}> => {
  if (status === 'PLANNED') return [{label: 'Gửi người sáng tạo', next: 'AWAITING_HUMAN'}];
  if (status === 'IMPORTED') return [{label: 'Chọn', next: 'SELECTED'}, {label: 'QA đạt', next: 'QA_PASS'}, {label: 'Từ chối', next: 'REJECTED', tone: 'danger'}];
  if (status === 'SELECTED') return [{label: 'QA đạt', next: 'QA_PASS'}, {label: 'QA không đạt', next: 'QA_FAIL', tone: 'danger'}, {label: 'Từ chối', next: 'REJECTED', tone: 'danger'}];
  if (status === 'QA_PASS') return [{label: 'Mở lại QA', next: 'QA_FAIL', tone: 'danger'}];
  if (status === 'QA_FAIL' || status === 'REJECTED') return [{label: 'Yêu cầu thay thế', next: 'AWAITING_HUMAN'}];
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
    void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải storyboard.'));
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
      setError(reason instanceof Error ? reason.message : 'Thao tác storyboard không thành công.');
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
      setError(reason instanceof Error ? reason.message : 'Thao tác hỗ trợ Google Flow không thành công.');
    } finally {
      setBusy(false);
    }
  };

  const prepareFlow = (): Promise<void> => runFlow(async () => {
    if (!selectedShot) throw new Error('Hãy chọn một shot trước.');
    const next = await window.narra.prepareFlowAssetTask(projectId, {
      shotId: selectedShot.id,
      kind: selectedShot.visualType === 'AI_VIDEO' ? 'VIDEO' : 'IMAGE',
    });
    setWorkspace(next);
    setFlowWorkspace(await window.narra.getFlowWorkspace(projectId));
    setMessage(selectedAsset ? 'Đã tạo lại gói prompt Flow. Media hiện có vẫn được giữ đến khi thay thế.' : 'Đã tạo gói prompt Flow.');
  });

  const chooseWatchDirectory = (): Promise<void> => runFlow(async () => {
    const next = await window.narra.chooseFlowWatchDirectory(projectId);
    if (next) {
      setFlowWorkspace(next);
      setMessage('Đã lưu thư mục tải xuống Google Flow trên máy.');
    }
  });

  const scanCandidates = (): Promise<void> => runFlow(async () => {
    setFlowWorkspace(await window.narra.scanFlowCandidates(projectId));
    setMessage('Đã quét thư mục tải xuống. Tệp mới chỉ được liệt kê dưới dạng ứng viên.');
  });

  const copyPrompt = (value: string, label: string): Promise<void> => runFlow(async () => {
    await window.narra.copyText(value);
    setMessage(`Đã sao chép ${label} vào bảng nhớ tạm.`);
  });

  const openFlow = (): Promise<void> => runFlow(async () => {
    await window.narra.openExternalUrl(flowWorkspace?.flowUrl ?? 'https://labs.google/fx/tools/flow');
    setMessage('Đã mở Google Flow trong trình duyệt. Narra không tự nhấn Tạo hoặc sử dụng credit.');
  });

  const confirmCandidate = (candidate: FlowCandidate): void => {
    const suggested = workspace?.assets.find((asset) => asset.shotId === candidate.suggestedShotId && asset.kind === candidate.kind);
    setCandidateAssetId(suggested?.id ?? (selectedAsset?.kind === candidate.kind ? selectedAsset.id : ''));
    setCandidateToConfirm(candidate);
  };

  const selectCandidate = (): Promise<void> => runFlow(async () => {
    if (!candidateToConfirm || !candidateAssetId) throw new Error('Hãy chọn tác vụ tài nguyên đích trước khi nhập.');
    setWorkspace(await window.narra.selectFlowCandidate(projectId, candidateToConfirm.id, candidateAssetId));
    setFlowWorkspace(await window.narra.getFlowWorkspace(projectId));
    setCandidateToConfirm(null);
    setMessage('Đã sao chép ứng viên Flow vào dự án và chọn. Hãy chạy QA tài nguyên khi sẵn sàng.');
  });

  const rejectCandidate = (candidateId: string): Promise<void> => runFlow(async () => {
    setFlowWorkspace(await window.narra.rejectFlowCandidate(projectId, candidateId));
    setMessage('Đã từ chối ứng viên; tệp tải xuống nguồn không bị xóa.');
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
      setError(reason instanceof Error ? reason.message : 'Không thể xuất dữ liệu kết xuất.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="storyboard-empty">Đang tải storyboard…</div>;

  return (
    <section className="storyboard-workspace" aria-busy={busy} aria-label="Storyboard và trình quản lý tài nguyên">
      <header className="storyboard-toolbar">
        <div>
          <p>{workspace.scenes.length} cảnh · {workspace.shots.length} shot · {workspace.assets.length} tài nguyên</p>
        </div>
        <div className="scope-row" aria-label="Mức cập nhật của dữ liệu phía sau">
          {workspace.staleScopes.map((scope) => (
            <span className={`scope-chip ${scope.stale ? 'stale' : 'fresh'}`} key={scope.scope} title={scope.reason ?? 'Đã cập nhật'}>
              {formatUiLabel(scope.scope)} · {scope.stale ? 'Cần cập nhật' : 'Hiện hành'}
            </span>
          ))}
          <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportStoryboard(projectId))}>
            <FileUp aria-hidden="true" size={16} /> Nhập storyboard
          </button>
          <button
            className="secondary"
            disabled={busy || workspace.shots.length === 0}
            onClick={() => void exportRenderInput()}
          ><Download aria-hidden="true" size={16} /> Xuất dữ liệu kết xuất</button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Đang cập nhật không gian làm việc trên máy…</div>}
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}
      {exportedPath && <div className="notice success-notice" role="status">Đã lưu dữ liệu kết xuất tại {exportedPath}</div>}

      {workspace.scenes.length === 0 ? (
        <div className="storyboard-empty">
          <h3>Chưa nhập storyboard</h3>
          <p>Chọn đồng thời <code>scenes.json</code> và <code>shots.json</code> do Codex tạo.</p>
        </div>
      ) : (
        <div className="storyboard-columns">
          <nav className="scene-browser" aria-label="Cảnh và shot">
            {workspace.scenes.map((scene) => (
              <section className="scene-block" key={scene.id}>
                <header><span>Cảnh {scene.order + 1}</span><strong>{scene.title}</strong><small>{formatDuration(scene.durationSec)}</small></header>
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
                      <span><strong>{formatUiLabel(shot.visualType)}</strong><small>{shot.visualPurpose}</small></span>
                      <span className={`asset-dot ${asset?.status.toLowerCase().replaceAll('_', '-') ?? 'missing'}`} title={asset ? formatUiLabel(asset.status) : 'Chưa có tài nguyên'} />
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
                  <h3>Shot {selectedShot.order + 1} · {selectedShot.visualPurpose}</h3>
                  <span className="status-pill">{formatDuration(selectedShot.durationSec)}</span>
                </header>
                <dl className="shot-facts">
                  <div><dt>Cảnh</dt><dd>{selectedScene.title}</dd></div>
                  <div><dt>Loại hình ảnh</dt><dd>{formatUiLabel(selectedShot.visualType)}</dd></div>
                  <div><dt>Tuyến tài nguyên</dt><dd>{selectedShot.assetRoute ?? 'Chưa chỉ định'}</dd></div>
                  <div><dt>Bằng chứng</dt><dd>{selectedShot.evidenceRequired ? 'Bắt buộc' : 'Không bắt buộc'}</dd></div>
                </dl>

                {!needsAsset(selectedShot.visualType) ? (
                  <div className="storyboard-empty compact"><p>Shot này được kết xuất từ dữ liệu có cấu trúc và không cần media nhập ngoài.</p></div>
                ) : !selectedAsset ? (
                  <form className="asset-task-form" onSubmit={(event) => void createTask(event)}>
                    <h3>Tạo gói prompt tài nguyên</h3>
                    <div className="flow-quick-start">
                      <WandSparkles aria-hidden="true" size={20} />
                      <div><strong>Google Flow có hỗ trợ</strong><p>Tạo cả prompt ảnh Nano Banana và video Veo từ shot đã duyệt này.</p></div>
                      <button className="primary" disabled={busy} type="button" onClick={() => void prepareFlow()}>Chuẩn bị gói Flow</button>
                    </div>
                    <div className="form-pair">
                      <label>Loại<select value={task.kind} onChange={(event) => setTask({...task, kind: event.target.value as 'IMAGE' | 'VIDEO'})}><option value="IMAGE">Ảnh</option><option value="VIDEO">Video</option></select></label>
                      <label>Nhà cung cấp<select value={task.provider} onChange={(event) => setTask({...task, provider: event.target.value as CreateAssetTaskInput['provider']})}><option value="GOOGLE_FLOW">Google Flow</option><option value="STOCK">Kho media</option><option value="LOCAL">Trên máy</option><option value="OTHER">Khác</option></select></label>
                    </div>
                    <label>Mô tả hình ảnh<textarea rows={2} value={task.brief} onChange={(event) => setTask({...task, brief: event.target.value})} placeholder="Nhập mô tả hình ảnh cần có" required /></label>
                    <label>Prompt tạo/tìm kiếm<textarea rows={4} value={task.prompt} onChange={(event) => setTask({...task, prompt: event.target.value})} placeholder="Nhập prompt tạo hoặc tìm kiếm tài nguyên" required /></label>
                    <label>Prompt loại trừ<textarea rows={2} value={task.negativePrompt ?? ''} onChange={(event) => setTask({...task, negativePrompt: event.target.value})} placeholder="Nhập các yếu tố cần loại trừ" /></label>
                    <label>Ghi chú bản quyền<input value={task.rightsNote} onChange={(event) => setTask({...task, rightsNote: event.target.value})} placeholder="Nhập nguồn và ghi chú quyền sử dụng" required /></label>
                    <button className="primary" disabled={busy} type="submit"><WandSparkles aria-hidden="true" size={16} /> Tạo tác vụ tài nguyên</button>
                  </form>
                ) : (
                  <section className="asset-detail">
                    <div className="asset-status-bar">
                      <h3>Tài nguyên · {selectedAsset.id}</h3>
                      <span className={`health ${selectedAsset.status === 'QA_PASS' ? 'valid' : 'pending'}`}>{formatUiLabel(selectedAsset.status)}</span>
                    </div>

                    {selectedAsset.path ? (
                      <div className="media-preview">
                        {selectedAsset.kind === 'VIDEO' ? <video controls src={previewUrl(projectId, selectedAsset.id)} /> : <img alt={selectedShot.visualPurpose} src={previewUrl(projectId, selectedAsset.id)} />}
                      </div>
                    ) : <div className="media-preview empty-preview">Chưa nhập media</div>}

                    {selectedAsset.task && (
                      <details className="prompt-package" open>
                        <summary>Gói prompt · {formatUiLabel(selectedAsset.task.provider)}</summary>
                        <p>{selectedAsset.task.brief}</p>
                        <pre>{selectedAsset.task.prompt}</pre>
                        {selectedAsset.task.negativePrompt && <small>Loại trừ: {selectedAsset.task.negativePrompt}</small>}
                      </details>
                    )}

                    {selectedAsset.task?.flow && (
                      <section className="flow-assistant-panel" aria-label="Google Flow assisted workflow">
                        <header>
                          <h3>Google Flow · {selectedAsset.task.flow.shotToken}</h3>
                          <span className="status-pill">Prompt v{selectedAsset.task.flow.version}</span>
                        </header>
                        <dl className="flow-settings-grid">
                          <div><dt>Model ảnh</dt><dd>{selectedAsset.task.flow.imageModel}</dd></div>
                          <div><dt>Model video</dt><dd>{selectedAsset.task.flow.videoModel}</dd></div>
                          <div><dt>Tỷ lệ</dt><dd>{selectedAsset.task.flow.aspectRatio}</dd></div>
                          <div><dt>Độ dài clip</dt><dd>{selectedAsset.task.flow.generationDurationSec}s</dd></div>
                        </dl>
                        <div className="flow-prompt-grid">
                          <article><header><strong>Prompt ảnh</strong><button className="secondary" onClick={() => void copyPrompt(selectedAsset.task!.flow!.imagePrompt, 'prompt ảnh')}><Copy aria-hidden="true" size={15} /> Sao chép</button></header><p>{selectedAsset.task.flow.imagePrompt}</p></article>
                          <article><header><strong>Prompt video</strong><button className="secondary" onClick={() => void copyPrompt(selectedAsset.task!.flow!.videoPrompt, 'prompt video')}><Copy aria-hidden="true" size={15} /> Sao chép</button></header><p>{selectedAsset.task.flow.videoPrompt}</p></article>
                        </div>
                        <details className="flow-negative"><summary>Hướng dẫn loại trừ và thành phần</summary><p>{selectedAsset.task.flow.negativeGuidance}</p><small>{selectedAsset.task.flow.ingredients.join(' · ') || 'Không cần thành phần tham chiếu.'}</small></details>
                        <div className="flow-action-row">
                          <button className="primary" disabled={busy} onClick={() => void openFlow()}><ExternalLink aria-hidden="true" size={16} /> Mở Google Flow</button>
                          {selectedAsset.status === 'PLANNED' && <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.updateAssetStatus(projectId, selectedAsset.id, {status: 'AWAITING_HUMAN'}))}><Check aria-hidden="true" size={16} /> Đánh dấu đang tạo</button>}
                          <button className="secondary" disabled={busy} onClick={() => void prepareFlow()}><RefreshCw aria-hidden="true" size={16} /> Tạo lại prompt</button>
                        </div>

                        <section className="flow-inbox">
                          <header><div><strong>Hộp thư tải xuống</strong><small>{flowWorkspace?.watchDirectory ?? 'Chưa chọn thư mục'}</small></div><div><button className="secondary" disabled={busy} onClick={() => void chooseWatchDirectory()}><FolderOpen aria-hidden="true" size={16} /> Chọn thư mục</button><button className="secondary" disabled={busy || !flowWorkspace?.watchDirectory} onClick={() => void scanCandidates()}><RefreshCw aria-hidden="true" size={16} /> Quét ngay</button></div></header>
                          <div className="flow-candidate-grid">
                            {flowCandidates.map((candidate) => <article className="flow-candidate" key={candidate.id}>
                              <div className="candidate-preview">{candidate.kind === 'VIDEO' ? <video controls preload="metadata" src={candidatePreviewUrl(projectId, candidate.id)} /> : <img loading="lazy" alt={`Flow candidate ${candidate.fileName}`} src={candidatePreviewUrl(projectId, candidate.id)} />}</div>
                              <div className="candidate-copy"><strong>{candidate.fileName}</strong><small>{formatUiLabel(candidate.kind)} · {(candidate.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</small><span className={`table-status ${candidate.status === 'SELECTED' ? 'fresh' : 'stale'}`}>{formatUiLabel(candidate.status)}</span>{candidate.suggestedShotId && <small>Đề xuất: {candidate.suggestedShotId}</small>}</div>
                              <div className="candidate-actions"><button className="primary" disabled={busy || candidate.status === 'SELECTED'} onClick={() => confirmCandidate(candidate)}><Check aria-hidden="true" size={15} /> Duyệt ánh xạ</button><button className="danger" disabled={busy || candidate.status === 'SELECTED'} onClick={() => void rejectCandidate(candidate.id)}><X aria-hidden="true" size={15} /> Từ chối</button></div>
                            </article>)}
                          </div>
                          {flowCandidates.length === 0 && <p className="flow-empty">Tải ảnh/video từ Flow, nên có mã <code>{selectedAsset.task.flow.shotToken}</code> trong tên tệp, sau đó quét.</p>}
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
                        <p>Thả tệp thay thế vào đây hoặc chọn một tệp trên máy.</p>
                        <button className="secondary" disabled={busy} onClick={() => void run(() => window.narra.chooseAndImportAssetMedia(projectId, selectedAsset.id))}><Upload aria-hidden="true" size={16} /> Nhập media</button>
                      </div>
                    ) : null}

                    {selectedAsset.metadata && (
                      <dl className="media-metadata">
                        <div><dt>Định dạng</dt><dd>{selectedAsset.metadata.format}</dd></div>
                        <div><dt>Codec</dt><dd>{selectedAsset.metadata.videoCodec ?? selectedAsset.metadata.audioCodec ?? '—'}</dd></div>
                        <div><dt>Độ phân giải</dt><dd>{selectedAsset.metadata.width && selectedAsset.metadata.height ? `${selectedAsset.metadata.width}×${selectedAsset.metadata.height}` : '—'}</dd></div>
                        <div><dt>Tỷ lệ</dt><dd>{selectedAsset.metadata.aspectRatio ?? '—'}</dd></div>
                        <div><dt>Thời lượng</dt><dd>{formatDuration(selectedAsset.metadata.durationSec)}</dd></div>
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
            ) : <div className="storyboard-empty">Chọn một shot để xem chi tiết.</div>}
          </article>
        </div>
      )}
      {candidateToConfirm && (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCandidateToConfirm(null); }}>
          <section className="candidate-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-dialog-title">
            <header><h3 id="candidate-dialog-title">Ánh xạ ứng viên vào tác vụ tài nguyên</h3><button className="icon-button" aria-label="Đóng hộp thoại ứng viên" onClick={() => setCandidateToConfirm(null)}><X aria-hidden="true" size={17} /></button></header>
            <div className="dialog-preview">{candidateToConfirm.kind === 'VIDEO' ? <video controls src={candidatePreviewUrl(projectId, candidateToConfirm.id)} /> : <img alt={candidateToConfirm.fileName} src={candidatePreviewUrl(projectId, candidateToConfirm.id)} />}</div>
            <p className="candidate-file-name">{candidateToConfirm.fileName}</p>
            <label>Shot và tác vụ tài nguyên đích<select value={candidateAssetId} onChange={(event) => setCandidateAssetId(event.target.value)}><option value="">Chọn đích…</option>{workspace.assets.filter((asset) => asset.kind === candidateToConfirm.kind && asset.task?.provider === 'GOOGLE_FLOW').map((asset) => <option key={asset.id} value={asset.id}>{asset.shotId} · {asset.id}</option>)}</select></label>
            <div className="dialog-note"><strong>Không tự động phê duyệt</strong><p>Narra sẽ sao chép tệp này vào dự án, gắn nguồn gốc prompt và đặt trạng thái Đã chọn. QA tài nguyên vẫn đang chờ.</p></div>
            <footer><button className="secondary" onClick={() => setCandidateToConfirm(null)}>Hủy</button><button className="primary" disabled={busy || !candidateAssetId} onClick={() => void selectCandidate()}><Check aria-hidden="true" size={16} /> Nhập và chọn</button></footer>
          </section>
        </div>
      )}
    </section>
  );
};
