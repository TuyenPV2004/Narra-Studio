import {getElectronApi} from '@/services/electron-api/client';

export const captchaApi = {
  getBridgeStatus(): Promise<unknown> {
    return getElectronApi().getCaptchaBridgeStatus();
  },
  testExtension(): Promise<unknown> {
    return getElectronApi().testCaptchaExtension();
  },
  openExtensionFolder(): Promise<unknown> {
    return getElectronApi().openExtensionFolder();
  },
};
