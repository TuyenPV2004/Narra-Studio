import {SourceRecoveryStatusPage} from '@/pages/SourceRecoveryStatusPage';

export const sourceRoutes = {
  sourceRecoveryStatus: {
    id: 'source-recovery-status',
    component: SourceRecoveryStatusPage,
  },
} as const;

export type SourceRouteId = (typeof sourceRoutes)[keyof typeof sourceRoutes]['id'];
