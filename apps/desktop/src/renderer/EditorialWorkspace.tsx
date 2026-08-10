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
import {formatUiLabel} from './ui-locale';

type EditorialTab = 'RESEARCH' | 'TOPIC' | 'THESIS' | 'OUTLINE' | 'SCRIPT' | 'STORYBOARD';

const stageInstructions: Record<AiStage, string> = {
  DISCOVER: 'Find 3–5 defensible documentary topics. Score each angle, explain its hook and risks, and use the current project question as the starting point.',
  RESEARCH: 'Research the selected direction using opened primary, official, academic, or reputable sources. Record research questions, facts, counterpoints, uncertainty, source cards, and an evidence checklist.',
  THESIS: 'Propose 2–3 specific, falsifiable thesis candidates supported by the recorded facts. Address the strongest counterpoint.',
  OUTLINE: 'Create a complete documentary outline with ordered chapters, objective, planned claims, source IDs, content notes, and target duration.',
  SCRIPT: 'Write the narration draft from the approved thesis and current outline. Map material claims to facts and report unsupported claims and pacing warnings.',
  STORYBOARD: 'Create scenes and shots from the approved script. Cover every material claim, give each shot a visual purpose and explicit asset route, and align durations.',
};

const tabs: Array<{id: EditorialTab; label: string; icon: typeof Search}> = [
  {id: 'RESEARCH', label: 'Nghiên cứu', icon: Search},
  {id: 'TOPIC', label: 'Chủ đề', icon: Lightbulb},
  {id: 'THESIS', label: 'Luận đề', icon: ScrollText},
  {id: 'OUTLINE', label: 'Dàn ý', icon: LayoutList},
  {id: 'SCRIPT', label: 'Kịch bản', icon: FileText},
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
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải dữ liệu biên tập.'))
      .finally(() => setBusy(false));
  }, [projectId]);

  useEffect(() => window.narra.onCodexEvent((event) => {
    if (event.projectId !== projectId) return;
    if (event.type === 'editorialStageCompleted') {
      setRunningStage(null);
      setMessage(`${formatUiLabel(String(event.stage))} đã hoàn thành và vượt qua kiểm tra cục bộ.`);
      void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không thể tải lại dữ liệu đã tạo.'));
    } else if (event.type === 'editorialStageFailed') {
      setRunningStage(null);
      setError(typeof event.message === 'string' ? event.message : 'Đầu ra có cấu trúc không vượt qua kiểm tra.');
    }
  }), [projectId]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác biên tập không thành công.');
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
      setMessage(`${formatUiLabel(stage)} đang chạy trong Codex. Anh có thể theo dõi hoạt động công cụ tại Không gian AI.`);
    } catch (reason) {
      setRunningStage(null);
      setError(reason instanceof Error ? reason.message : 'Không thể bắt đầu giai đoạn biên tập có cấu trúc.');
    } finally {
      setBusy(false);
    }
  };

  const saveDocument = async (document: EditorialDocument, content: string): Promise<void> => run(async () => {
    hydrate(await window.narra.saveEditorialDocument(projectId, document, content));
    setReview(await window.narra.getReviewWorkspace(projectId));
    onProjectRefresh(await window.narra.getProject(projectId));
    setMessage(`Đã lưu ${formatUiLabel(document)} trên máy.`);
  });

  const approve = async (gate: ApprovalGate): Promise<void> => run(async () => {
    setReview(await window.narra.approveGate(projectId, gate, `Đã phê duyệt trong không gian ${active.toLowerCase()}.`));
    onProjectRefresh(await window.narra.getProject(projectId));
    setMessage(`Đã phê duyệt ${formatUiLabel(gate)}.`);
  });

  const gate = (name: ApprovalGate) => review?.approvals.find((item) => item.gate === name);
  const topicScores = useMemo(() => Object.values(topicDrafts), [topicDrafts]);

  const selectTopic = (candidateId: string): Promise<void> => run(async () => {
    const candidate = topicDrafts[candidateId];
    if (!candidate) throw new Error('Không tìm thấy chủ đề đề xuất.');
    hydrate(await window.narra.selectTopicCandidate(projectId, candidateId, {
      title: candidate.title, hook: candidate.hook, angle: candidate.angle, rationale: candidate.rationale,
    }));
    setReview(await window.narra.getReviewWorkspace(projectId));
    setMessage('Đã lưu chủ đề được chọn. Phê duyệt vẫn là một hành động riêng của người sáng tạo.');
  });

  const selectThesis = (candidate: ThesisCandidate): Promise<void> => run(async () => {
    hydrate(await window.narra.selectThesisCandidate(projectId, candidate.id, thesisDrafts[candidate.id] ?? candidate.statement));
    setReview(await window.narra.getReviewWorkspace(projectId));
    setMessage('Đã lưu luận đề được chọn. Phê duyệt vẫn là một hành động riêng của người sáng tạo.');
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
    setMessage('Đã lưu thứ tự và nội dung chỉnh sửa của dàn ý trên máy.');
  });

  if (!workspace) return <div className="editorial-empty">{error ?? (busy ? 'Đang tải không gian biên tập…' : 'Chưa có không gian biên tập.')}</div>;

  const stageButton = (stage: AiStage, label: string, instruction?: string) => (
    <button className="primary" disabled={busy || Boolean(runningStage)} onClick={() => void runStage(stage, instruction)}>
      {runningStage === stage ? <RefreshCw className="spin" aria-hidden="true" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
      {runningStage === stage ? 'Đang chạy…' : label}
    </button>
  );

  return (
    <section className="editorial-workspace">
      <header className="editorial-toolbar">
        <div><p className="section-label">Bàn biên tập có cấu trúc</p><h3>Từ bằng chứng đến storyboard, qua các cổng duyệt</h3></div>
        <span className="workflow-status">{runningStage ? `Đang chạy ${formatUiLabel(runningStage)}` : 'Sẵn sàng'}</span>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {message && <div className="notice success-notice" aria-live="polite">{message}</div>}
      <nav className="sub-tabs editorial-stage-tabs" aria-label="Giai đoạn biên tập">
        {tabs.map(({id, label, icon: Icon}) => (
          <button key={id} aria-selected={active === id} onClick={() => { setActive(id); setMessage(null); }}>
            <Icon aria-hidden="true" size={16} /> {label}
          </button>
        ))}
      </nav>

      {active === 'RESEARCH' && (
        <div className="editorial-stage-layout">
          <section className="stage-main">
            <header className="stage-heading"><div><h4>Hồ sơ nghiên cứu</h4><p>Câu hỏi, nguồn đã mở, dữ kiện, điểm chưa chắc chắn và kiểm tra bằng chứng.</p></div><div className="stage-actions">{stageButton('DISCOVER', 'Khám phá chủ đề')}{stageButton('RESEARCH', 'Chạy nghiên cứu')}</div></header>
            <label htmlFor="research-packet">Hồ sơ nghiên cứu (Markdown)</label>
            <textarea id="research-packet" rows={15} value={researchDraft} onChange={(event) => setResearchDraft(event.target.value)} />
            <button className="secondary" disabled={busy} onClick={() => void saveDocument('RESEARCH', researchDraft)}><Save aria-hidden="true" size={16} /> Lưu chỉnh sửa thủ công</button>
            <div className="source-table-wrap">
              <table className="data-table source-table"><thead><tr><th>Nguồn</th><th>Loại</th><th>Nhà xuất bản</th><th>Mở</th></tr></thead><tbody>
                {workspace.sources.map((source) => <tr key={source.id}><td><strong>{source.title}</strong><small>{source.id}</small></td><td>{formatUiLabel(source.sourceType)}</td><td>{source.publisher}</td><td><button className="icon-button" aria-label={`Mở ${source.title}`} onClick={() => void window.narra.openExternalUrl(source.url)}><ExternalLink aria-hidden="true" size={16} /></button></td></tr>)}
              </tbody></table>
              {workspace.sources.length === 0 && <p className="structured-empty">Chưa có nguồn. Hãy chạy nghiên cứu sau khi xác định hướng đi.</p>}
            </div>
          </section>
          <aside className="evidence-panel structured-evidence"><p className="section-label">Dữ kiện và độ tin cậy</p>{workspace.facts.map((fact) => <article key={fact.id}><strong>{fact.statement}</strong><span className={`evidence-state ${fact.confidence.toLowerCase()}`}>{formatUiLabel(fact.confidence)}</span><small>{fact.sourceIds.join(', ')}</small></article>)}{workspace.facts.length === 0 && <p className="empty-evidence">Chưa có dữ kiện đã kiểm chứng.</p>}</aside>
        </div>
      )}

      {active === 'TOPIC' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Lưới chủ đề</h4><p>Chỉnh sửa và chọn một đề xuất, sau đó phê duyệt Chủ đề bằng một quyết định riêng.</p></div><div className="stage-actions">{stageButton('DISCOVER', 'Tạo lại chủ đề')}<button className="secondary" disabled={!gate('TOPIC')?.ready || gate('TOPIC')?.status === 'APPROVED' || busy} onClick={() => void approve('TOPIC')}><Check aria-hidden="true" size={16} /> Phê duyệt chủ đề</button></div></header>
          <div className="topic-grid">{topicScores.sort((a, b) => a.recommendationRank - b.recommendationRank).map((candidate) => <article className={`topic-card ${candidate.selected ? 'selected' : ''}`} key={candidate.id}>
            <header><span className="rank-badge">#{candidate.recommendationRank}</span>{candidate.selected && <span className="selected-badge"><Check aria-hidden="true" size={13} /> Đã chọn</span>}</header>
            <label>Tiêu đề<input value={candidate.title} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, title: event.target.value}}))} /></label>
            <label>Móc câu<textarea rows={2} value={candidate.hook} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, hook: event.target.value}}))} /></label>
            <label>Góc tiếp cận<textarea rows={2} value={candidate.angle} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, angle: event.target.value}}))} /></label>
            <label>Lý do phù hợp<textarea rows={3} value={candidate.rationale} onChange={(event) => setTopicDrafts((value) => ({...value, [candidate.id]: {...candidate, rationale: event.target.value}}))} /></label>
            <div className="score-grid">{Object.entries(candidate.scores).map(([name, score]) => <div key={name}><span>{formatUiLabel(name)}</span><strong>{score}</strong></div>)}</div>
            {candidate.risks.length > 0 && <p className="risk-note">Rủi ro: {candidate.risks.join(' · ')}</p>}
            <button className={candidate.selected ? 'secondary' : 'primary'} disabled={busy || gate('TOPIC')?.status === 'APPROVED'} onClick={() => void selectTopic(candidate.id)}><Check aria-hidden="true" size={16} /> {candidate.selected ? 'Lưu chủ đề đã chọn' : 'Chọn chủ đề này'}</button>
          </article>)}</div>
          {topicScores.length === 0 && <p className="structured-empty">Chưa có chủ đề đề xuất. Hãy bắt đầu bằng Khám phá chủ đề.</p>}
        </section>
      )}

      {active === 'THESIS' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Các luận đề đề xuất</h4><p>Chọn một lập luận có thể bảo vệ, không chỉ là một đề tài.</p></div><div className="stage-actions">{stageButton('THESIS', 'Tạo luận đề')}<button className="secondary" disabled={!gate('THESIS')?.ready || gate('THESIS')?.status === 'APPROVED' || busy} onClick={() => void approve('THESIS')}><Check aria-hidden="true" size={16} /> Phê duyệt luận đề</button></div></header>
          <div className="candidate-list">{workspace.thesisCandidates.map((candidate) => <article className="thesis-card" key={candidate.id}>
            <label>Phát biểu luận đề<textarea rows={3} value={thesisDrafts[candidate.id] ?? candidate.statement} onChange={(event) => setThesisDrafts((value) => ({...value, [candidate.id]: event.target.value}))} /></label>
            <dl><div><dt>Phản biện</dt><dd>{candidate.counterpoint}</dd></div><div><dt>Khả năng kiểm chứng sai</dt><dd>{candidate.falsifiabilityNote}</dd></div><div><dt>Dữ kiện hỗ trợ</dt><dd>{candidate.supportingFactIds.join(', ')}</dd></div></dl>
            <button className={workspace.thesis === (thesisDrafts[candidate.id] ?? candidate.statement) ? 'secondary' : 'primary'} disabled={busy || gate('THESIS')?.status === 'APPROVED'} onClick={() => void selectThesis(candidate)}><Check aria-hidden="true" size={16} /> Chọn và lưu</button>
          </article>)}</div>
          {workspace.thesisCandidates.length === 0 && <p className="structured-empty">Phê duyệt một chủ đề, sau đó tạo 2–3 luận đề đề xuất.</p>}
        </section>
      )}

      {active === 'OUTLINE' && (
        <section className="stage-main">
          <header className="stage-heading"><div><h4>Dàn ý phim tài liệu</h4><p>Kéo thả hoặc dùng nút mũi tên để sắp xếp. Chỉnh sửa trực tiếp từng phần.</p></div><div className="stage-actions">{stageButton('OUTLINE', outlineDraft.length ? 'Tạo lại dàn ý' : 'Tạo dàn ý')}<button className="secondary" disabled={busy || outlineDraft.length === 0} onClick={() => void saveOutline()}><Save aria-hidden="true" size={16} /> Lưu dàn ý</button></div></header>
          <div className="outline-list">{outlineDraft.map((section, index) => <article draggable className="outline-card" key={section.id} onDragStart={() => setDraggedId(section.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOutline(section.id)}>
            <div className="outline-handle"><GripVertical aria-hidden="true" size={18} /><span>{index + 1}</span><div><button className="icon-button" aria-label="Đưa phần lên" disabled={index === 0} onClick={() => moveOutline(section.id, -1)}><ArrowUp aria-hidden="true" size={15} /></button><button className="icon-button" aria-label="Đưa phần xuống" disabled={index === outlineDraft.length - 1} onClick={() => moveOutline(section.id, 1)}><ArrowDown aria-hidden="true" size={15} /></button></div></div>
            <div className="outline-fields"><label>Tiêu đề chương<input value={section.title} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, title: event.target.value} : item))} /></label><label>Mục tiêu<textarea rows={2} value={section.objective} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, objective: event.target.value} : item))} /></label><label>Ghi chú nội dung<textarea rows={3} value={section.contentNotes ?? ''} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, contentNotes: event.target.value} : item))} /></label><div className="outline-meta"><label>Thời lượng (giây)<input type="number" min="1" value={section.targetDurationSec} onChange={(event) => setOutlineDraft((items) => items.map((item) => item.id === section.id ? {...item, targetDurationSec: Number(event.target.value)} : item))} /></label><span>Luận điểm: {section.claimIds.join(', ') || 'Không có'}</span><span>Nguồn: {section.sourceIds.join(', ') || 'Không có'}</span></div></div>
            <button className="secondary rewrite-button" disabled={busy} onClick={() => void runStage('OUTLINE', `Rewrite outline section ${section.id} (${section.title}) while preserving all other section IDs and their order. Return the complete outline.`)}><Sparkles aria-hidden="true" size={15} /> Viết lại phần này</button>
          </article>)}</div>
          {outlineDraft.length === 0 && <p className="structured-empty">Phê duyệt một luận đề, sau đó tạo dàn ý có cấu trúc.</p>}
        </section>
      )}

      {active === 'SCRIPT' && (
        <div className="editorial-stage-layout">
          <section className="stage-main"><header className="stage-heading"><div><h4>Kịch bản lời đọc</h4><p>Tạo từ luận đề đã duyệt và dàn ý hiện tại, sau đó xử lý QA trước khi phê duyệt.</p></div><div className="stage-actions">{stageButton('SCRIPT', 'Tạo kịch bản')}<button className="secondary" disabled={busy} onClick={() => void saveDocument('SCRIPT', scriptDraft)}><Save aria-hidden="true" size={16} /> Lưu</button><button className="secondary" disabled={!gate('SCRIPT')?.ready || gate('SCRIPT')?.status === 'APPROVED' || busy} onClick={() => void approve('SCRIPT')}><Check aria-hidden="true" size={16} /> Phê duyệt kịch bản</button></div></header><label htmlFor="script-document">Kịch bản lời đọc (Markdown)</label><textarea id="script-document" rows={24} value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} /><pre className="qa-report">{workspace.scriptQaReport || 'Chưa có báo cáo QA kịch bản từ AI.'}</pre></section>
          <aside className="evidence-panel structured-evidence"><p className="section-label">Ánh xạ luận điểm và nguồn</p>{workspace.claims.map((claim) => <article key={claim.id}><strong>{claim.statement}</strong><span className={`evidence-state ${claim.status.toLowerCase().replace('_', '-')}`}>{formatUiLabel(claim.status)}</span><small>Dữ kiện: {claim.factIds.join(', ')}</small></article>)}{workspace.claims.length === 0 && <p className="empty-evidence">Chưa có luận điểm có cấu trúc.</p>}</aside>
        </div>
      )}

      {active === 'STORYBOARD' && (
        <section className="stage-main storyboard-stage"><header className="stage-heading"><div><h4>Bàn giao storyboard</h4><p>Tạo các cảnh và shot đã kiểm tra từ kịch bản được duyệt. Xem kết quả tại Storyboard & tài nguyên.</p></div>{stageButton('STORYBOARD', 'Tạo storyboard')}</header><div className="handoff-card"><BookOpenText aria-hidden="true" size={24} /><div><strong>Vẫn giữ bước phê duyệt của người dùng</strong><p>Hệ thống chỉ ghi cảnh và shot sau khi kiểm tra schema và nguồn gốc. Cổng Storyboard không bao giờ được tự động phê duyệt.</p></div></div></section>
      )}
    </section>
  );
};
