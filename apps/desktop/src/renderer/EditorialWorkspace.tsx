import {useEffect, useState} from 'react';
import type {EditorialDocument, EditorialWorkspace, ProjectDetail} from '@narra/project-store';

type EditorialTab = 'RESEARCH' | 'THESIS' | 'SCRIPT';

export const EditorialWorkspaceView = ({projectId, onProjectRefresh}: {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
}) => {
  const [workspace, setWorkspace] = useState<EditorialWorkspace | null>(null);
  const [active, setActive] = useState<EditorialTab>('RESEARCH');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contentFor = (next: EditorialTab, value: EditorialWorkspace): string =>
    next === 'RESEARCH' ? value.researchBrief : next === 'THESIS' ? value.thesis : value.script;

  useEffect(() => {
    setBusy(true);
    window.narra.getEditorialWorkspace(projectId)
      .then((value) => { setWorkspace(value); setDraft(contentFor('RESEARCH', value)); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load editorial artifacts.'))
      .finally(() => setBusy(false));
  }, [projectId]);

  const switchTab = (next: EditorialTab): void => {
    if (!workspace) return;
    setActive(next);
    setDraft(contentFor(next, workspace));
    setMessage(null);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await window.narra.saveEditorialDocument(projectId, active as EditorialDocument, draft);
      setWorkspace(next);
      setDraft(contentFor(active, next));
      onProjectRefresh(await window.narra.getProject(projectId));
      setMessage(`${active.toLowerCase()} saved locally.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the document.');
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="editorial-empty">{error ?? (busy ? 'Loading editorial workspace…' : 'No editorial workspace.')}</div>;

  return (
    <section className="editorial-workspace">
      <header className="editorial-toolbar">
        <div><p className="section-label">EDITORIAL DESK</p><h3>Research, thesis and script</h3></div>
        <button className="primary" disabled={busy} onClick={() => void save()}>Save {active.toLowerCase()}</button>
      </header>
      {error && <div className="notice error-notice">{error}</div>}
      {message && <div className="notice success-notice">{message}</div>}
      <nav className="sub-tabs" aria-label="Editorial document">
        {(['RESEARCH', 'THESIS', 'SCRIPT'] as const).map((tab) => (
          <button key={tab} aria-selected={active === tab} onClick={() => switchTab(tab)}>{tab}</button>
        ))}
      </nav>
      <div className="editorial-columns">
        <div className="document-editor">
          <label htmlFor="editorial-document">{active === 'RESEARCH' ? 'Research packet (Markdown)' : active === 'THESIS' ? 'Selected thesis' : 'Narration script (Markdown)'}</label>
          <textarea id="editorial-document" rows={24} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck />
          <small>Saved in the portable project folder. Editing thesis or script revokes downstream approvals.</small>
        </div>
        <aside className="evidence-panel">
          <p className="section-label">{active === 'SCRIPT' ? 'CLAIM / SOURCE CHECK' : 'RESEARCH EVIDENCE'}</p>
          {active === 'SCRIPT' ? workspace.claims.map((claim) => (
            <article key={claim.id}>
              <strong>{claim.statement}</strong>
              <span className={`evidence-state ${claim.status.toLowerCase().replace('_', '-')}`}>{claim.status.replace('_', ' ')}</span>
              <small>{claim.factIds.length} linked fact(s) · script v{claim.scriptVersion}</small>
            </article>
          )) : workspace.facts.map((fact) => (
            <article key={fact.id}>
              <strong>{fact.statement}</strong>
              <span className={`evidence-state ${fact.confidence.toLowerCase()}`}>{fact.confidence} confidence</span>
              <small>{fact.sourceIds.length} linked source(s)</small>
            </article>
          ))}
          {(active === 'SCRIPT' ? workspace.claims : workspace.facts).length === 0 && <p className="empty-evidence">No structured evidence entries yet.</p>}
          <details className="source-register">
            <summary>Source register · {workspace.sources.length}</summary>
            {workspace.sources.map((source) => <p key={source.id}><strong>{source.title}</strong><small>{source.publisher} · {source.sourceType.replace('_', ' ')}</small></p>)}
          </details>
        </aside>
      </div>
    </section>
  );
};
