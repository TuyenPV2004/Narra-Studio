import type {FormEvent} from 'react';
import {useEffect, useMemo, useState} from 'react';
import type {ProjectDetail, ProjectRecord} from '@narra/project-store';
import {
  Archive,
  BookOpenText,
  Captions,
  CheckCircle2,
  CircleGauge,
  Clapperboard,
  Copy,
  FileStack,
  Film,
  FolderOpen,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Search,
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

export const App = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'editorial' | 'storyboard' | 'voice' | 'timeline' | 'review' | 'system'>('overview');

  const activeProjects = useMemo(() => projects.filter(({archived}) => !archived), [projects]);
  const archivedProjects = useMemo(() => projects.filter(({archived}) => archived), [projects]);

  const reloadProjects = async (): Promise<void> => {
    setProjects(await window.narra.listProjects());
  };

  useEffect(() => {
    void reloadProjects().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Không thể tải không gian làm việc local.');
    });
  }, []);

  useEffect(() => setActiveTab('overview'), [selected?.project.id]);

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
      setCreateDialogOpen(false);
      await reloadProjects();
    });
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
      if (event.key === 'Escape' && !busy) setCreateDialogOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, createDialogOpen]);

  return (
    <main className="workspace-shell" id="main-content">
      <h1 className="sr-only">Narra Studio</h1>

      {error && <div className="notice error-notice" role="alert">{error}</div>}

      <div className="workspace-grid">
        <aside className="project-rail">
          <header className="project-rail-header">
            <div><span className="section-label">Thư viện</span><h2>Dự án</h2></div>
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
              <p className="section-label">Không gian dự án</p>
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
                    <div><p className="section-label">Tình trạng artifact</p><h3>{selected.artifactVersions.length} artifact có phiên bản</h3></div>
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
                    <div className="table-heading"><div><p className="section-label">Tệp dự án</p><h3 id="artifact-table-title">Danh mục artifact</h3></div><Search aria-hidden="true" size={18} /></div>
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
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateDialogOpen(false); }}>
          <section className="create-project-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
            <header>
              <div><p className="section-label">Dự án local</p><h2 id="create-project-title">Tạo dự án mới</h2><p>Bắt đầu bằng một câu hỏi phim tài liệu rõ ràng.</p></div>
              <button className="dialog-close" aria-label="Đóng" disabled={busy} onClick={() => setCreateDialogOpen(false)}><X aria-hidden="true" size={19} /></button>
            </header>
            <form onSubmit={(event) => void createProject(event)}>
              <label>Tên dự án<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
              <label>Câu hỏi phim tài liệu<textarea value={question} onChange={(event) => setQuestion(event.target.value)} required rows={4} /></label>
              <div className="dialog-actions"><button className="secondary" disabled={busy} type="button" onClick={() => setCreateDialogOpen(false)}>Hủy</button><button className="primary" disabled={busy || !title.trim() || !question.trim()} type="submit"><Plus aria-hidden="true" size={17} /> Tạo dự án</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
};
