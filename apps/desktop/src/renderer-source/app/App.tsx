import {sourceRoutes} from '@/app/routes';

export function App() {
  const bootstrapRoute = sourceRoutes.sourceRecoveryStatus;
  const Page = bootstrapRoute.component;

  return <Page />;
}
