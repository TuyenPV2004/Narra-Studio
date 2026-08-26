export const sourcePageIds = [
  "provider-hub",
  "dashboard",
  "image",
  "image-ultra",
  "video-pro",
  "video-standard",
  "upload",
  "concat",
  "video-editor",
  "capcut-video",
  "voice",
  "provider-account",
  "webview",
  "captcha-setup",
  "settings",
  "guide",
  "ai-agent",
] as const;

export type SourcePageId = (typeof sourcePageIds)[number];
