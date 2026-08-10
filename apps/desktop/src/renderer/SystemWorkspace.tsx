import type {ProjectBackupResult, SystemDiagnostics} from '@narra/project-store';
import {useEffect, useState} from 'react';
import {Archive, CheckCircle2, CircleAlert, HardDrive, RefreshCw, Stethoscope, TriangleAlert} from 'lucide-react';

const statusIcon = (status: 'PASS' | 'WARNING' | 'FAIL') => status === 'PASS'
  ? <CheckCircle2 aria-hidden="true" size={18} />
  : status === 'WARNING' ? <TriangleAlert aria-hidden="true" size={18} /> : <CircleAlert aria-hidden="true" size={18} />;

export const SystemWorkspaceView = ({projectId}: {projectId: string}) => {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [backup, setBackup] = useState<ProjectBackupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try { setDiagnostics(await window.narra.getSystemDiagnostics()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Diagnostics failed.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { void runDiagnostics(); }, []);

  const createBackup = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.narra.chooseProjectBackupDirectory(projectId);
      if (result) setBackup(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Project backup failed.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="system-workspace" aria-busy={busy}>
      <header className="system-toolbar">
        <div><p className="section-label">Local system</p><h3>Diagnostics and project recovery</h3><p>Checks local runtimes without exposing credentials or sending project data to an external API.</p></div>
        <button className="secondary" disabled={busy} onClick={() => void runDiagnostics()}><RefreshCw aria-hidden="true" size={16} /> Run diagnostics</button>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Checking local tools…</div>}

      <div className="system-summary">
        <article><Stethoscope aria-hidden="true" size={20} /><div><strong>Narra Studio {diagnostics?.appVersion ?? '—'}</strong><p>{diagnostics?.packaged ? 'Packaged application' : 'Development build'} · {diagnostics?.platform ?? 'Checking platform…'}</p></div></article>
        <article><HardDrive aria-hidden="true" size={20} /><div><strong>Portable project artifacts</strong><p>Backups preserve project-relative media, JSON artifacts, approvals and render history.</p></div></article>
      </div>

      <section className="diagnostic-list" aria-label="System diagnostic checks">
        {diagnostics?.checks.map((check) => (
          <article className={check.status.toLowerCase()} key={check.id}>
            {statusIcon(check.status)}
            <div><header><strong>{check.label}</strong><span>{check.status === 'PASS' ? 'Ready' : check.status === 'WARNING' ? 'Needs attention' : 'Unavailable'}</span></header><p>{check.detail}</p>{check.remediation && <small>{check.remediation}</small>}</div>
          </article>
        ))}
      </section>

      <section className="backup-card">
        <Archive aria-hidden="true" size={22} />
        <div><p className="section-label">Project backup</p><h3>Create a verified folder copy</h3><p>The backup is created outside the active project and excludes unfinished <code>.working</code> render files. Credentials and the workspace database are not copied.</p>{backup && <div className="backup-result" aria-live="polite"><strong>Backup complete · {backup.fileCount} files · {(backup.totalBytes / 1024 / 1024).toFixed(2)} MB</strong><code>{backup.backupPath}</code></div>}</div>
        <button className="primary" disabled={busy} onClick={() => void createBackup()}>Choose destination</button>
      </section>
    </section>
  );
};
