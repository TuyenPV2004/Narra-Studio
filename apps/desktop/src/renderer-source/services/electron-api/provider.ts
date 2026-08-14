import {getElectronApi} from '@/services/electron-api/client';
import type {ProviderId} from '@/types/electron-api';

export const providerApi = {
  getActive(): Promise<unknown> {
    return getElectronApi().providerGetActive();
  },
  setActive(providerId: ProviderId, activate = true): Promise<unknown> {
    return getElectronApi().providerSetActive({providerId, activate});
  },
  getStatus(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerGetStatus({providerId});
  },
  getCredential(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerGetCredential({providerId});
  },
  clearCredential(providerId: ProviderId): Promise<unknown> {
    return getElectronApi().providerClearCredential({providerId});
  },
};
