import type {FormEvent} from 'react';
import {useEffect, useMemo, useState} from 'react';
import type {ProjectDetail, ProjectRecord} from '@narra/project-store';
import {StoryboardWorkspaceView} from './StoryboardWorkspace';
import {VoiceWorkspaceView} from './VoiceWorkspace';

const formatDate = (value: string | null): string =>
  value ? new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)) : 'Never';

export const App = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'storyboard' | 'voice'>('overview');

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
    <main className="workspace-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NARRA STUDIO · LOCAL WORKSPACE</p>
          <h1>Projects</h1>
        </div>
        <button className="secondary" disabled={busy} onClick={() => void chooseProject()}>
          Open folder
        </button>
      </header>

      {error && <div className="notice error-notice">{error}</div>}

      <div className="workspace-grid">
        <aside className="project-rail">
          <form className="create-card" onSubmit={(event) => void createProject(event)}>
            <p className="section-label">NEW PROJECT</p>
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label>
              Documentary question
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} required rows={3} />
            </label>
            <button className="primary" disabled={busy || !title.trim() || !question.trim()} type="submit">
              Create project
            </button>
          </form>

          <section className="project-list" aria-label="Active projects">
            <div className="list-heading">
              <span>ACTIVE</span><span>{activeProjects.length}</span>
            </div>
            {activeProjects.length === 0 && <p className="empty">No local projects yet.</p>}
            {activeProjects.map((project) => (
              <button
                className={`project-row ${selected?.project.id === project.id ? 'selected' : ''}`}
                key={project.id}
                onClick={() => void openProject(project.id)}
              >
                <strong>{project.title}</strong>
                <span>{project.status.replaceAll('_', ' ')}</span>
              </button>
            ))}
          </section>

          {archivedProjects.length > 0 && (
            <details className="archived-list">
              <summary>ARCHIVED · {archivedProjects.length}</summary>
              {archivedProjects.map((project) => (
                <button className="project-row archived" key={project.id} onClick={() => void openProject(project.id)}>
                  <strong>{project.title}</strong>
                  <span>Files retained</span>
                </button>
              ))}
            </details>
          )}
        </aside>

        <section className="project-panel">
          {!selected ? (
            <div className="welcome-panel">
              <p className="section-label">PROJECT WORKSPACE</p>
              <h2>Every story stays portable.</h2>
              <p>Create a project or open an existing folder. Narra keeps structured state in SQLite and media beside its artifacts.</p>
            </div>
          ) : (
            <>
              <header className="project-header">
                <div>
                  <div className="status-line">
                    <span className="status-pill">{selected.project.status.replaceAll('_', ' ')}</span>
                    <span className={`health ${selected.project.validation?.status === 'VALID' ? 'valid' : 'invalid'}`}>
                      {selected.project.validation?.status ?? 'NOT CHECKED'}
                    </span>
                  </div>
                  <h2>{selected.project.title}</h2>
                  <p>{selected.project.question}</p>
                </div>
                <div className="actions">
                  <button className="secondary" disabled={busy} onClick={() => void refreshProject()}>Refresh artifacts</button>
                  <button className="secondary" disabled={busy} onClick={() => void duplicateProject()}>Duplicate</button>
                  {!selected.project.archived && <button className="danger" disabled={busy} onClick={() => void archiveProject()}>Archive</button>}
                </div>
              </header>

              <dl className="metadata-grid">
                <div><dt>Project ID</dt><dd>{selected.project.id}</dd></div>
                <div><dt>Target</dt><dd>{selected.project.targetDurationSec / 60} min · {selected.project.aspectRatio}</dd></div>
                <div><dt>Language</dt><dd>{selected.project.language.toUpperCase()}</dd></div>
                <div><dt>Last opened</dt><dd>{formatDate(selected.project.lastOpenedAt)}</dd></div>
                <div className="path-cell"><dt>Folder</dt><dd>{selected.project.rootPath}</dd></div>
              </dl>

              <nav className="workspace-tabs" aria-label="Project workspace">
                <button aria-selected={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</button>
                <button aria-selected={activeTab === 'storyboard'} onClick={() => setActiveTab('storyboard')}>Storyboard &amp; assets</button>
                <button aria-selected={activeTab === 'voice'} onClick={() => setActiveTab('voice')}>Voice &amp; captions</button>
              </nav>

              {activeTab === 'overview' ? (
                <section className="validation-panel">
                  <div className="panel-heading">
                    <div><p className="section-label">ARTIFACT HEALTH</p><h3>{selected.artifactVersions.length} versioned artifacts</h3></div>
                    <span>{formatDate(selected.project.validation?.checkedAt ?? null)}</span>
                  </div>
                  {selected.project.validation?.issues.length ? (
                    <div className="issue-list">
                      {selected.project.validation.issues.map((issue, index) => (
                        <article className="issue" key={`${issue.file}-${issue.path}-${index}`}>
                          <strong>{issue.file}{issue.path ? ` · ${issue.path}` : ''}</strong>
                          <p>{issue.message}</p>
                          <small>{issue.suggestion}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="healthy-message">All required artifacts match schema version 1.</p>
                  )}
                </section>
              ) : activeTab === 'storyboard' ? (
                <StoryboardWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              ) : (
                <VoiceWorkspaceView projectId={selected.project.id} onProjectRefresh={setSelected} />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
};
