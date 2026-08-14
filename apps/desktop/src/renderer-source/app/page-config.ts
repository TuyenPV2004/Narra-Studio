export const recoveredAllowedPageIds = [
  'provider-hub',
  'dashboard',
  'image',
  'image-ultra',
  'video-pro',
  'video-standard',
  'upload',
  'concat',
  'video-editor',
  'capcut-video',
  'voice',
  'provider-account',
  'webview',
  'captcha-setup',
  'settings',
  'guide',
] as const;

export type RecoveredAllowedPageId = (typeof recoveredAllowedPageIds)[number];

export const legacyMissingLazyPageIds = [
  'home',
  'explore',
  'community',
  'workflow-app-detail',
] as const;
