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
  Sparkles,
  WandSparkles,
  SlidersHorizontal,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import {StoryboardWorkspaceView} from './StoryboardWorkspace';
import {VoiceWorkspaceView} from './VoiceWorkspace';
import {EditorialWorkspaceView} from './EditorialWorkspace';
import {ReviewWorkspaceView} from './ReviewWorkspace';
import {AiWorkspaceView} from './AiWorkspace';
import {TimelineWorkspaceView} from './TimelineWorkspace';
import {SystemWorkspaceView} from './SystemWorkspace';

const formatDate = (value: string | null): string =>
  value ? new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)) : 'Never';

const formatLabel = (value: string): string => {
  const normalized = value.replaceAll('_', ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const workspaceItems = [
  {id: 'overview', label: 'Overview', icon: LayoutDashboard},
  {id: 'ai', label: 'AI workspace', icon: WandSparkles},
  {id: 'editorial', label: 'Editorial', icon: BookOpenText},
  {id: 'storyboard', label: 'Storyboard & assets', icon: Clapperboard},
  {id: 'voice', label: 'Voice & captions', icon: Captions},
  {id: 'timeline', label: 'Timeline', icon: SlidersHorizontal},
  {id: 'review', label: 'Review & render', icon: Film},
  {id: 'system', label: 'System', icon: Settings2},
] as const;

export const App = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'editorial' | 'storyboard' | 'voice' | 'timeline' | 'review' | 'system'>('overview');

  const activeProjects = useMemo(() => projects.filter(({archived}) => !archived), [projects]);
  const archivedProjects = useMemo(() => projects.filter(({archived}) => archived), [projects]);

  const reloadProjects = async (): Promise<void> => {
    setProjects(await window.narra.listProjects());
  };

  useEffect(() => {
    void reloadProjects().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load the local workspace.');
    });
  }, []);

  useEffect(() => setActiveTab('overview'), [selected?.project.id]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The local operation failed.');
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
    if (!selected || !window.confirm(`Archive “${selected.project.title}”? Files will not be deleted.`)) return;
    await run(async () => {
      await window.narra.archiveProject(selected.project.id);
      setSelected(null);
      await reloadProjects();
    });
  };

  return (
    <main className="workspace-shell" id="main-content">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Sparkles aria-hidden="true" size={20} /></span>
          <div><h1>Narra Studio</h1><p>Local documentary workspace</p></div>
        </div>
        <button className="secondary" disabled={busy} onClick={() => void chooseProject()}>
          <FolderOpen aria-hidden="true" size={17} /> Open project folder
        </button>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}</div>}

      <div className="workspace-grid">
        <aside className="project-rail">
          <form className="create-card" onSubmit={(event) => void createProject(event)}>
            <div className="rail-heading">
              <span className="rail-icon"><Plus aria-hidden="true" size={17} /></span>
              <div><h2>New project</h2><p>Start from a documentary question.</p></div>
            </div>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
            <label>Documentary question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} required rows={3} /></label>
            <button className="primary" disabled={busy || !title.trim() || !question.trim()} type="submit">
              <Plus aria-hidden="true" size={17} /> Create project
            </button>
          </form>

          <section className="project-list" aria-label="Active projects">
            <div className="list-heading"><span>Projects</span><span className="count-badge">{activeProjects.length}</span></div>
            {activeProjects.length === 0 && <p className="empty">No local projects yet.</p>}
            {activeProjects.map((project) => (
              <button className={`project-row ${selected?.project.id === project.id ? 'selected' : ''}`} key={project.id} onClick={() => void openProject(project.id)}>
                <strong>{project.title}</strong><span>{formatLabel(project.status)}</span>
              </button>
            ))}
          </section>

          {archivedProjects.length > 0 && (
            <details className="archived-list">
              <summary><Archive aria-hidden="true" size={15} /> Archived <span>{archivedProjects.length}</span></summary>
              {archivedProjects.map((project) => (
                <button className="project-row archived" key={project.id} onClick={() => void openProject(project.id)}>
                  <strong>{project.title}</strong><span>Files retained</span>
                </button>
              ))}
            </details>
          )}
        </aside>

        <section className="project-panel">
          {!selected ? (
            <div className="welcome-panel">
              <span className="empty-illustration"><FileStack aria-hidden="true" size={28} /></span>
              <p className="section-label">Project workspace</p>
              <h2>Build a documentary with a clear audit trail.</h2>
              <p>Create a project or open an existing folder. Narra keeps structured state in SQLite and media beside its artifacts.</p>
              <button className="secondary" disabled={busy} onClick={() => void chooseProject()}><FolderOpen aria-hidden="true" size={17} /> Open an existing project</button>
            </div>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <div className="status-line">
                    <span className="status-pill"><CircleGauge aria-hidden="true" size={14} /> {formatLabel(selected.project.status)}</span>
                    <span className={`health ${selected.project.validation?.status === 'VALID' ? 'valid' : 'invalid'}`}>
                      {selected.project.validation?.status === 'VALID' ? <CheckCircle2 aria-hidden="true" size={14} /> : <TriangleAlert aria-hidden="true" size={14} />}
                      {selected.project.validation?.status ? formatLabel(selected.project.validation.status) : 'Not checked'}
                    </span>
                  </div>
                  <h2>{selected.project.title}</h2>
                  <p>{selected.project.question}</p>
                </div>
                <div className="actions">
                  <button className="secondary" disabled={busy} onClick={() => void refreshProject()}><RefreshCw aria-hidden="true" size={16} /> Refresh artifacts</button>
                  <button className="secondary" disabled={busy} onClick={() => void duplicateProject()}><Copy aria-hidden="true" size={16} /> Duplicate</button>
                  {!selected.project.archived && <button className="danger ghost-danger" disabled={busy} onClick={() => void archiveProject()}><Archive aria-hidden="true" size={16} /> Archive</button>}
                </div>
              </header>

              <dl className="metadata-grid">
                <div><dt>Project ID</dt><dd>{selected.project.id}</dd></div>
                <div><dt>Target</dt><dd>{selected.project.targetDurationSec / 60} min · {selected.project.aspectRatio}</dd></div>
                <div><dt>Language</dt><dd>{selected.project.language}</dd></div>
                <div><dt>Last opened</dt><dd>{formatDate(selected.project.lastOpenedAt)}</dd></div>
                <div className="path-cell"><dt>Folder</dt><dd>{selected.project.rootPath}</dd></div>
              </dl>

              <nav className="workspace-tabs" aria-label="Project workspace">
                {workspaceItems.map(({id, label, icon: Icon}) => (
                  <button key={id} aria-selected={activeTab === id} onClick={() => setActiveTab(id)}><Icon aria-hidden="true" size={17} /><span>{label}</span></button>
                ))}
              </nav>

              {activeTab === 'overview' ? (
                <section className="validation-panel">
                  <div className="panel-heading">
                    <div><p className="section-label">Artifact health</p><h3>{selected.artifactVersions.length} versioned artifacts</h3></div>
                    <span>{formatDate(selected.project.validation?.checkedAt ?? null)}</span>
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
                    <p className="healthy-message"><CheckCircle2 aria-hidden="true" size={18} /> All required artifacts match schema version 1.</p>
                  )}

                  <section className="artifact-table-section" aria-labelledby="artifact-table-title">
                    <div className="table-heading"><div><p className="section-label">Project files</p><h3 id="artifact-table-title">Artifact register</h3></div><Search aria-hidden="true" size={18} /></div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead><tr><th>Artifact</th><th>Schema</th><th>State</th><th>Updated</th></tr></thead>
                        <tbody>
                          {selected.artifactVersions.map((artifact) => (
                            <tr key={artifact.path}>
                              <td><FileStack aria-hidden="true" size={15} /><span>{artifact.path}</span></td>
                              <td>v{artifact.schemaVersion}</td>
                              <td><span className={`table-status ${artifact.stale ? 'stale' : 'fresh'}`}>{artifact.stale ? 'Needs update' : 'Current'}</span></td>
                              <td>{formatDate(artifact.updatedAt)}</td>
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
    </main>
  );
};
