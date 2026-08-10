import {useEffect, useMemo, useState} from 'react';
import type {
  ApprovalGate,
  EditorialDocument,
  EditorialWorkspace,
  ProjectDetail,
  ReviewWorkspace,
  SaveOutlineInput,
} from '@narra/project-store';
import type {AiStage, OutlineSection, ThesisCandidate, TopicCandidate} from '@narra/contracts';
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  ExternalLink,
  FileText,
  GripVertical,
  LayoutList,
  Lightbulb,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Sparkles,
} from 'lucide-react';

type EditorialTab = 'RESEARCH' | 'TOPIC' | 'THESIS' | 'OUTLINE' | 'SCRIPT' | 'STORYBOARD';

const formatLabel = (value: string): string => {
  const normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const stageInstructions: Record<AiStage, string> = {
  DISCOVER: 'Find 3–5 defensible documentary topics. Score each angle, explain its hook and risks, and use the current project question as the starting point.',
  RESEARCH: 'Research the selected direction using opened primary, official, academic, or reputable sources. Record research questions, facts, counterpoints, uncertainty, source cards, and an evidence checklist.',
  THESIS: 'Propose 2–3 specific, falsifiable thesis candidates supported by the recorded facts. Address the strongest counterpoint.',
  OUTLINE: 'Create a complete documentary outline with ordered chapters, objective, planned claims, source IDs, content notes, and target duration.',
  SCRIPT: 'Write the narration draft from the approved thesis and current outline. Map material claims to facts and report unsupported claims and pacing warnings.',
  STORYBOARD: 'Create scenes and shots from the approved script. Cover every material claim, give each shot a visual purpose and explicit asset route, and align durations.',
};

const tabs: Array<{id: EditorialTab; label: string; icon: typeof Search}> = [
  {id: 'RESEARCH', label: 'Research', icon: Search},
  {id: 'TOPIC', label: 'Topic', icon: Lightbulb},
  {id: 'THESIS', label: 'Thesis', icon: ScrollText},
  {id: 'OUTLINE', label: 'Outline', icon: LayoutList},
  {id: 'SCRIPT', label: 'Script', icon: FileText},
  {id: 'STORYBOARD', label: 'Storyboard', icon: BookOpenText},
];

export const EditorialWorkspaceView = ({projectId, onProjectRefresh}: {
  projectId: string;
  onProjectRefresh: (detail: ProjectDetail) => void;
}) => {
  const [workspace, setWorkspace] = useState<EditorialWorkspace | null>(null);
  const [review, setReview] = useState<ReviewWorkspace | null>(null);
  const [active, setActive] = useState<EditorialTab>('RESEARCH');
  const [scriptDraft, setScriptDraft] = useState('');
  const [researchDraft, setResearchDraft] = useState('');
  const [topicDrafts, setTopicDrafts] = useState<Record<string, TopicCandidate>>({});
  const [thesisDrafts, setThesisDrafts] = useState<Record<string, string>>({});
  const [outlineDraft, setOutlineDraft] = useState<OutlineSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [runningStage, setRunningStage] = useState<AiStage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const hydrate = (value: EditorialWorkspace): void => {
    setWorkspace(value);
    setScriptDraft(value.script);
    setResearchDraft(value.researchBrief);
    setTopicDrafts(Object.fromEntries(value.topicCandidates.map((item) => [item.id, item])));
    setThesisDrafts(Object.fromEntries(value.thesisCandidates.map((item) => [item.id, item.statement])));
    setOutlineDraft([...value.outlineSections].sort((left, right) => left.order - right.order));
  };

  const reload = async (): Promise<void> => {
    const [editorial, nextReview] = await Promise.all([
      window.narra.getEditorialWorkspace(projectId),
      window.narra.getReviewWorkspace(projectId),
    ]);
    hydrate(editorial);
    setReview(nextReview);
    onProjectRefresh(await window.narra.getProject(projectId));
  };

  useEffect(() => {
    setBusy(true);
    void reload()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load editorial artifacts.'))
      .finally(() => setBusy(false));
  }, [projectId]);

  useEffect(() => window.narra.onCodexEvent((event) => {
    if (event.projectId !== projectId) return;
    if (event.type === 'editorialStageCompleted') {
      setRunningStage(null);
      setMessage(`${formatLabel(String(event.stage))} completed and passed local validation.`);
      void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not reload generated artifacts.'));
    } else if (event.type === 'editorialStageFailed') {
      setRunningStage(null);
      setError(typeof event.message === 'string' ? event.message : 'Structured output failed validation.');
    }
  }), [projectId]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The editorial operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const runStage = async (stage: AiStage, instruction = stageInstructions[stage]): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setRunningStage(stage);
    try {
      await window.narra.codexRunEditorialStage(projectId, {stage, instruction});
      setMessage(`${formatLabel(stage)} is running in Codex. You can follow tool activity in AI workspace.`);
    } catch (reason) {
      setRunningStage(null);
      setError(reason instanceof Error ? reason.message : 'Could not start the structured editorial stage.');
    } finally {
      setBusy(false);
    }
  };

  const saveDocument = async (document: EditorialDocument, content: string): Promise<void> => run(async () => {
    hydrate(await window.narra.saveEditorialDocument(projectId, document, content));
    setReview(await window.narra.getReviewWorkspace(projectId));
    onProjectRefresh(await window.narra.getProject(projectId));
    setMessage(`${formatLabel(document)} saved locally.`);
  });

  const approve = async (gate: ApprovalGate): Promise<void> => run(async () => {
    setReview(await window.narra.approveGate(projectId, gate, `Approved in ${active.toLowerCase()} workspace.`));
    onProjectRefresh(await window.narra.getProject(projectId));
    setMessage(`${formatLabel(gate)} approved.`);
  });

  const gate = (name: ApprovalGate) => review?.approvals.find((item) => item.gate === name);
  const topicScores = useMemo(() => Object.values(topicDrafts), [topicDrafts]);

  const selectTopic = (candidateId: string): Promise<void> => run(async () => {
    const candidate = topicDrafts[candidateId];
    if (!candidate) throw new Error('Topic candidate is missing.');
    hydrate(await window.narra.selectTopicCandidate(projectId, candidateId, {
      title: candidate.title, hook: candidate.hook, angle: candidate.angle, rationale: candidate.rationale,
    }));
    setReview(await window.narra.getReviewWorkspace(projectId));
    setMessage('Topic selection saved. Approval remains a separate creator action.');
  });

  const selectThesis = (candidate: ThesisCandidate): Promise<void> => run(async () => {
    hydrate(await window.narra.selectThesisCandidate(projectId, candidate.id, thesisDrafts[candidate.id] ?? candidate.statement));
    setReview(await window.narra.getReviewWorkspace(projectId));
    setMessage('Thesis selection saved. Approval remains a separate creator action.');
  });

  const moveOutline = (id: string, delta: number): void => {
    const index = outlineDraft.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= outlineDraft.length) return;
    const next = [...outlineDraft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOutlineDraft(next.map((item, order) => ({...item, order})));
  };

  const dropOutline = (targetId: string): void => {
    if (!draggedId || draggedId === targetId) return;
    const source = outlineDraft.findIndex(({id}) => id === draggedId);
    const target = outlineDraft.findIndex(({id}) => id === targetId);
    if (source < 0 || target < 0) return;
    const next = [...outlineDraft];
    const [item] = next.splice(source, 1);
    next.splice(target, 0, item!);
    setOutlineDraft(next.map((section, order) => ({...section, order})));
    setDraggedId(null);
  };

  const saveOutline = (): Promise<void> => run(async () => {
    const input: SaveOutlineInput = outlineDraft.map(({id, title, objective, claimIds, sourceIds, targetDurationSec, contentNotes}) => ({
      id, title, objective, claimIds, sourceIds, targetDurationSec, contentNotes,
    }));
    hydrate(await window.narra.saveOutline(projectId, input));
    setReview(await window.narra.getReviewWorkspace(projectId));
    setMessage('Outline order and edits saved locally.');
  });

  if (!workspace) return <div className="editorial-empty">{error ?? (busy ? 'Loading editorial workspace…' : 'No editorial workspace.')}</div>;

  const stageButton = (stage: AiStage, label: string, instruction?: string) => (
    <button className="primary" disabled={busy || Boolean(runningStage)} onClick={() => void runStage(stage, instruction)}>
      {runningStage === stage ? <RefreshCw className="spin" aria-hidden="true" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
      {runningStage === stage ? 'Running…' : label}
    </button>
  );

  return (
    <section className="editorial-workspace">
      <header className="editorial-toolbar">
        <div><p className="section-label">Structured editorial desk</p><h3>Evidence to storyboard, with creator gates</h3></div>
        <span className="workflow-status">{runningStage ? `${formatLabel(runningStage)} running` : 'Ready'}</span>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}
      <nav className="sub-tabs editorial-stage-tabs" aria-label="Editorial stage">
        {tabs.map(({id, label, icon: Icon}) => (
          <button key={id} aria-selected={active === id} onClick={() => { setActive(id); setMessage(null); }}>
            <Icon aria-hidden="true" size={16} /> {label}
          </button>
        ))}
      </nav>

      {active === 'RESEARCH' && (
        <div className="editorial-stage-layout">
          <section className="stage-main">
            <header className="stage-heading"><div><h4>Research packet</h4><p>Questions, opened sources, facts, uncertainty and evidence checks.</p></div><div className="stage-actions">{stageButton('DISCOVER', 'Discover topics')}{stageButton('RESEARCH', 'Run research')}</div></header>
            <label htmlFor="research-packet">Research packet (Markdown)</label>
            <textarea id="research-packet" rows={15} value={researchDraft} onChange={(event) => setResearchDraft(event.target.value)} />
            <button className="secondary" disabled={busy} onClick={() => void saveDocument('RESEARCH', researchDraft)}><Save aria-hidden="true" size={16} /> Save manual edits</button>
            <div className="source-table-wrap">
              <table className="data-table source-table"><thead><tr><th>Source</th><th>Type</th><th>Publisher</th><th>Open</th></tr></thead><tbody>
                {workspace.sources.map((source) => <tr key={source.id}><td><strong>{source.title}</strong><small>{source.id}</small></td><td>{formatLabel(source.sourceType)}</td><td>{source.publisher}</td><td><button className="icon-button" aria-label={`Open ${source.title}`} onClick={() => void window.narra.openExternalUrl(source.url)}><ExternalLink aria-hidden="true" size={16} /></button></td></tr>)}
              </tbody></table>
              {workspace.sources.length === 0 && <p className="structured-empty">No sources yet. Run research after discovering a direction.</p>}
            </div>
          </section>
          <aside className="evidence-panel structured-evidence"><p className="section-label">Fact and confidence</p>{workspace.facts.map((fact) => <article key={fact.id}><strong>{fact.statement}</strong><span className={`evidence-state ${fact.confidence.toLowerCase()}`}>{formatLabel(fact.confidence)}</span><small>{fact.sourceIds.join(', ')}</small></article>)}{workspace.facts.length === 0 && <p className="empty-evidence">No validated facts yet.</p>}</aside>
        </div>
      )}

      {active === 'TOPIC' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Topic grid</h4><p>Edit a candidate, select it, then approve Topic as a separate decision.</p></div><div className="stage-actions">{stageButton('DISCOVER', 'Regenerate topics')}<button className="secondary" disabled={!gate('TOPIC')?.ready || gate('TOPIC')?.status === 'APPROVED' || busy} onClick={() => void approve('TOPIC')}><Check aria-hidden="true" size={16} /> Approve topic</button></div></header>
          <div className="topic-grid">{topicScores.sort((a, b) => a.recommendationRank - b.recommendationRank).map((candidate) => <article className={`topic-card ${candidate.selected ? 'selected' : ''}`} key={candidate.id}>
            <header><span className="rank-badge">#{candidate.recommendationRank}</span>{candidate.selected && <span className="selected-badge"><Check aria-hidden="true" size={13} /> Selected</span>}</header>
            <label>Title<input value={candidate.title} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, title: event.target.value}}))} /></label>
            <label>Hook<textarea rows={2} value={candidate.hook} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, hook: event.target.value}}))} /></label>
            <label>Angle<textarea rows={2} value={candidate.angle} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, angle: event.target.value}}))} /></label>
            <label>Why it works<textarea rows={3} value={candidate.rationale} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, rationale: event.target.value}}))} /></label>
            <div className="score-grid">{Object.entries(candidate.scores).map(([name, score]) => <div key={name}><span>{formatLabel(name)}</span><strong>{score}</strong></div>)}</div>
            {candidate.risks.length > 0 && <p className="risk-note">Risk: {candidate.risks.join(' · ')}</p>}
            <button className={candidate.selected ? 'secondary' : 'primary'} disabled={busy || gate('TOPIC')?.status === 'APPROVED'} onClick={() => void selectTopic(candidate.id)}><Check aria-hidden="true" size={16} /> {candidate.selected ? 'Save selected topic' : 'Select this topic'}</button>
          </article>)}</div>
          {topicScores.length === 0 && <p className="structured-empty">No topic candidates yet. Start with Discover topics.</p>}
        </section>
      )}

      {active === 'THESIS' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Thesis candidates</h4><p>Choose a supportable argument—not just a subject.</p></div><div className="stage-actions">{stageButton('THESIS', 'Generate theses')}<button className="secondary" disabled={!gate('THESIS')?.ready || gate('THESIS')?.status === 'APPROVED' || busy} onClick={() => void approve('THESIS')}><Check aria-hidden="true" size={16} /> Approve thesis</button></div></header>
          <div className="candidate-list">{workspace.thesisCandidates.map((candidate) => <article className="thesis-card" key={candidate.id}>
            <label>Thesis statement<textarea rows={3} value={thesisDrafts[candidate.id] ?? candidate.statement} onChange={(event) => setThesisDrafts((value) => ({...value, [candidate.id]: event.target.value}))} /></label>
            <dl><div><dt>Counterpoint</dt><dd>{candidate.counterpoint}</dd></div><div><dt>Falsifiability</dt><dd>{candidate.falsifiabilityNote}</dd></div><div><dt>Supporting facts</dt><dd>{candidate.supportingFactIds.join(', ')}</dd></div></dl>
            <button className={workspace.thesis === (thesisDrafts[candidate.id] ?? candidate.statement) ? 'secondary' : 'primary'} disabled={busy || gate('THESIS')?.status === 'APPROVED'} onClick={() => void selectThesis(candidate)}><Check aria-hidden="true" size={16} /> Select and save</button>
          </article>)}</div>
          {workspace.thesisCandidates.length === 0 && <p className="structured-empty">Approve a topic, then generate 2–3 thesis candidates.</p>}
        </section>
      )}

      {active === 'OUTLINE' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Documentary outline</h4><p>Drag or use arrow buttons to reorder. Edit each section directly.</p></div><div className="stage-actions">{stageButton('OUTLINE', outlineDraft.length ? 'Regenerate outline' : 'Generate outline')}<button className="secondary" disabled={busy || outlineDraft.length === 0} onClick={() => void saveOutline()}><Save aria-hidden="true" size={16} /> Save outline</button></div></header>
          <div className="outline-list">{outlineDraft.map((section, index) => <article draggable className="outline-card" key={section.id} onDragStart={() => setDraggedId(section.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOutline(section.id)}>
            <div className="outline-handle"><GripVertical aria-hidden="true" size={18} /><span>{index + 1}</span><div><button className="icon-button" aria-label="Move section up" disabled={index === 0} onClick={() => moveOutline(section.id, -1)}><ArrowUp aria-hidden="true" size={15} /></button><button className="icon-button" aria-label="Move section down" disabled={index === outlineDraft.length - 1} onClick={() => moveOutline(section.id, 1)}><ArrowDown aria-hidden="true" size={15} /></button></div></div>
            <div className="outline-fields"><label>Chapter title<input value={section.title} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, title: event.target.value} : item))} /></label><label>Objective<textarea rows={2} value={section.objective} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, objective: event.target.value} : item))} /></label><label>Content notes<textarea rows={3} value={section.contentNotes ?? ''} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, contentNotes: event.target.value} : item))} /></label><div className="outline-meta"><label>Duration (sec)<input type="number" min="1" value={section.targetDurationSec} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, targetDurationSec: Number(event.target.value)} : item))} /></label><span>Claims: {section.claimIds.join(', ') || 'None'}</span><span>Sources: {section.sourceIds.join(', ') || 'None'}</span></div></div>
            <button className="secondary rewrite-button" disabled={busy} onClick={() => void runStage('OUTLINE', `Rewrite outline section ${section.id} (${section.title}) while preserving all other section IDs and their order. Return the complete outline.`)}><Sparkles aria-hidden="true" size={15} /> Rewrite section</button>
          </article>)}</div>
          {outlineDraft.length === 0 && <p className="structured-empty">Approve a thesis, then generate the structured outline.</p>}
        </section>
      )}

      {active === 'SCRIPT' && (
        <div className="editorial-stage-layout">
          <section className="stage-main"><header className="stage-heading"><div><h4>Narration script</h4><p>Generate from the approved thesis and current outline, then resolve QA before approval.</p></div><div className="stage-actions">{stageButton('SCRIPT', 'Generate script')}<button className="secondary" disabled={busy} onClick={() => void saveDocument('SCRIPT', scriptDraft)}><Save aria-hidden="true" size={16} /> Save</button><button className="secondary" disabled={!gate('SCRIPT')?.ready || gate('SCRIPT')?.status === 'APPROVED' || busy} onClick={() => void approve('SCRIPT')}><Check aria-hidden="true" size={16} /> Approve script</button></div></header><label htmlFor="script-document">Narration script (Markdown)</label><textarea id="script-document" rows={24} value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} /><pre className="qa-report">{workspace.scriptQaReport || 'No AI script QA report yet.'}</pre></section>
          <aside className="evidence-panel structured-evidence"><p className="section-label">Claim and source mapping</p>{workspace.claims.map((claim) => <article key={claim.id}><strong>{claim.statement}</strong><span className={`evidence-state ${claim.status.toLowerCase().replace('_', '-')}`}>{formatLabel(claim.status)}</span><small>Facts: {claim.factIds.join(', ')}</small></article>)}{workspace.claims.length === 0 && <p className="empty-evidence">No structured claims yet.</p>}</aside>
        </div>
      )}

      {active === 'STORYBOARD' && (
        <section className="stage-main storyboard-stage"><header className="stage-heading"><div><h4>Storyboard handoff</h4><p>Generate validated scenes and shots from the approved script. Review the result in Storyboard & assets.</p></div>{stageButton('STORYBOARD', 'Generate storyboard')}</header><div className="handoff-card"><BookOpenText aria-hidden="true" size={24} /><div><strong>Human approval is preserved</strong><p>Generation writes scenes and shots only after schema and provenance validation. It never approves the Storyboard gate.</p></div></div></section>
      )}
    </section>
  );
};
