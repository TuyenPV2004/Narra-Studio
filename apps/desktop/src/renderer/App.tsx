import type {FormEvent} from 'react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {ProjectDetail, ProjectRecord} from '@narra/project-store';
import {
  Archive,
  BookOpenText,
  Captions,
  CheckCircle2,
  CircleStop,
  CircleGauge,
  Clapperboard,
  Copy,
  FileStack,
  Film,
  FolderOpen,
  Globe2,
  LayoutDashboard,
  Languages,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ExternalLink,
  WandSparkles,
  SlidersHorizontal,
  Settings2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {StoryboardWorkspaceView} from './StoryboardWorkspace';
import {VoiceWorkspaceView} from './VoiceWorkspace';
import {EditorialWorkspaceView} from './EditorialWorkspace';
import {ReviewWorkspaceView} from './ReviewWorkspace';
import {AiWorkspaceView} from './AiWorkspace';
import {TimelineWorkspaceView} from './TimelineWorkspace';
import {SystemWorkspaceView} from './SystemWorkspace';
import {formatUiDate, formatUiLabel} from './ui-locale';

const workspaceItems = [
  {id: 'overview', label: 'Tổng quan', icon: LayoutDashboard},
  {id: 'ai', label: 'Không gian AI', icon: WandSparkles},
  {id: 'editorial', label: 'Biên tập', icon: BookOpenText},
  {id: 'storyboard', label: 'Storyboard & tài nguyên', icon: Clapperboard},
  {id: 'voice', label: 'Lời đọc & phụ đề', icon: Captions},
  {id: 'timeline', label: 'Dòng thời gian', icon: SlidersHorizontal},
  {id: 'review', label: 'Duyệt & kết xuất', icon: Film},
  {id: 'system', label: 'Hệ thống', icon: Settings2},
] as const;

type QuestionGenerationPhase = 'IDLE' | 'CONNECTING' | 'RESEARCHING' | 'DRAFTING' | 'STOPPING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
type QuestionEvidenceStatus = 'SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
type QuestionSource = {
  id?: string;
  title: string;
  publisher: string;
  url: string;
  accessedAt?: string;
  publishedAt?: string | null;
  publisherType?: 'GOVERNMENT' | 'REGULATOR' | 'ACADEMIC' | 'STANDARDS_BODY' | 'COMPANY' | 'JOURNALISM' | 'NGO' | 'OTHER';
  sourceUse?: 'EVIDENCE' | 'DISCOVERY_ONLY';
  supports?: Array<{premise: string; evidenceRole: 'PRIMARY' | 'SECONDARY'; limitations: string}>;
  discoveryNote?: string | null;
  relevantInterests?: string | null;
};

const questionGenerationSteps = [
  {id: 'topic', label: 'Kiểm tra chủ đề'},
  {id: 'research', label: 'Mở nguồn uy tín'},
  {id: 'draft', label: 'Tạo câu hỏi'},
  {id: 'review', label: 'Anh duyệt lại'},
] as const;

export const App = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [questionDisplayLanguage, setQuestionDisplayLanguage] = useState<'en' | 'vi'>('en');
  const [questionEnglishOriginal, setQuestionEnglishOriginal] = useState('');
  const [questionVietnameseTranslation, setQuestionVietnameseTranslation] = useState('');
  const [questionIsTranslating, setQuestionIsTranslating] = useState(false);
  const [questionTranslationError, setQuestionTranslationError] = useState<string | null>(null);
  const [questionGenerationPhase, setQuestionGenerationPhase] = useState<QuestionGenerationPhase>('IDLE');
  const [questionSources, setQuestionSources] = useState<QuestionSource[]>([]);
  const [questionEditorialNote, setQuestionEditorialNote] = useState('');
  const [questionEvidenceStatus, setQuestionEvidenceStatus] = useState<QuestionEvidenceStatus | null>(null);
  const [questionWarnings, setQuestionWarnings] = useState<string[]>([]);
  const [questionGenerationError, setQuestionGenerationError] = useState<string | null>(null);
  const questionGenerationRequest = useRef<string | null>(null);
  const questionGenerationCancelRequested = useRef(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'editorial' | 'storyboard' | 'voice' | 'timeline' | 'review' | 'system'>('overview');

  const activeProjects = useMemo(() => projects.filter(({archived}) => !archived), [projects]);
  const archivedProjects = useMemo(() => projects.filter(({archived}) => archived), [projects]);
  const questionIsGenerating = ['CONNECTING', 'RESEARCHING', 'DRAFTING', 'STOPPING'].includes(questionGenerationPhase);
  const questionIsWorking = questionIsGenerating || questionIsTranslating;
  const questionWordCount = question.trim() ? question.trim().split(/\s+/).length : 0;

  const reloadProjects = async (): Promise<void> => {
    setProjects(await window.narra.listProjects());
  };

  useEffect(() => {
    void reloadProjects().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Không thể tải không gian làm việc local.');
    });
  }, []);

  useEffect(() => setActiveTab('overview'), [selected?.project.id]);

  useEffect(() => {
    if (!createDialogOpen && questionDisplayLanguage === 'vi' && questionEnglishOriginal) {
      setQuestion(questionEnglishOriginal);
      setQuestionDisplayLanguage('en');
    }
  }, [createDialogOpen, questionDisplayLanguage, questionEnglishOriginal]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác local không thành công.');
    } finally {
      setBusy(false);
    }
  };

  const createProject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await run(async () => {
      const detail = await window.narra.createProject({title, question});
      setSelected(detail);
      setTitle('');
      setQuestion('');
      setQuestionDisplayLanguage('en');
      setQuestionEnglishOriginal('');
      setQuestionVietnameseTranslation('');
      setQuestionTranslationError(null);
      setQuestionGenerationPhase('IDLE');
      setQuestionSources([]);
      setQuestionEditorialNote('');
      setQuestionEvidenceStatus(null);
      setQuestionWarnings([]);
      setQuestionGenerationError(null);
      setCreateDialogOpen(false);
      await reloadProjects();
    });
  };

  const clearGeneratedQuestionEvidence = (): void => {
    setQuestionSources([]);
    setQuestionEditorialNote('');
    setQuestionEvidenceStatus(null);
    setQuestionWarnings([]);
    setQuestionGenerationError(null);
    if (!questionIsGenerating) setQuestionGenerationPhase('IDLE');
  };

  const generateProjectQuestion = async (): Promise<void> => {
    const projectTitle = title.trim();
    if (projectTitle.length < 3) {
      setQuestionGenerationError('Nhập tên dự án có ít nhất 3 ký tự trước khi dùng AI.');
      return;
    }
    if (questionDisplayLanguage === 'vi' && questionEnglishOriginal) setQuestion(questionEnglishOriginal);
    setQuestionDisplayLanguage('en');
    setQuestionVietnameseTranslation('');
    setQuestionTranslationError(null);
    const requestId = window.crypto.randomUUID();
    questionGenerationRequest.current = requestId;
    questionGenerationCancelRequested.current = false;
    setQuestionGenerationError(null);
    setQuestionSources([]);
    setQuestionEditorialNote('');
    setQuestionEvidenceStatus(null);
    setQuestionWarnings([]);
    setQuestionGenerationPhase('CONNECTING');
    try {
      const result = await window.narra.codexGenerateProjectQuestion({requestId, title: projectTitle});
      if (questionGenerationCancelRequested.current) return;
      if (result.question !== null) {
        setQuestion(result.question);
        setQuestionEnglishOriginal(result.question);
        setQuestionVietnameseTranslation('');
        setQuestionDisplayLanguage('en');
        setQuestionTranslationError(null);
      }
      setQuestionSources(result.sources);
      setQuestionEditorialNote(result.editorialNote);
      setQuestionEvidenceStatus(result.evidenceStatus);
      setQuestionWarnings(result.warnings);
      setQuestionGenerationPhase('COMPLETED');
    } catch (reason) {
      if (questionGenerationCancelRequested.current) {
        setQuestionGenerationPhase('CANCELLED');
      } else {
        setQuestionGenerationPhase('FAILED');
        setQuestionGenerationError(reason instanceof Error ? reason.message : 'Không thể tạo câu hỏi dẫn dắt.');
      }
    } finally {
      if (questionGenerationRequest.current === requestId) questionGenerationRequest.current = null;
    }
  };

  const translateProjectQuestion = async (): Promise<void> => {
    if (questionIsTranslating || questionIsGenerating) return;
    if (questionDisplayLanguage === 'vi') {
      setQuestion(questionEnglishOriginal);
      setQuestionDisplayLanguage('en');
      setQuestionTranslationError(null);
      return;
    }
    const englishQuestion = question.trim();
    if (!englishQuestion) {
      setQuestionTranslationError('Hãy tạo hoặc nhập câu hỏi tiếng Anh trước khi dịch.');
      return;
    }
    setQuestionEnglishOriginal(question);
    setQuestionTranslationError(null);
    if (questionVietnameseTranslation) {
      setQuestion(questionVietnameseTranslation);
      setQuestionDisplayLanguage('vi');
      return;
    }
    setQuestionIsTranslating(true);
    try {
      const result = await window.narra.codexTranslateProjectQuestion({
        requestId: window.crypto.randomUUID(),
        question: englishQuestion,
      });
      setQuestionVietnameseTranslation(result.translation);
      setQuestion(result.translation);
      setQuestionDisplayLanguage('vi');
    } catch (reason) {
      setQuestionTranslationError(reason instanceof Error ? reason.message : 'Không thể dịch câu hỏi sang tiếng Việt.');
    } finally {
      setQuestionIsTranslating(false);
    }
  };

  const stopProjectQuestionGeneration = async (): Promise<void> => {
    const requestId = questionGenerationRequest.current;
    if (!requestId) return;
    questionGenerationCancelRequested.current = true;
    setQuestionGenerationPhase('STOPPING');
    try {
      await window.narra.codexInterruptProjectQuestion(requestId);
    } catch (reason) {
      setQuestionGenerationPhase('FAILED');
      setQuestionGenerationError(reason instanceof Error ? reason.message : 'Không thể dừng lượt tạo câu hỏi.');
    }
  };

  const openProject = async (projectId: string): Promise<void> => {
    await run(async () => setSelected(await window.narra.getProject(projectId)));
  };

  const chooseProject = async (): Promise<void> => {
    await run(async () => {
      const detail = await window.narra.chooseAndOpenProject();
      if (detail) {
        setSelected(detail);
        await reloadProjects();
      }
    });
  };

  const refreshProject = async (): Promise<void> => {
    if (!selected) return;
    await run(async () => {
      setSelected(await window.narra.refreshProject(selected.project.id));
      await reloadProjects();
    });
  };

  const duplicateProject = async (): Promise<void> => {
    if (!selected) return;
    await run(async () => {
      const detail = await window.narra.duplicateProject(selected.project.id);
      setSelected(detail);
      await reloadProjects();
    });
  };

  const archiveProject = async (): Promise<void> => {
    if (!selected || !window.confirm(`Lưu trữ “${selected.project.title}”? Các tệp dự án sẽ không bị xóa.`)) return;
    await run(async () => {
      await window.narra.archiveProject(selected.project.id);
      setSelected(null);
      await reloadProjects();
    });
  };

  useEffect(() => window.narra.onMenuAction((action) => {
    if (action === 'NEW_PROJECT') setCreateDialogOpen(true);
    if (action === 'OPEN_PROJECT') void chooseProject();
    if (action === 'REFRESH_PROJECT' && selected) void refreshProject();
  }), [selected?.project.id]);

  useEffect(() => {
    if (!createDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy && !questionIsWorking) setCreateDialogOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, createDialogOpen, questionIsWorking]);

  useEffect(() => window.narra.onCodexEvent((event) => {
    if (event.type !== 'projectQuestionGeneration' || event.requestId !== questionGenerationRequest.current) return;
    const phase = typeof event.phase === 'string' ? event.phase as QuestionGenerationPhase : null;
    if (phase && phase !== 'COMPLETED') setQuestionGenerationPhase(phase);
    const source = event.source && typeof event.source === 'object' ? event.source as Record<string, unknown> : null;
    if (source && typeof source.url === 'string') {
      const url = source.url;
      let publisher = url;
      try { publisher = new URL(url).hostname.replace(/^www\./, ''); } catch { /* Keep the URL as a visible fallback. */ }
      setQuestionSources((current) => current.some((item) => item.url === url)
        ? current
        : [...current, {
          url,
          publisher,
          title: 'Nguồn Codex đã mở hoàn tất',
          ...(typeof source.accessedAt === 'string' ? {accessedAt: source.accessedAt} : {}),
        }]);
    }
    if (phase === 'FAILED' && typeof event.message === 'string') setQuestionGenerationError(event.message);
  }), []);

  return (
    <main className="workspace-shell" id="main-content">
      <h1 className="sr-only">Narra Studio</h1>

      {error && <div className="notice error-notice" role="alert">{error}</div>}

      <div className="workspace-grid">
        <aside className="project-rail">
          <header className="project-rail-header">
            <h2>Dự án</h2>
            <button className="secondary icon-button" aria-label="Tạo dự án mới" title="Tạo dự án mới (Ctrl+N)" onClick={() => setCreateDialogOpen(true)}>
              <Plus aria-hidden="true" size={17} />
            </button>
          </header>

          <section className="project-list" aria-label="Dự án đang hoạt động">
            <div className="list-heading"><span>Đang hoạt động</span><span className="count-badge">{activeProjects.length}</span></div>
            {activeProjects.length === 0 && <p className="empty">Chưa có dự án local.</p>}
            {activeProjects.map((project) => (
              <button className={`project-row ${selected?.project.id === project.id ? 'selected' : ''}`} key={project.id} onClick={() => void openProject(project.id)}>
                <strong>{project.title}</strong><span>{formatUiLabel(project.status)}</span>
              </button>
            ))}
          </section>

          {archivedProjects.length > 0 && (
            <details className="archived-list">
              <summary><Archive aria-hidden="true" size={15} /> Đã lưu trữ <span>{archivedProjects.length}</span></summary>
              {archivedProjects.map((project) => (
                <button className="project-row archived" key={project.id} onClick={() => void openProject(project.id)}>
                  <strong>{project.title}</strong><span>Vẫn giữ tệp dự án</span>
                </button>
              ))}
            </details>
          )}
        </aside>

        <section className="project-panel">
          {!selected ? (
            <div className="welcome-panel">
              <span className="empty-illustration"><FileStack aria-hidden="true" size={28} /></span>
              <h2>Xây dựng phim tài liệu với quy trình rõ ràng.</h2>
              <p>Tạo dự án mới hoặc mở một thư mục có sẵn. Narra lưu trạng thái có cấu trúc trong SQLite và đặt media cạnh các artifact của dự án.</p>
              <div className="welcome-actions"><button className="primary" disabled={busy} onClick={() => setCreateDialogOpen(true)}><Plus aria-hidden="true" size={17} /> Tạo dự án mới</button><button className="secondary" disabled={busy} onClick={() => void chooseProject()}><FolderOpen aria-hidden="true" size={17} /> Mở dự án có sẵn</button></div>
            </div>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <div className="status-line">
                    <span className="status-pill"><CircleGauge aria-hidden="true" size={14} /> {formatUiLabel(selected.project.status)}</span>
                    <span className={`health ${selected.project.validation?.status === 'VALID' ? 'valid' : 'invalid'}`}>
                      {selected.project.validation?.status === 'VALID' ? <CheckCircle2 aria-hidden="true" size={14} /> : <TriangleAlert aria-hidden="true" size={14} />}
                      {selected.project.validation?.status ? formatUiLabel(selected.project.validation.status) : 'Chưa kiểm tra'}
                    </span>
                  </div>
                  <h2>{selected.project.title}</h2>
                  <p>{selected.project.question}</p>
                </div>
                <div className="actions">
                  <button className="secondary" disabled={busy} onClick={() => void refreshProject()}><RefreshCw aria-hidden="true" size={16} /> Làm mới artifact</button>
                  <button className="secondary" disabled={busy} onClick={() => void duplicateProject()}><Copy aria-hidden="true" size={16} /> Nhân bản</button>
                  {!selected.project.archived && <button className="danger ghost-danger" disabled={busy} onClick={() => void archiveProject()}><Archive aria-hidden="true" size={16} /> Lưu trữ</button>}
                </div>
              </header>

              <dl className="metadata-grid">
                <div><dt>Mã dự án</dt><dd>{selected.project.id}</dd></div>
                <div><dt>Mục tiêu</dt><dd>{selected.project.targetDurationSec / 60} phút · {selected.project.aspectRatio}</dd></div>
                <div><dt>Ngôn ngữ</dt><dd>{selected.project.language}</dd></div>
                <div><dt>Mở gần nhất</dt><dd>{formatUiDate(selected.project.lastOpenedAt)}</dd></div>
                <div className="path-cell"><dt>Thư mục</dt><dd>{selected.project.rootPath}</dd></div>
              </dl>

              <nav className="workspace-tabs" aria-label="Không gian dự án">
                {workspaceItems.map(({id, label, icon: Icon}) => (
                  <button key={id} aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon aria-hidden="true" size={17} /><span>{label}</span></button>
                ))}
              </nav>

              {activeTab === 'overview' ? (
                <section className="validation-panel">
                  <div className="panel-heading">
                    <h3>{selected.artifactVersions.length} artifact có phiên bản</h3>
                    <span>{formatUiDate(selected.project.validation?.checkedAt ?? null)}</span>
                  </div>
                  {selected.project.validation?.issues.length ? (
                    <div className="issue-list">
                      {selected.project.validation.issues.map((issue, index) => (
                        <article className="issue" key={`${issue.file}-${issue.path}-${index}`}>
                          <strong>{issue.file}{issue.path ? ` · ${issue.path}` : ''}</strong><p>{issue.message}</p><small>{issue.suggestion}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="healthy-message"><CheckCircle2 aria-hidden="true" size={18} /> Tất cả artifact bắt buộc đều khớp schema phiên bản 1.</p>
                  )}

                  <section className="artifact-table-section" aria-labelledby="artifact-table-title">
                    <div className="table-heading"><h3 id="artifact-table-title">Danh mục artifact</h3><Search aria-hidden="true" size={18} /></div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead><tr><th>Artifact</th><th>Schema</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
                        <tbody>
                          {selected.artifactVersions.map((artifact) => (
                            <tr key={artifact.path}>
                              <td><FileStack aria-hidden="true" size={15} /><span>{artifact.path}</span></td>
                              <td>v{artifact.schemaVersion}</td>
                              <td><span className={`table-status ${artifact.stale ? 'stale' : 'fresh'}`}>{artifact.stale ? 'Cần cập nhật' : 'Mới nhất'}</span></td>
                              <td>{formatUiDate(artifact.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </section>
              ) : activeTab === 'ai' ? (
                <AiWorkspaceView
                  projectId={selected.project.id}
                  projectQuestion={selected.project.question}
                  targetDurationSec={selected.project.targetDurationSec}
                  language={selected.project.language}
                />
              ) : activeTab === 'editorial' ? (
                <EditorialWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              ) : activeTab === 'storyboard' ? (
                <StoryboardWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              ) : activeTab === 'voice' ? (
                <VoiceWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              ) : activeTab === 'timeline' ? (
                <TimelineWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              ) : activeTab === 'system' ? (
                <SystemWorkspaceView projectId={selected.project.id} />
              ) : (
                <ReviewWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              )}
            </>
          )}
        </section>
      </div>

      {createDialogOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !questionIsWorking) setCreateDialogOpen(false); }}>
          <section className="create-project-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
            <header>
              <div><h2 id="create-project-title">Tạo dự án mới</h2><p>Nhập chủ đề, để AI nghiên cứu nguồn và đề xuất một câu hỏi dẫn dắt cho anh duyệt.</p></div>
              <button className="dialog-close" aria-label="Đóng" disabled={busy || questionIsWorking} onClick={() => setCreateDialogOpen(false)}><X aria-hidden="true" size={19} /></button>
            </header>
            <form onSubmit={(event) => void createProject(event)}>
              <ol className="create-project-steps" aria-label="Quy trình tạo dự án">
                {questionGenerationSteps.map((step, index) => {
                  const activeIndex = questionGenerationPhase === 'CONNECTING' ? 0
                    : questionGenerationPhase === 'RESEARCHING' ? 1
                      : questionGenerationPhase === 'DRAFTING' || questionGenerationPhase === 'STOPPING' ? 2
                        : questionGenerationPhase === 'COMPLETED' ? 3 : title.trim() ? 0 : -1;
                  const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending';
                  return <li className={state} key={step.id}><span>{index + 1}</span><small>{step.label}</small></li>;
                })}
              </ol>

              <label htmlFor="project-title">Tên dự án</label>
              <input
                id="project-title"
                autoFocus
                maxLength={160}
                value={title}
                onChange={(event) => { setTitle(event.target.value); clearGeneratedQuestionEvidence(); }}
                placeholder="Nhập chủ đề hoặc tiêu đề dự án"
                required
              />

              <div className="question-label-row">
                <label htmlFor="project-guiding-question">Câu hỏi dẫn dắt</label>
                <span><Sparkles aria-hidden="true" size={13} /> Hỗ trợ bằng AI</span>
              </div>
              <div className={`question-field-shell ${questionIsWorking ? 'generating' : ''}`}>
                <textarea
                  id="project-guiding-question"
                  aria-describedby="project-question-help project-question-status"
                  maxLength={240}
                  value={question}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuestion(value);
                    if (questionDisplayLanguage === 'en') {
                      setQuestionEnglishOriginal(value);
                      setQuestionVietnameseTranslation('');
                    } else {
                      setQuestionVietnameseTranslation(value);
                    }
                    setQuestionTranslationError(null);
                    clearGeneratedQuestionEvidence();
                  }}
                  placeholder="Nhập thủ công hoặc bấm Sparkles để AI tạo từ tên dự án"
                  required
                  rows={5}
                />
                <button
                  className={`question-language-button ${questionIsTranslating ? 'translating' : ''}`}
                  type="button"
                  aria-label={questionIsTranslating
                    ? 'Đang dịch câu hỏi sang Tiếng Việt'
                    : questionDisplayLanguage === 'en'
                      ? 'Dịch câu hỏi tiếng Anh sang Tiếng Việt'
                      : 'Hiển thị lại câu hỏi tiếng Anh gốc'}
                  aria-pressed={questionDisplayLanguage === 'vi'}
                  aria-busy={questionIsTranslating}
                  title={questionDisplayLanguage === 'en' ? 'Dịch sang Tiếng Việt' : 'Trở về bản English'}
                  disabled={busy || questionIsGenerating || questionIsTranslating || !question.trim()}
                  onClick={() => void translateProjectQuestion()}
                >
                  <Languages aria-hidden="true" size={17} />
                  <span>{questionIsTranslating ? '…' : questionDisplayLanguage === 'en' ? 'ENG' : 'VIE'}</span>
                </button>
                <button
                  className={`question-generate-button ${questionIsGenerating ? 'stop' : ''}`}
                  type="button"
                  aria-label={questionIsGenerating ? 'Dừng tạo câu hỏi dẫn dắt' : 'Tạo câu hỏi dẫn dắt bằng AI'}
                  title={questionIsGenerating ? 'Dừng tạo nội dung' : 'Tạo bằng GPT-5.6 Sol Medium'}
                  disabled={busy || questionIsTranslating || questionGenerationPhase === 'STOPPING' || (!questionIsGenerating && title.trim().length < 3)}
                  onClick={() => void (questionIsGenerating ? stopProjectQuestionGeneration() : generateProjectQuestion())}
                >
                  {questionIsGenerating ? <CircleStop aria-hidden="true" size={20} /> : <Sparkles aria-hidden="true" size={20} />}
                </button>
              </div>
              <div className="question-help-row" id="project-question-help">
                <span>Nên 12–32 từ · tối đa 240 ký tự · Sparkles tạo ENG, Languages dịch VIE</span>
                <strong className={question.length >= 230 ? 'near-limit' : ''}>{questionWordCount} từ · {question.length}/240</strong>
              </div>
              {questionTranslationError && <p className="field-error" role="alert">{questionTranslationError}</p>}

              <section className={`question-generation-panel ${questionGenerationPhase.toLowerCase()} ${questionEvidenceStatus?.toLowerCase() ?? ''}`} id="project-question-status" aria-live="polite">
                <header>
                  <div><Sparkles aria-hidden="true" size={16} /><strong>AI tạo câu hỏi dẫn dắt</strong></div>
                  <span>GPT-5.6 Sol · Medium · ENG{questionEvidenceStatus ? ` · ${formatUiLabel(questionEvidenceStatus)}` : ''}</span>
                </header>
                <p>{questionGenerationPhase === 'IDLE' && 'AI chỉ chạy khi anh bấm Sparkles. Kết quả không tự động tạo dự án.'}
                  {questionGenerationPhase === 'CONNECTING' && 'Đang kiểm tra đăng nhập và model…'}
                  {questionGenerationPhase === 'RESEARCHING' && 'Đang tìm và mở từng trang nguồn để xác minh phạm vi…'}
                  {questionGenerationPhase === 'DRAFTING' && 'Đã có bằng chứng; đang soạn một câu hỏi có thể điều tra…'}
                  {questionGenerationPhase === 'STOPPING' && 'Đang dừng lượt chạy…'}
                  {questionGenerationPhase === 'COMPLETED' && questionEvidenceStatus === 'SUFFICIENT' && 'Đủ bằng chứng sơ bộ. Anh có thể sửa câu hỏi trước khi tạo dự án.'}
                  {questionGenerationPhase === 'COMPLETED' && questionEvidenceStatus === 'LIMITED' && 'Bằng chứng còn hạn chế; AI đã giữ câu hỏi rộng và thận trọng để anh duyệt.'}
                  {questionGenerationPhase === 'COMPLETED' && questionEvidenceStatus === 'INSUFFICIENT' && 'Chưa đủ bằng chứng để tạo câu hỏi an toàn; AI không tự điền nội dung vào khung.'}
                  {questionGenerationPhase === 'COMPLETED' && !questionEvidenceStatus && 'Hoàn tất. Anh có thể sửa kết quả trước khi tạo dự án.'}
                  {questionGenerationPhase === 'CANCELLED' && 'Đã dừng. Nội dung cũ trong khung không bị thay đổi.'}
                  {questionGenerationPhase === 'FAILED' && 'Chưa tạo được câu hỏi. Kiểm tra lỗi bên dưới rồi thử lại.'}</p>
                {questionGenerationError && <p className="field-error" role="alert">{questionGenerationError}</p>}
                {questionSources.length > 0 && (
                  <div className="question-source-list">
                    <div><Globe2 aria-hidden="true" size={14} /><strong>Nguồn Codex đã mở ({questionSources.length})</strong></div>
                    {questionSources.map((source) => (
                      <button key={source.id ?? source.url} type="button" onClick={() => void window.narra.openExternalUrl(source.url)}>
                        <span>
                          <strong>{source.publisher}</strong>
                          <small>{source.publisherType && source.sourceUse ? `${formatUiLabel(source.publisherType)} · ${formatUiLabel(source.sourceUse)} · ${source.title}` : source.title}</small>
                          {source.supports?.[0] && <small>{formatUiLabel(source.supports[0].evidenceRole)} · {source.supports[0].premise}</small>}
                          {source.discoveryNote && <small>{source.discoveryNote}</small>}
                          {source.relevantInterests && <small>Lợi ích liên quan: {source.relevantInterests}</small>}
                        </span>
                        <ExternalLink aria-hidden="true" size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {questionEditorialNote && <div className="question-rationale"><strong>Ghi chú biên tập</strong><p>{questionEditorialNote}</p></div>}
                {questionWarnings.length > 0 && <div className="question-warnings"><strong>Phần cần lưu ý</strong>{questionWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
              </section>

              <div className="dialog-actions"><button className="secondary" disabled={busy || questionIsWorking} type="button" onClick={() => setCreateDialogOpen(false)}>Hủy</button><button className="primary" disabled={busy || questionIsWorking || !title.trim() || !question.trim()} type="submit"><Plus aria-hidden="true" size={17} /> Tạo dự án</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
};
