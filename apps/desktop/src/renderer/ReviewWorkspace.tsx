import {useEffect, useState} from 'react';
import type {ApprovalGate, ProjectDetail, RenderTarget, ReviewWorkspace} from '@narra/project-store';

const formatDate = (value: string | null): string => value
  ? new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value))
  : 'Not approved';

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
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load review state.')).finally(() => setBusy(false));
  }, [projectId]);

  const act = async (action: () => Promise<ReviewWorkspace>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await action());
      onProjectRefresh(await window.narra.getProject(projectId));
      setNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Review action failed.');
    } finally {
      setBusy(false);
    }
  };

  const approve = (gate: ApprovalGate) => act(() => window.narra.approveGate(projectId, gate, note));
  const revoke = (gate: ApprovalGate) => act(() => window.narra.revokeGate(projectId, gate, note));
  const queue = (target: RenderTarget) => act(() => window.narra.queueRender(projectId, target));
  const attach = async (jobId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.narra.chooseAndAttachRenderOutput(projectId, jobId);
      if (next) setWorkspace(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not attach render output.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="review-empty">{error ?? 'Loading review workspace…'}</div>;

  return (
    <section className="review-workspace">
      <header className="review-toolbar">
        <div><p className="section-label">APPROVAL WORKFLOW</p><h3>Seven gates, one auditable path</h3></div>
        <label>Approval note<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional decision note" /></label>
      </header>
      {error && <div className="notice error-notice">{error}</div>}
      <div className="gate-list">
        {workspace.approvals.map((approval, index) => (
          <article className={`gate-card ${approval.status.toLowerCase()} ${approval.unlocked ? '' : 'locked'}`} key={approval.gate}>
            <div className="gate-index">{String(index + 1).padStart(2, '0')}</div>
            <div className="gate-copy">
              <div><h4>{approval.gate.replace('_', ' ')}</h4><span>{approval.status}</span></div>
              <p>{approval.readinessMessage}</p>
              <small>{formatDate(approval.approvedAt)}{approval.note ? ` · ${approval.note}` : ''}</small>
            </div>
            <div className="gate-actions">
              {approval.status !== 'APPROVED' && <button className="primary" disabled={busy || !approval.unlocked || !approval.ready} onClick={() => void approve(approval.gate)}>Approve</button>}
              {approval.status === 'APPROVED' && <button className="danger" disabled={busy} onClick={() => void revoke(approval.gate)}>Revoke</button>}
            </div>
          </article>
        ))}
      </div>
      <section className="render-panel">
        <header>
          <div><p className="section-label">RENDER QUEUE</p><h3>Versioned snapshots and local logs</h3></div>
          <div className="actions"><button className="secondary" disabled={busy} onClick={() => void queue('ROUGH')}>Queue rough</button><button className="primary" disabled={busy} onClick={() => void queue('FINAL')}>Queue final</button></div>
        </header>
        {workspace.jobs.length === 0 ? <p className="render-empty">No render requests yet. Approve assets before queuing the rough cut.</p> : workspace.jobs.map((job) => (
          <article className="render-job" key={job.id}>
            <div><strong>{job.target} · v{job.version}</strong><span className={`job-state ${job.status.toLowerCase()}`}>{job.status.replace('_', ' ')}</span><small>{formatDate(job.updatedAt)}</small></div>
            <code>{job.inputSnapshotPath}</code>
            {job.outputPath ? <p className="render-output">Output: {job.outputPath}</p> : <button className="secondary" disabled={busy} onClick={() => void attach(job.id)}>Attach completed video</button>}
            <details><summary>Log</summary><pre>{job.log || 'No log entries.'}</pre></details>
          </article>
        ))}
      </section>
    </section>
  );
};
