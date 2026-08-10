import {useEffect, useState} from 'react';
import type {ApprovalGate, ProjectDetail, RenderTarget, ReviewWorkspace} from '@narra/project-store';
import {Check, FileVideo, Paperclip, Play, RotateCcw, Square, X} from 'lucide-react';
import {formatUiDate, formatUiLabel} from './ui-locale';

export const ReviewWorkspaceView = ({projectId, onProjectRefresh}: {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
}) => {
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setWorkspace(await window.narra.getReviewWorkspace(projectId));
  };

  useEffect(() => {
    setBusy(true);
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải trạng thái duyệt.')).finally(() => setBusy(false));
  }, [projectId]);

  useEffect(() => {
    if (!workspace?.jobs.some(({status}) => status === 'QUEUED' || status === 'RUNNING')) return;
    const timer = window.setInterval(() => {
      window.narra.getReviewWorkspace(projectId).then(setWorkspace).catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [projectId, workspace?.jobs.map(({id, status}) => `${id}:${status}`).join('|')]);

  const act = async (action: () => Promise<ReviewWorkspace>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await action());
      onProjectRefresh(await window.narra.getProject(projectId));
      setNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác duyệt không thành công.');
    } finally {
      setBusy(false);
    }
  };

  const approve = (gate: ApprovalGate) => act(() => window.narra.approveGate(projectId, gate, note));
  const revoke = (gate: ApprovalGate) => act(() => window.narra.revokeGate(projectId, gate, note));
  const queue = (target: RenderTarget) => act(() => window.narra.queueRender(projectId, target));
  const cancel = (jobId: string) => act(() => window.narra.cancelJob(projectId, jobId));
  const retry = (jobId: string) => act(() => window.narra.retryJob(projectId, jobId));
  const attach = async (jobId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.narra.chooseAndAttachRenderOutput(projectId, jobId);
      if (next) setWorkspace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể gắn video kết xuất.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="review-empty">{error ?? 'Đang tải không gian duyệt…'}</div>;

  return (
    <section className="review-workspace">
      <header className="review-toolbar">
        <div><p className="section-label">Quy trình phê duyệt</p><h3>Bảy cổng duyệt trên một lộ trình rõ ràng</h3></div>
        <label>Ghi chú phê duyệt<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú quyết định, không bắt buộc" /></label>
      </header>
      {error && <div className="notice error-notice">{error}</div>}
      <div className="gate-list">
        {workspace.approvals.map((approval, index) => (
          <article className={`gate-card ${approval.status.toLowerCase()} ${approval.unlocked ? '' : 'locked'}`} key={approval.gate}>
            <div className="gate-index">{String(index + 1).padStart(2, '0')}</div>
            <div className="gate-copy">
              <div><h4>{formatUiLabel(approval.gate)}</h4><span>{formatUiLabel(approval.status)}</span></div>
              <p>{approval.readinessMessage}</p>
              <small>{formatUiDate(approval.approvedAt)}{approval.note ? ` · ${approval.note}` : ''}</small>
            </div>
            <div className="gate-actions">
              {approval.status !== 'APPROVED' && <button className="primary" disabled={busy || !approval.unlocked || !approval.ready} onClick={() => void approve(approval.gate)}><Check aria-hidden="true" size={16} /> Phê duyệt</button>}
              {approval.status === 'APPROVED' && <button className="danger" disabled={busy} onClick={() => void revoke(approval.gate)}><X aria-hidden="true" size={16} /> Thu hồi</button>}
            </div>
          </article>
        ))}
      </div>
      <section className="render-panel">
        <header>
          <div><p className="section-label">Hàng đợi local</p><h3>Snapshot có phiên bản, tiến độ và khả năng phục hồi</h3></div>
          <div className="actions"><button className="secondary" disabled={busy} onClick={() => void queue('ROUGH')}><Play aria-hidden="true" size={16} /> Xếp bản dựng thô</button><button className="primary" disabled={busy} onClick={() => void queue('FINAL')}><FileVideo aria-hidden="true" size={16} /> Xếp bản cuối</button></div>
        </header>
        {workspace.jobs.length === 0 ? <p className="render-empty">Chưa có yêu cầu kết xuất. Hãy duyệt tài nguyên trước khi xếp bản dựng thô.</p> : workspace.jobs.map((job) => (
          <article className="render-job" key={job.id}>
            <p className="section-label">{formatUiLabel(job.type)}</p>
            <div><strong>{formatUiLabel(job.target)} · v{job.version}</strong><span className={`job-state ${job.status.toLowerCase()}`}>{formatUiLabel(job.status)}</span><small>{formatUiDate(job.updatedAt)}</small></div>
            <code>{job.inputSnapshotPath}</code>
            <progress max={1} value={job.progress} aria-label={`Tiến độ kết xuất ${Math.round(job.progress * 100)} phần trăm`} />
            <small>Lần chạy {job.attempt} · {Math.round(job.progress * 100)}% · phạm vi {job.scope}</small>
            {job.errorMessage && <p className="notice error-notice">{job.errorMessage}</p>}
            {job.outputPath
              ? <p className="render-output">Đầu ra: {job.outputPath}</p>
              : <div className="actions">
                  {(job.status === 'QUEUED' || job.status === 'RUNNING') && <button className="danger" disabled={busy || job.cancelRequested} onClick={() => void cancel(job.id)}><Square aria-hidden="true" size={15} /> {job.cancelRequested ? 'Đang hủy…' : 'Hủy'}</button>}
                  {(job.status === 'RETRYABLE_FAILED' || job.status === 'CANCELLED') && <button className="primary" disabled={busy} onClick={() => void retry(job.id)}><RotateCcw aria-hidden="true" size={16} /> Thử lại job này</button>}
                  {job.type === 'RENDER' && job.status !== 'RUNNING' && <button className="secondary" disabled={busy} onClick={() => void attach(job.id)}><Paperclip aria-hidden="true" size={16} /> Gắn video có sẵn</button>}
                </div>}
            <details><summary>Nhật ký</summary><pre>{job.log || 'Chưa có nhật ký.'}</pre></details>
          </article>
        ))}
      </section>
    </section>
  );
};
