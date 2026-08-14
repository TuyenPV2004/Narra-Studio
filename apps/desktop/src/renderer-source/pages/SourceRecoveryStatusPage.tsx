import {recoveredAllowedPageIds} from '@/app/page-config';
import {Badge} from '@/components/ui/Badge';
import {Surface} from '@/components/ui/Surface';

export function SourceRecoveryStatusPage() {
  return (
    <main className="source-recovery-page">
      <div className="source-recovery-page__content">
        <Badge tone="warning">Parallel build only</Badge>
        <header className="source-recovery-page__header">
          <p className="source-recovery-page__eyebrow">Narra Studio</p>
          <h1>Frontend source recovery</h1>
          <p>
            React/TypeScript source is compiling independently while the recovered renderer remains the production
            runtime and compatibility oracle.
          </p>
        </header>

        <Surface aria-labelledby="bootstrap-status-title">
          <div className="source-recovery-page__surface-heading">
            <div>
              <h2 id="bootstrap-status-title">Phase 5 bootstrap</h2>
              <p>Architecture and contract gates are ready for incremental source migration.</p>
            </div>
            <Badge tone="success">Source ready</Badge>
          </div>
          <dl className="source-recovery-page__facts">
            <div>
              <dt>Production cutover</dt>
              <dd>Not started</dd>
            </div>
            <div>
              <dt>Recovered allowed pages inventoried</dt>
              <dd>{recoveredAllowedPageIds.length}</dd>
            </div>
            <div>
              <dt>Backend contract</dt>
              <dd>Unchanged</dd>
            </div>
          </dl>
        </Surface>
      </div>
    </main>
  );
}
