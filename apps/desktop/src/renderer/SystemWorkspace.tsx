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
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể chạy chẩn đoán hệ thống.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { void runDiagnostics(); }, []);

  const createBackup = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.narra.chooseProjectBackupDirectory(projectId);
      if (result) setBackup(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể sao lưu dự án.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="system-workspace" aria-busy={busy}>
      <header className="system-toolbar">
        <div><p className="section-label">Hệ thống local</p><h3>Chẩn đoán và khôi phục dự án</h3><p>Kiểm tra runtime local mà không hiển thị thông tin đăng nhập hoặc gửi dữ liệu dự án tới API bên ngoài.</p></div>
        <button className="secondary" disabled={busy} onClick={() => void runDiagnostics()}><RefreshCw aria-hidden="true" size={16} /> Chạy chẩn đoán</button>
      </header>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {busy && <div className="notice progress-notice" role="status">Đang kiểm tra công cụ local…</div>}

      <div className="system-summary">
        <article><Stethoscope aria-hidden="true" size={20} /><div><strong>Narra Studio {diagnostics?.appVersion ?? '—'}</strong><p>{diagnostics?.packaged ? 'Bản ứng dụng đóng gói' : 'Bản phát triển'} · {diagnostics?.platform ?? 'Đang kiểm tra nền tảng…'}</p></div></article>
        <article><HardDrive aria-hidden="true" size={20} /><div><strong>Artifact dự án có thể di chuyển</strong><p>Bản sao lưu giữ media theo đường dẫn tương đối, artifact JSON, phê duyệt và lịch sử kết xuất.</p></div></article>
      </div>

      <section className="diagnostic-list" aria-label="Kết quả chẩn đoán hệ thống">
        {diagnostics?.checks.map((check) => (
          <article className={check.status.toLowerCase()} key={check.id}>
            {statusIcon(check.status)}
            <div><header><strong>{check.label}</strong><span>{check.status === 'PASS' ? 'Sẵn sàng' : check.status === 'WARNING' ? 'Cần chú ý' : 'Không khả dụng'}</span></header><p>{check.detail}</p>{check.remediation && <small>{check.remediation}</small>}</div>
          </article>
        ))}
      </section>

      <section className="backup-card">
        <Archive aria-hidden="true" size={22} />
        <div><p className="section-label">Sao lưu dự án</p><h3>Tạo bản sao thư mục đã xác minh</h3><p>Bản sao lưu được tạo ngoài dự án đang mở và bỏ qua tệp kết xuất dở dang có tên <code>.working</code>. Thông tin đăng nhập và database của workspace không được sao chép.</p>{backup && <div className="backup-result" aria-live="polite"><strong>Sao lưu hoàn tất · {backup.fileCount} tệp · {(backup.totalBytes / 1024 / 1024).toFixed(2)} MB</strong><code>{backup.backupPath}</code></div>}</div>
        <button className="primary" disabled={busy} onClick={() => void createBackup()}>Chọn nơi lưu</button>
      </section>
    </section>
  );
};
