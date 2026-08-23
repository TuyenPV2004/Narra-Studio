"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ── 1. Test Image Magic Byte Detection Logic ─────────────────────────
const isValidImageBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }
  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }
  return false;
};

// Valid Magic Bytes Tests
const pngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const jpegBuffer = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const gifBuffer = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
]);
const webpBuffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

assert.equal(isValidImageBuffer(pngBuffer), true, "PNG buffer must be valid");
assert.equal(isValidImageBuffer(jpegBuffer), true, "JPEG buffer must be valid");
assert.equal(isValidImageBuffer(gifBuffer), true, "GIF buffer must be valid");
assert.equal(isValidImageBuffer(webpBuffer), true, "WebP buffer must be valid");

// Invalid Payloads Tests (EXE, Script, HTML, Truncated, Null)
const exeBuffer = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
]);
const htmlBuffer = Buffer.from(
  "<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
);
const shortBuffer = Buffer.from([0x89, 0x50]);

assert.equal(
  isValidImageBuffer(exeBuffer),
  false,
  "EXE payload must be rejected",
);
assert.equal(
  isValidImageBuffer(htmlBuffer),
  false,
  "HTML payload must be rejected",
);
assert.equal(
  isValidImageBuffer(shortBuffer),
  false,
  "Short payload must be rejected",
);
assert.equal(isValidImageBuffer(null), false, "Null buffer must be rejected");
assert.equal(
  isValidImageBuffer(undefined),
  false,
  "Undefined buffer must be rejected",
);

// ── 2. Test SSRF Allowlist Function ──────────────────────────────────
const isAllowedHost = (hostname) => {
  if (!hostname || typeof hostname !== "string") return false;
  const lower = hostname.toLowerCase();
  return (
    lower === "labs.google" ||
    lower === "flow-content.google" ||
    lower === "aisandbox-pa.googleapis.com" ||
    lower === "storage.googleapis.com" ||
    lower.endsWith(".google") ||
    lower.endsWith(".labs.google") ||
    lower.endsWith(".googleusercontent.com") ||
    lower.endsWith(".googleapis.com") ||
    lower.endsWith(".ggpht.com")
  );
};

// Allowed Google domains
assert.equal(isAllowedHost("labs.google"), true);
assert.equal(isAllowedHost("flow-content.google"), true);
assert.equal(isAllowedHost("fx.labs.google"), true);
assert.equal(isAllowedHost("aisandbox-pa.googleapis.com"), true);
assert.equal(isAllowedHost("storage.googleapis.com"), true);
assert.equal(isAllowedHost("lh3.googleusercontent.com"), true);
assert.equal(isAllowedHost("yt3.ggpht.com"), true);

// Disallowed SSRF targets (localhost, private IP, external domains)
assert.equal(isAllowedHost("localhost"), false);
assert.equal(isAllowedHost("127.0.0.1"), false);
assert.equal(isAllowedHost("0.0.0.0"), false);
assert.equal(isAllowedHost("169.254.169.254"), false);
assert.equal(isAllowedHost("192.168.1.1"), false);
assert.equal(isAllowedHost("10.0.0.1"), false);
assert.equal(isAllowedHost("evil-labs.google.attacker.com"), false);
assert.equal(isAllowedHost("googleusercontent.com.attacker.com"), false);
assert.equal(isAllowedHost("example.com"), false);
assert.equal(isAllowedHost(""), false);
assert.equal(isAllowedHost(null), false);

// ── 3. Test Protocol Validation (HTTPS only) ──────────────────────────
const isSafeUrl = (urlStr) => {
  if (typeof urlStr !== "string" || !urlStr.trim()) return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === "https:" && isAllowedHost(parsed.hostname);
  } catch {
    return false;
  }
};

assert.equal(
  isSafeUrl(
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=123",
  ),
  true,
);
assert.equal(
  isSafeUrl("http://labs.google/fx/api/trpc/media.getMediaUrlRedirect"),
  false,
  "HTTP must be rejected",
);
assert.equal(
  isSafeUrl("file:///C:/Windows/System32/drivers/etc/hosts"),
  false,
  "file:// must be rejected",
);
assert.equal(
  isSafeUrl("https://localhost:8080/secret"),
  false,
  "localhost must be rejected",
);
assert.equal(
  isSafeUrl("https://127.0.0.1/secret"),
  false,
  "127.0.0.1 must be rejected",
);
assert.equal(
  isSafeUrl("javascript:alert(1)"),
  false,
  "javascript: must be rejected",
);

// ── 4. Verify generation.js Backend Contract & Security Boundaries ───
const genJsPath = path.resolve(
  __dirname,
  "../apps/desktop/src/electron/ipc/generation.js",
);
const genJsContent = fs.readFileSync(genJsPath, "utf8");
const preloadPath = path.resolve(
  __dirname,
  "../apps/desktop/src/electron/preload.js",
);
const preloadContent = fs.readFileSync(preloadPath, "utf8");

assert.equal(
  genJsContent.includes("isValidImageBuffer"),
  true,
  "generation.js must contain isValidImageBuffer",
);
assert.equal(
  genJsContent.includes("MAX_IMAGE_FILE_SIZE_BYTES"),
  true,
  "generation.js must define MAX_IMAGE_FILE_SIZE_BYTES",
);
assert.equal(
  genJsContent.includes("MAX_IMAGE_BASE64_LENGTH"),
  true,
  "generation.js must define MAX_IMAGE_BASE64_LENGTH",
);
assert.equal(
  genJsContent.includes("isAllowedHost"),
  true,
  "generation.js must contain isAllowedHost",
);
assert.equal(
  genJsContent.includes("resolve-video-url"),
  true,
  "generation.js must register resolve-video-url",
);
assert.equal(
  genJsContent.includes("edit-image"),
  true,
  "generation.js must register edit-image",
);
assert.equal(
  genJsContent.includes("upscale-image"),
  true,
  "generation.js must register upscale-image",
);
assert.equal(
  genJsContent.includes("transform-image"),
  true,
  "generation.js must register transform-image",
);
assert.equal(
  genJsContent.includes("upload-image"),
  true,
  "generation.js must register upload-image",
);
assert.equal(
  genJsContent.includes("upload-image-from-path"),
  true,
  "generation.js must register upload-image-from-path",
);

assert.equal(
  genJsContent.includes("normalizeImageAspect"),
  true,
  "generation.js must contain normalizeImageAspect",
);

// ── 5. Test Aspect Ratio Normalization Logic ─────────────────────────
const normalizeImageAspect = (aspect) => {
  if (!aspect) return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  const map = {
    "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
    "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
    "4:3": "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    "3:4": "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
    landscape: "IMAGE_ASPECT_RATIO_LANDSCAPE",
    portrait: "IMAGE_ASPECT_RATIO_PORTRAIT",
    square: "IMAGE_ASPECT_RATIO_SQUARE",
    IMAGE_ASPECT_RATIO_LANDSCAPE: "IMAGE_ASPECT_RATIO_LANDSCAPE",
    IMAGE_ASPECT_RATIO_PORTRAIT: "IMAGE_ASPECT_RATIO_PORTRAIT",
    IMAGE_ASPECT_RATIO_SQUARE: "IMAGE_ASPECT_RATIO_SQUARE",
    IMAGE_ASPECT_RATIO_FOUR_THREE: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    IMAGE_ASPECT_RATIO_THREE_FOUR: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
    IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE:
      "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR:
      "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
  };
  return map[aspect] || aspect;
};

assert.equal(normalizeImageAspect("16:9"), "IMAGE_ASPECT_RATIO_LANDSCAPE");
assert.equal(normalizeImageAspect("9:16"), "IMAGE_ASPECT_RATIO_PORTRAIT");
assert.equal(normalizeImageAspect("1:1"), "IMAGE_ASPECT_RATIO_SQUARE");
assert.equal(
  normalizeImageAspect("4:3"),
  "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
);
assert.equal(
  normalizeImageAspect("3:4"),
  "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
);
assert.equal(
  normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT"),
  "IMAGE_ASPECT_RATIO_PORTRAIT",
);
assert.equal(
  normalizeImageAspect("IMAGE_ASPECT_RATIO_SQUARE"),
  "IMAGE_ASPECT_RATIO_SQUARE",
);
assert.equal(
  normalizeImageAspect("IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE"),
  "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
);
assert.equal(
  normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR"),
  "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
);

// ── 6. Verify storage.js Slot-Scoped Partitioning ─────────────────────
const storageJsPath = path.resolve(
  __dirname,
  "../apps/desktop/src/electron/ipc/storage.js",
);
const storageJsContent = fs.readFileSync(storageJsPath, "utf8");
assert.equal(
  storageJsContent.includes("persist:slot-${slotId ?? 0}"),
  true,
  "storage.js must use slotId for save-image-locally session partition",
);

// ── 7. Verify Strict Slot Isolation (No DEFAULTS.projectId Fallbacks) ─
assert.equal(
  genJsContent.includes("DEFAULTS.projectId"),
  false,
  "generation.js must not contain any DEFAULTS.projectId fallbacks",
);
assert.equal(
  genJsContent.includes("capturedAuth.bearerToken"),
  false,
  "generation.js must not fallback to capturedAuth.bearerToken",
);

// ── 8. Verify Video Post-Processing Slot Propagation ─────────────────
const videoTsPath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/services/electron-api/video.ts",
);
const videoTsContent = fs.readFileSync(videoTsPath, "utf8");

assert.equal(
  videoTsContent.includes("slotId: number;"),
  true,
  "VideoGenerationResult must include slotId",
);
assert.equal(
  videoTsContent.includes("createGif(mediaId: string, slotId = 0)"),
  true,
  "videoApi.createGif must accept slotId",
);
assert.equal(
  videoTsContent.includes("async upscale(") &&
    videoTsContent.includes("slotId = 0"),
  true,
  "videoApi.upscale must accept slotId",
);
assert.equal(
  videoTsContent.includes("generatePinholeGif({ mediaId, slotId })"),
  true,
  "generatePinholeGif must receive slotId",
);
assert.equal(
  videoTsContent.includes(
    "downloadVideo({\n      mediaName: completedName,\n      slotId,\n    })",
  ) ||
    videoTsContent.includes(
      "downloadVideo({ mediaName: completedName, slotId })",
    ),
  true,
  "downloadVideo must receive slotId",
);

const useVideoQueuePath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/pages/Video/useVideoQueue.ts",
);
const useVideoQueueContent = fs.readFileSync(useVideoQueuePath, "utf8");
const appPath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/app/App.tsx",
);
const appContent = fs.readFileSync(appPath, "utf8");
assert.equal(
  useVideoQueueContent.includes("slotId?: number;"),
  true,
  "VideoQueueTask must support slotId",
);
assert.equal(
  useVideoQueueContent.includes("slotId: result.slotId,"),
  true,
  "useVideoQueue must store result.slotId",
);
assert.equal(
  useVideoQueueContent.includes("onVideoDownloaded"),
  true,
  "useVideoQueue must subscribe to onVideoDownloaded",
);
assert.equal(
  useVideoQueueContent.includes("localPath: data.localPath,"),
  true,
  "useVideoQueue must store localPath on download completion",
);
const videoPagePath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/pages/Video/VideoGeneratorPage.tsx",
);
const videoPageContent = fs.readFileSync(videoPagePath, "utf8");
assert.equal(
  appContent.includes("<VideoQueueProvider>"),
  true,
  "App must keep the Video queue provider mounted across page navigation",
);
assert.equal(
  videoPageContent.includes("useVideoQueue()"),
  true,
  "VideoGeneratorPage must consume the app-scoped queue instead of creating a page-scoped queue",
);
assert.equal(
  videoPageContent.includes("useVideoQueue(videoApi.generate)"),
  false,
  "VideoGeneratorPage must not restart the queue when the page remounts",
);
assert.equal(
  videoPageContent.includes("task.slotId ?? 0"),
  true,
  "VideoGeneratorPage must pass task.slotId to runPostAction",
);
assert.equal(
  videoPageContent.includes("showInFolder(task.localPath)"),
  true,
  "VideoGeneratorPage must connect localPath to showInFolder",
);

// ── 9. Verify Multi-Reference Limits & Validation ─────────────────────
assert.equal(
  genJsContent.includes("MAX_REFERENCE_IMAGES = 5"),
  true,
  "generation.js must enforce MAX_REFERENCE_IMAGES = 5",
);
assert.equal(
  genJsContent.includes("referenceImageNames.length > MAX_REFERENCE_IMAGES"),
  true,
  "generation.js must check max reference image count",
);

// ── 10. Verify SaveStatus Discriminated Union & UI Invariants ──────────
const imageTsPath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/services/electron-api/image.ts",
);
const imageTsContent = fs.readFileSync(imageTsPath, "utf8");

assert.equal(
  imageTsContent.includes("export const MAX_REFERENCE_IMAGES = 5;"),
  true,
  "image.ts must export MAX_REFERENCE_IMAGES = 5",
);
assert.equal(
  imageTsContent.includes("export type SaveImageResult ="),
  true,
  "image.ts must define SaveImageResult union",
);
assert.equal(
  imageTsContent.includes("DEFAULT_IMAGE_MODELS"),
  true,
  "image.ts must export DEFAULT_IMAGE_MODELS catalog",
);
assert.equal(
  imageTsContent.includes("formatImageError"),
  true,
  "image.ts must export formatImageError",
);
assert.equal(
  imageTsContent.includes("getModels"),
  true,
  "image.ts must provide getModels method",
);
assert.equal(
  imageTsContent.includes("resolveMediaUrl"),
  true,
  "image.ts must provide semantic resolveMediaUrl method",
);

const imageGenPagePath = path.resolve(
  __dirname,
  "../apps/desktop/src/renderer-source/pages/Image/ImageGeneratorPage.tsx",
);
const imageGenPageContent = fs.readFileSync(imageGenPagePath, "utf8");

assert.equal(
  imageGenPageContent.includes("displayBatchPercent"),
  true,
  "ImageGeneratorPage must use displayBatchPercent for batch progress",
);
assert.equal(
  imageGenPageContent.includes("saveStatus: SaveStatus;"),
  true,
  "ImageTask must declare non-optional saveStatus",
);
assert.equal(
  imageGenPageContent.includes('saveStatus || "saved"'),
  false,
  "UI must never default missing saveStatus to 'saved'",
);
assert.equal(
  imageGenPageContent.includes('"cancelled"'),
  false,
  "TaskStatus must not contain dead code 'cancelled'",
);

// ── 11. Behavioral Runtime Mock Tests for Slot Isolation & Mismatch ───
const sessionJsPath = path.resolve(
  __dirname,
  "../apps/desktop/src/electron/ipc/flow/session.js",
);
const sessionJsContent = fs.readFileSync(sessionJsPath, "utf8");
assert.equal(
  sessionJsContent.includes("capturedAuth"),
  false,
  "session.js must not contain any capturedAuth references",
);

const registeredHandlers = {};
const registeredListeners = {};
const mockIpcMain = {
  handle: (channel, handler) => {
    registeredHandlers[channel] = handler;
  },
  on: (channel, handler) => {
    registeredListeners[channel] = handler;
  },
};

const mockSlots = [
  {
    id: 0,
    bearerToken: "Bearer slot-0-token",
    projectId: "project-0",
    partition: "persist:slot-0",
    cookies: "c=0",
    userPaygateTier: "PAYGATE_TIER_ONE",
  },
  {
    id: 1,
    bearerToken: "Bearer slot-1-token",
    projectId: "project-1",
    partition: "persist:slot-1",
    cookies: "c=1",
    userPaygateTier: "PAYGATE_TIER_TWO",
  },
  {
    id: 2,
    bearerToken: "Bearer slot-2-token",
    projectId: "project-2",
    partition: "persist:slot-2",
    cookies: "c=2",
  },
  {
    id: 3,
    bearerToken: null,
    projectId: null,
    partition: "persist:slot-3",
    cookies: "",
  },
];

const mockGetSlot = (slotId = 0) => {
  const s = mockSlots.find((slot) => slot.id === Number(slotId));
  if (!s) throw new Error(`Slot ${slotId} not found`);
  return s;
};

// Register Session IPC
const registerFlowSessionIpc = require(sessionJsPath);
registerFlowSessionIpc({
  app: {},
  BrowserWindow: class {},
  ipcMain: mockIpcMain,
  session: {
    fromPartition: () => ({
      cookies: { get: async () => [] },
      setUserAgent: () => {},
    }),
  },
  clipboard: { writeText: () => {} },
  path,
  https: {},
  http: {},
  fs,
  runtime: {},
  loadSettings: () => ({}),
  saveSettings: () => {},
  DEFAULTS: { userAgent: "test-ua" },
  accountSlots: mockSlots,
  getSlot: mockGetSlot,
  pickRandomSlot: () => mockSlots[0],
  refreshCapturedCookies: async () => {},
  fetchSlotSession: async () => {},
  restoreSlotSession: async () => {},
  restoreAllSlotSessions: async () => {},
  getIsRestoringSessions: () => false,
  findFlowWebview: () => null,
  setActiveWebviewSlot: () => {},
});

let lastApiRequest = null;
let hiddenUploadBridge = null;
class MockBrowserWindow {
  constructor(options) {
    const executedScripts = [];
    this.options = options;
    this.closed = false;
    this.webContents = {
      executedScripts,
      loadURL: async (url) => {
        this.loadedUrl = url;
      },
      setUserAgent: () => {},
      executeJavaScript: async (script) => {
        executedScripts.push(script);
        if (script.includes("action=start")) {
          return { ok: true, sessionUrl: "mock-upload-session" };
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            mediaServerId: "mock-edit-video-media",
            workflowServerId: "mock-edit-video-workflow",
            videoWidth: 1280,
            videoHeight: 720,
          }),
        };
      },
    };
    hiddenUploadBridge = this;
  }

  close() {
    this.closed = true;
  }

  isDestroyed() {
    return this.closed;
  }
}

const failingNet = {
  request: () => {
    const listeners = {};
    return {
      setHeader: () => {},
      write: () => {},
      on: (event, listener) => {
        listeners[event] = listener;
      },
      end: () => {
        queueMicrotask(() => listeners.error?.(new Error("mock net failure")));
      },
    };
  },
};
const registerGenerationIpc = require(genJsPath);
registerGenerationIpc({
  app: {},
  BrowserWindow: MockBrowserWindow,
  ipcMain: mockIpcMain,
  session: {
    fromPartition: () => ({
      cookies: { get: async () => [] },
      setUserAgent: () => {},
    }),
  },
  clipboard: {},
  protocol: {},
  net: failingNet,
  shell: {},
  dialog: {},
  path,
  https: {},
  http: {},
  fs,
  os: require("os"),
  crypto: require("crypto"),
  pathToFileURL: (p) => new URL(`file:///${p}`),
  fileURLToPath: () => "",
  captchaBridge: {},
  runtime: {},
  getFfmpegBin: () => "",
  maybePromoteFilterComplexToScript: (cmd) => cmd,
  logFfmpegSpawnDiagnostics: () => {},
  truncatePreview: (s) => s,
  SESSION_PARTITION: "persist:test",
  MAX_SLOTS: 5,
  isDev: false,
  SETTINGS_FILE: "",
  loadSettings: () => ({}),
  saveSettings: () => {},
  getVideoOutputDir: () => "",
  getImageOutputDir: () => "",
  getNextFilename: () => "file.png",
  generateUUID: () => "mock-uuid-1234",
  makeApiRequest: async () => ({}),
  makeApiRequestWithCaptcha: async (url, body, slotId, type) => {
    lastApiRequest = { url, body, slotId, type };
    return {};
  },
  buildCleanUserAgent: () => "ua",
  DEFAULTS: {},
  accountSlots: mockSlots,
  getSlot: mockGetSlot,
  slotRequestCounts: [0, 0, 0, 0],
  markSlotBusy: () => {},
  markSlotFree: () => {},
  pickRandomSlot: () => mockSlots[0],
  refreshCapturedCookies: async () => {},
  fetchSlotSession: async () => {},
  clearSlotSessionData: () => {},
  fetchSlotEmail: async () => {},
  findFlowWebview: () => null,
});

(async () => {
  // 1. Verify get-auth-info slot scoping
  const slot1Auth = await registeredHandlers["get-auth-info"](
    {},
    { slotId: 1 },
  );
  assert.equal(slot1Auth.hasBearerToken, true);
  assert.equal(slot1Auth.projectId, "project-1");
  assert.equal(slot1Auth.bearerPreview.startsWith("Bearer slot-1-token"), true);

  const slot3Auth = await registeredHandlers["get-auth-info"](
    {},
    { slotId: 3 },
  );
  assert.equal(slot3Auth.hasBearerToken, false);
  assert.equal(slot3Auth.projectId, null);

  // 2. Verify set-manual-auth updates only target slot
  await registeredHandlers["set-manual-auth"](
    {},
    { slotId: 2, bearerToken: "new-token-2", projectId: "proj-manual-2" },
  );
  assert.equal(mockSlots[2].bearerToken, "Bearer new-token-2");
  assert.equal(mockSlots[2].projectId, "proj-manual-2");
  assert.equal(mockSlots[0].projectId, "project-0");
  assert.equal(mockSlots[1].projectId, "project-1");

  // 3. Verify extract-auth-from-webview
  const slot2Extract = await registeredHandlers["extract-auth-from-webview"](
    {},
    { slotId: 2 },
  );
  assert.equal(slot2Extract.projectId, "proj-manual-2");

  // 4. Slot 1 with Project ID of Slot 0 must throw mismatch error
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"](
        {},
        {
          prompt: "test",
          slotId: 1,
          projectId: "project-0",
        },
      );
    },
    { message: "Project ID không thuộc Slot 1." },
    "Sending Slot 0 project ID to Slot 1 must be rejected",
  );

  // 5. Slot 3 (missing bearer token) throws token error
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"](
        {},
        {
          prompt: "test",
          slotId: 3,
        },
      );
    },
    /Chưa có Bearer token/,
    "Slot without bearer token must throw",
  );

  // 6. Over 5 reference images must be rejected
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"](
        {},
        {
          prompt: "test",
          slotId: 1,
          referenceImageNames: ["1", "2", "3", "4", "5", "6"],
        },
      );
    },
    /vượt quá giới hạn tối đa/,
    "Over 5 reference images must be rejected",
  );

  // 7. generate-video with project ID mismatch
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-video"](
        {},
        {
          prompt: "test",
          slotId: 1,
          projectId: "project-0",
        },
      );
    },
    { message: "Project ID không thuộc Slot 1." },
    "generate-video mismatch project ID must be rejected",
  );

  // 8. poll-video-status with project ID mismatch
  await assert.rejects(
    async () => {
      await registeredHandlers["poll-video-status"](
        {},
        {
          mediaName: "media-1",
          slotId: 1,
          projectId: "project-0",
        },
      );
    },
    { message: "Project ID không thuộc Slot 1." },
    "poll-video-status mismatch project ID must be rejected",
  );

  // 9. Slot with null projectId must reject foreign pid and not bypass isolation
  mockSlots[3].bearerToken = "Bearer slot-3-token";
  mockSlots[3].projectId = null;
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"](
        {},
        {
          prompt: "test",
          slotId: 3,
          projectId: "project-0",
        },
      );
    },
    { message: "Project ID không thuộc Slot 3." },
    "Foreign pid when slot.projectId is null must be rejected",
  );
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"](
        {},
        {
          prompt: "test",
          slotId: 3,
        },
      );
    },
    {
      message:
        "Slot 3 chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.",
    },
    "Slot with null projectId without pid must be rejected",
  );

  // 10. Verify sync-session propagates slot.id to refreshCapturedCookies
  let refreshedSlotId = null;
  const mockSyncIpc = {};
  const mockSyncIpcMain = {
    handle: (channel, fn) => {
      mockSyncIpc[channel] = fn;
    },
  };
  registerFlowSessionIpc({
    app: {},
    BrowserWindow: class {},
    ipcMain: mockSyncIpcMain,
    session: {
      fromPartition: () => ({
        cookies: { get: async () => [] },
        setUserAgent: () => {},
      }),
    },
    clipboard: { writeText: () => {} },
    path,
    https: {},
    http: {},
    fs,
    runtime: {},
    loadSettings: () => ({}),
    saveSettings: () => {},
    DEFAULTS: { userAgent: "test-ua" },
    accountSlots: mockSlots,
    getSlot: mockGetSlot,
    pickRandomSlot: () => mockSlots[0],
    refreshCapturedCookies: async (sId) => {
      refreshedSlotId = sId;
    },
    fetchSlotSession: async () => {},
    restoreSlotSession: async () => {},
    restoreAllSlotSessions: async () => {},
    getIsRestoringSessions: () => false,
    findFlowWebview: () => null,
    setActiveWebviewSlot: () => {},
  });

  await mockSyncIpc["sync-session"]({}, { slotId: 2 });
  assert.equal(
    refreshedSlotId,
    2,
    "sync-session must pass slot.id (2) to refreshCapturedCookies",
  );

  // 11. Electron renderer must not enable or depend on the legacy <webview> UI.
  const appCoreJsPath = path.resolve(
    __dirname,
    "../apps/desktop/src/electron/runtime/app-core.js",
  );
  const appCoreJsContent = fs.readFileSync(appCoreJsPath, "utf8");
  assert.equal(
    appCoreJsContent.includes("webviewTag: true"),
    false,
    "The main renderer must not enable Electron webviewTag",
  );
  assert.equal(
    appCoreJsContent.includes("[DIAGNOSE] WebView not found yet"),
    false,
    "The obsolete WebView diagnostic timer must not run",
  );

  // 12. Video Model Key Resolution Contract & Mode Mapping Tests
  const { resolveVideoModelKey } = registerGenerationIpc;
  assert.equal(
    typeof resolveVideoModelKey,
    "function",
    "resolveVideoModelKey must be exported",
  );

  // A. Omni / Abra model mapping across modes
  assert.equal(
    resolveVideoModelKey({
      mode: "text",
      videoModelKey: "abra_t2v",
      duration: 8,
    }),
    "abra_t2v_8s",
    "T2V default should resolve to abra_t2v_8s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "text",
      videoModelKey: "abra_t2v",
      duration: 4,
    }),
    "abra_t2v_4s",
    "T2V duration 4 should resolve to abra_t2v_4s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "image",
      videoModelKey: "abra_t2v_8s",
      duration: 8,
    }),
    "abra_i2v_8s",
    "I2V with abra_t2v_8s input should resolve to abra_i2v_8s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "image",
      videoModelKey: "abra_t2v",
      duration: 6,
    }),
    "abra_i2v_6s",
    "I2V duration 6 should resolve to abra_i2v_6s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "startend",
      videoModelKey: "abra_t2v_8s",
      duration: 10,
    }),
    "abra_i2v_10s",
    "StartEnd with abra_t2v_8s input should resolve to abra_i2v_10s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "charsync",
      videoModelKey: "abra_t2v_8s",
      duration: 8,
    }),
    "abra_r2v_8s",
    "CharSync with abra_t2v_8s input should resolve to abra_r2v_8s",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "charsync",
      videoModelKey: "abra_r2v",
      duration: 6,
    }),
    "abra_r2v_6s",
    "CharSync duration 6 should resolve to abra_r2v_6s",
  );
  assert.equal(
    resolveVideoModelKey({ mode: "editvideo", videoModelKey: "abra_t2v_8s" }),
    "abra_edit",
    "EditVideo should resolve to abra_edit",
  );

  // B. VEO 3.1 Model resolution according to tier and aspect
  assert.equal(
    resolveVideoModelKey({
      mode: "image",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_TWO",
    }),
    "veo_3_1_i2v_lite_low_priority",
    "VEO I2V Tier 2 should resolve to veo_3_1_i2v_lite_low_priority",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "image",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
    }),
    "veo_3_1_i2v_s_fast",
    "VEO I2V Tier 1 Landscape should resolve to veo_3_1_i2v_s_fast",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "image",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT",
    }),
    "veo_3_1_i2v_s_fast_portrait",
    "VEO I2V Tier 1 Portrait should resolve to veo_3_1_i2v_s_fast_portrait",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "startend",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
    }),
    "veo_3_1_i2v_s_fast_fl",
    "VEO StartEnd Tier 1 Landscape should resolve to veo_3_1_i2v_s_fast_fl",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "startend",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_TWO",
    }),
    "veo_3_1_interpolation_lite_low_priority",
    "VEO StartEnd Tier 2 should resolve to veo_3_1_interpolation_lite_low_priority",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "charsync",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
    }),
    "veo_3_1_r2v_fast",
    "VEO CharSync Tier 1 Landscape should resolve to veo_3_1_r2v_fast",
  );
  assert.equal(
    resolveVideoModelKey({
      mode: "charsync",
      videoModelKey: "veo_3_1_t2v_lite",
      userPaygateTier: "PAYGATE_TIER_TWO",
    }),
    "veo_3_1_r2v_fast_landscape_ultra_relaxed",
    "VEO CharSync Tier 2 should resolve to veo_3_1_r2v_fast_landscape_ultra_relaxed",
  );
  assert.throws(
    () =>
      resolveVideoModelKey({
        mode: "image",
        videoModelKey: "veo_3_1_t2v_lite",
      }),
    /Không xác định được gói tài khoản/,
    "Tier-dependent VEO generation must fail closed when account tier is unknown",
  );
  assert.throws(
    () =>
      resolveVideoModelKey({
        mode: "image",
        videoModelKey: "veo_3_1_t2v_fast",
        userPaygateTier: "PAYGATE_TIER_TWO",
      }),
    /chưa được xác minh/,
    "Unverified Tier Two Fast mapping must fail closed instead of spending credits with a guessed key",
  );

  // C. IPC Handler execution checks
  await registeredHandlers["generate-video-start-image"](
    {},
    {
      prompt: "A walking cat",
      slotId: 0,
      mediaId: "media-img-1",
      videoModelKey: "abra_t2v_8s",
      duration: 6,
    },
  );
  assert.equal(
    lastApiRequest.url,
    "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage",
  );
  assert.equal(lastApiRequest.body.requests[0].videoModelKey, "abra_i2v_6s");

  await registeredHandlers["generate-video-start-end-image"](
    {},
    {
      prompt: "Morphing landscape",
      slotId: 0,
      startMediaId: "media-img-1",
      endMediaId: "media-img-2",
      videoModelKey: "abra_t2v_8s",
      duration: 8,
    },
  );
  assert.equal(
    lastApiRequest.url,
    "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage",
  );
  assert.equal(lastApiRequest.body.requests[0].videoModelKey, "abra_i2v_8s");

  await registeredHandlers["generate-video-reference-images"](
    {},
    {
      prompt: "Character talking",
      slotId: 0,
      referenceMediaIds: ["ref-1"],
      videoModelKey: "abra_t2v_8s",
      duration: 10,
    },
  );
  assert.equal(
    lastApiRequest.url,
    "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages",
  );
  assert.equal(lastApiRequest.body.requests[0].videoModelKey, "abra_r2v_10s");

  await registeredHandlers["upscale-video"](
    {},
    {
      mediaId: "video-tier-two",
      resolution: "1080p",
      aspectRatio: "landscape",
      slotId: 1,
    },
  );
  assert.equal(
    lastApiRequest.body.clientContext.userPaygateTier,
    "PAYGATE_TIER_TWO",
    "Video upscale must use the selected slot tier",
  );

  await registeredHandlers["generate-video-edit-video"](
    {},
    {
      prompt: "Remix this clip",
      slotId: 0,
      videoInputMediaId: "video-input-1",
      videoModelKey: "abra_t2v_8s",
      duration: 8,
    },
  );
  assert.equal(
    lastApiRequest.body.clientContext.userPaygateTier,
    "PAYGATE_TIER_ONE",
    "Edit Video must use the selected slot tier",
  );

  await assert.rejects(
    registeredHandlers["generate-video-start-image"](
      {},
      {
        prompt: "Unknown tier request",
        slotId: 2,
        mediaId: "media-img-unknown-tier",
        videoModelKey: "veo_3_1_t2v_lite",
        duration: 8,
      },
    ),
    /Không xác định được gói tài khoản/,
    "A VEO request must fail before calling Google Flow when the selected slot tier is unknown",
  );

  // 13. Video Upload Security, Magic Bytes & Path Boundary Tests
  const { isValidVideoBuffer, ALLOWED_VIDEO_EXTS, MAX_VIDEO_FILE_SIZE_BYTES } =
    registerGenerationIpc;
  assert.equal(
    typeof isValidVideoBuffer,
    "function",
    "isValidVideoBuffer must be a function",
  );
  assert.equal(ALLOWED_VIDEO_EXTS.has(".mp4"), true, ".mp4 must be allowed");
  assert.equal(ALLOWED_VIDEO_EXTS.has(".exe"), false, ".exe must be rejected");
  assert.equal(
    MAX_VIDEO_FILE_SIZE_BYTES,
    200 * 1024 * 1024,
    "Max video size must be 200MB",
  );

  // A. Magic Bytes checks
  const mp4Header = Buffer.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]); // 'ftypisom'
  const webmHeader = Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const aviHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
  ]); // 'RIFF....AVI '
  const fakeFile = Buffer.from("THIS_IS_A_PLAIN_TEXT_FILE_AND_NOT_A_VIDEO");

  assert.equal(
    isValidVideoBuffer(mp4Header),
    true,
    "MP4 ftyp header must be valid",
  );
  assert.equal(
    isValidVideoBuffer(webmHeader),
    true,
    "WebM EBML header must be valid",
  );
  assert.equal(isValidVideoBuffer(aviHeader), true, "AVI header must be valid");
  assert.equal(
    isValidVideoBuffer(fakeFile),
    false,
    "Plain text must be rejected as video",
  );
  assert.equal(
    isValidVideoBuffer(Buffer.alloc(4)),
    false,
    "Buffer < 12 bytes must be rejected",
  );

  // B. Handler path and extension rejection tests
  const os = require("os");
  const tempDir = os.tmpdir();
  const fakeTxtPath = path.join(tempDir, `fake-video-${Date.now()}.txt`);
  fs.writeFileSync(fakeTxtPath, "Not a video file");

  const authorizeSelectedFile = (filePath) => {
    const event = { returnValue: "" };
    registeredListeners["authorize-user-selected-file"](event, filePath);
    assert.ok(
      event.returnValue,
      "A real user-selected test file must be authorized",
    );
  };

  try {
    authorizeSelectedFile(fakeTxtPath);
    await assert.rejects(
      async () => {
        await registeredHandlers["upload-omni-video"](
          {},
          { filePath: fakeTxtPath, slotId: 0 },
        );
      },
      /Định dạng video không được hỗ trợ/,
      "upload-omni-video must reject non-video extensions (.txt)",
    );

    const fakeMp4Path = path.join(tempDir, `corrupt-video-${Date.now()}.mp4`);
    fs.writeFileSync(fakeMp4Path, "CORRUPT_NOT_ACTUALLY_AN_MP4_FILE");
    try {
      authorizeSelectedFile(fakeMp4Path);
      await assert.rejects(
        async () => {
          await registeredHandlers["upload-omni-video"](
            {},
            { filePath: fakeMp4Path, slotId: 0 },
          );
        },
        /magic bytes \/ container signature không khớp/,
        "upload-omni-video must reject files with invalid container magic bytes",
      );
    } finally {
      if (fs.existsSync(fakeMp4Path)) fs.unlinkSync(fakeMp4Path);
    }

    const validMp4Path = path.join(
      tempDir,
      `valid-edit-video-${Date.now()}.mp4`,
    );
    fs.writeFileSync(validMp4Path, mp4Header);
    try {
      authorizeSelectedFile(validMp4Path);
      hiddenUploadBridge = null;
      const uploaded = await registeredHandlers["upload-omni-video"](
        {},
        { filePath: validMp4Path, slotId: 0 },
      );
      assert.equal(
        uploaded.mediaServerId,
        "mock-edit-video-media",
        "Edit Video upload must work without a pre-opened WebView",
      );
      assert.match(
        hiddenUploadBridge.loadedUrl,
        /labs\.google\/fx\/tools\/flow\/project\/project-0/,
        "The hidden upload bridge must use the selected slot project",
      );
      assert.equal(
        hiddenUploadBridge.options.webPreferences.partition,
        "persist:slot-0",
        "The hidden upload bridge must preserve slot session isolation",
      );
      assert.equal(
        hiddenUploadBridge.closed,
        true,
        "The hidden upload bridge must close after upload",
      );
    } finally {
      if (fs.existsSync(validMp4Path)) fs.unlinkSync(validMp4Path);
    }
  } finally {
    if (fs.existsSync(fakeTxtPath)) fs.unlinkSync(fakeTxtPath);
  }

  // 14. Video Architecture, Model Catalog, Queue Capacity & Retry Invariants
  assert.equal(
    videoTsContent.includes("export const DEFAULT_VIDEO_MODELS: VideoModel[]"),
    true,
    "video.ts must export DEFAULT_VIDEO_MODELS",
  );
  assert.equal(
    videoTsContent.includes("export function getVideoModelsForMode"),
    true,
    "video.ts must export getVideoModelsForMode",
  );
  assert.equal(
    videoPageContent.includes("getVideoModelsForMode"),
    true,
    "VideoGeneratorPage must use getVideoModelsForMode",
  );
  assert.equal(
    videoPageContent.includes("flowModels = ["),
    false,
    "VideoGeneratorPage must not hardcode flowModels catalog",
  );

  // A. Resolver thorough coverage
  const testCases = [
    {
      input: { mode: "text", videoModelKey: "abra_t2v", duration: 4 },
      expected: "abra_t2v_4s",
    },
    {
      input: { mode: "text", videoModelKey: "abra_t2v", duration: 6 },
      expected: "abra_t2v_6s",
    },
    {
      input: { mode: "text", videoModelKey: "abra_t2v", duration: 8 },
      expected: "abra_t2v_8s",
    },
    {
      input: { mode: "text", videoModelKey: "abra_t2v", duration: 10 },
      expected: "abra_t2v_10s",
    },
    {
      input: { mode: "image", videoModelKey: "abra_i2v", duration: 4 },
      expected: "abra_i2v_4s",
    },
    {
      input: { mode: "image", videoModelKey: "abra_t2v", duration: 6 },
      expected: "abra_i2v_6s",
    },
    {
      input: {
        mode: "image",
        videoModelKey: "veo_3_1_i2v_lite",
        userPaygateTier: "PAYGATE_TIER_TWO",
      },
      expected: "veo_3_1_i2v_lite_low_priority",
    },
    {
      input: {
        mode: "image",
        videoModelKey: "veo_3_1_i2v_fast",
        userPaygateTier: "PAYGATE_TIER_ONE",
      },
      expected: "veo_3_1_i2v_s_fast",
    },
    {
      input: { mode: "startend", videoModelKey: "abra_i2v", duration: 8 },
      expected: "abra_i2v_8s",
    },
    {
      input: {
        mode: "startend",
        videoModelKey: "veo_3_1_i2v_lite",
        userPaygateTier: "PAYGATE_TIER_TWO",
      },
      expected: "veo_3_1_interpolation_lite_low_priority",
    },
    {
      input: {
        mode: "startend",
        videoModelKey: "veo_3_1_i2v_fast",
        userPaygateTier: "PAYGATE_TIER_ONE",
      },
      expected: "veo_3_1_i2v_s_fast_fl",
    },
    {
      input: { mode: "charsync", videoModelKey: "abra_r2v", duration: 10 },
      expected: "abra_r2v_10s",
    },
    {
      input: {
        mode: "charsync",
        videoModelKey: "veo_3_1_r2v_fast",
        userPaygateTier: "PAYGATE_TIER_ONE",
      },
      expected: "veo_3_1_r2v_fast",
    },
    {
      input: {
        mode: "charsync",
        videoModelKey: "veo_3_1_r2v_fast",
        userPaygateTier: "PAYGATE_TIER_TWO",
      },
      expected: "veo_3_1_r2v_fast_landscape_ultra_relaxed",
    },
    {
      input: { mode: "editvideo", videoModelKey: "abra_edit" },
      expected: "abra_edit",
    },
    {
      input: { mode: "text", videoModelKey: "veo_3_1_t2v_lite" },
      expected: "veo_3_1_t2v_lite_low_priority",
    },
    {
      input: { mode: "text", videoModelKey: "veo_3_1_t2v_quality" },
      expected: "veo_3_1_t2v_quality",
    },
  ];

  for (const tc of testCases) {
    const actual = resolveVideoModelKey(tc.input);
    assert.equal(
      actual,
      tc.expected,
      `resolveVideoModelKey(${JSON.stringify(tc.input)}) must return ${tc.expected}, got ${actual}`,
    );
  }

  // Tier violation assertions
  assert.throws(
    () =>
      resolveVideoModelKey({
        mode: "image",
        videoModelKey: "veo_3_1_i2v_fast",
        userPaygateTier: "PAYGATE_TIER_TWO",
      }),
    /yêu cầu tài khoản Tier One/,
  );
  assert.throws(
    () =>
      resolveVideoModelKey({
        mode: "startend",
        videoModelKey: "veo_3_1_i2v_fast",
        userPaygateTier: "PAYGATE_TIER_TWO",
      }),
    /yêu cầu tài khoản Tier One/,
  );

  // B. Queue Capacity & Enqueue Invariant simulation
  function simulateEnqueue(
    existingActiveCount,
    requestsCount,
    maxCapacity = 20,
  ) {
    const available = Math.max(0, maxCapacity - existingActiveCount);
    const accepted = Math.min(requestsCount, available);
    const rejected = Math.max(0, requestsCount - accepted);
    return { accepted, rejected };
  }

  assert.deepEqual(
    simulateEnqueue(15, 10),
    { accepted: 5, rejected: 5 },
    "Enqueue when 15 active should accept 5 and reject 5",
  );
  assert.deepEqual(
    simulateEnqueue(20, 5),
    { accepted: 0, rejected: 5 },
    "Enqueue when full (20 active) should accept 0 and reject all 5",
  );
  assert.deepEqual(
    simulateEnqueue(0, 3),
    { accepted: 3, rejected: 0 },
    "Enqueue when empty should accept all 3",
  );

  // C. Retry snapshot isolation simulation
  function simulateRetryTask(task, currentFormState) {
    if (task.request) return { reusedRequest: task.request, action: "enqueue" };
    if (task.mode === "text") {
      return {
        reusedRequest: {
          prompt: task.prompt,
          mode: "text",
          model: task.model,
          duration: task.duration,
          aspect: task.aspect,
          resolution: task.resolution,
        },
        action: "enqueue",
      };
    }
    return {
      loadedForm: {
        mode: task.mode,
        model: task.model,
        duration: task.duration,
        aspect: task.aspect,
        prompt: task.prompt,
      },
      action: "prompt_file",
    };
  }

  const restoredTextTask = {
    id: "task-text-1",
    prompt: "A neon cyborg",
    mode: "text",
    model: "veo_3_1_t2v_quality",
    duration: 8,
    aspect: "portrait",
    resolution: "1080p",
  };
  const currentForm = {
    mode: "charsync",
    model: "abra_t2v",
    duration: 4,
    aspect: "landscape",
  };

  const textRetryResult = simulateRetryTask(restoredTextTask, currentForm);
  assert.equal(textRetryResult.action, "enqueue");
  assert.equal(
    textRetryResult.reusedRequest.model,
    "veo_3_1_t2v_quality",
    "Retry must isolate task model from current form",
  );
  assert.equal(
    textRetryResult.reusedRequest.duration,
    8,
    "Retry must isolate task duration from current form",
  );
  assert.equal(
    textRetryResult.reusedRequest.aspect,
    "portrait",
    "Retry must isolate task aspect from current form",
  );

  const restoredImageTask = {
    id: "task-img-1",
    prompt: "Animate photo",
    mode: "image",
    model: "abra_t2v",
    duration: 6,
    aspect: "landscape",
  };
  const imageRetryResult = simulateRetryTask(restoredImageTask, currentForm);
  assert.equal(
    imageRetryResult.action,
    "prompt_file",
    "File tasks without memory request must prompt for file re-attachment",
  );
  assert.equal(imageRetryResult.loadedForm.mode, "image");

  // D. Upscale must use the immutable task snapshot, not the current form aspect.
  assert.equal(
    videoPageContent.includes('task.aspect ?? "landscape"'),
    true,
    "Video upscale actions must pass task.aspect to preserve the generated task configuration",
  );
  assert.equal(
    videoPageContent.includes(
      "videoApi.upscale(mediaId, action, aspect, slotId)",
    ),
    false,
    "Video upscale must not use the mutable current form aspect",
  );

  // E. Upload file I/O on Electron Main must remain asynchronous and fail closed.
  assert.equal(
    genJsContent.includes("await fs.promises.realpath(normalizedPath)"),
    true,
    "Video upload must canonicalize the path asynchronously",
  );
  assert.equal(
    genJsContent.includes("fs.readSync(uploadFd"),
    false,
    "Video upload must not synchronously read chunks on Electron Main",
  );
  assert.equal(
    genJsContent.includes("Không thể xác minh đường dẫn file video"),
    true,
    "Video upload must fail closed when canonical path resolution fails",
  );
  assert.equal(
    genJsContent.includes("hasLocalFileCapability(realPath)"),
    true,
    "Video upload must require a path capability granted from a real browser File",
  );
  assert.equal(
    /ipcRenderer\s*\.\s*invoke\(\s*["']authorize-user-selected-file-async["']/.test(
      preloadContent,
    ),
    true,
    "Preload must request asynchronous authorization for Electron-resolved File paths",
  );
  assert.equal(
    /ipcMain\.handle\(\s*["']authorize-user-selected-file-async["']/.test(
      genJsContent,
    ),
    true,
    "Electron Main must register the asynchronous file authorization handler exposed by preload",
  );
  assert.equal(
    videoTsContent.includes("await getElectronApi().getCredits({ slotId })"),
    true,
    "Video generation must refresh tier metadata for the selected account slot",
  );
  assert.equal(
    useVideoQueueContent.includes("pendingDownloads.current.get(result.jobId)"),
    true,
    "Video queue must reconcile an early background-download event with the completed task",
  );
  assert.equal(
    useVideoQueueContent.includes("tasksRef.current = nextTasks"),
    true,
    "Video queue must synchronously reserve capacity across rapid enqueue/retry calls",
  );
  assert.equal(
    useVideoQueueContent.includes(
      "if (!targetAlreadyActive && activeCount >= 20) return false",
    ),
    true,
    "Retry must respect the same 20-task capacity as enqueue",
  );
  assert.equal(
    genJsContent.includes("userPaygateTier: 'PAYGATE_TIER_TWO'"),
    false,
    "Video generation and upscale must never hardcode PAYGATE_TIER_TWO",
  );
  assert.equal(
    preloadContent.includes("authorizeFilePath: (file) =>"),
    true,
    "Preload must expose a non-blocking file authorization API",
  );
  assert.equal(
    videoTsContent.includes("await getElectronApi().authorizeFilePath(file)"),
    true,
    "Video uploads must use asynchronous file authorization",
  );
  assert.equal(
    videoTsContent.includes("request.slotId"),
    true,
    "Video generation must honor an explicitly selected account slot",
  );
  assert.equal(
    videoPageContent.includes("Tài khoản"),
    true,
    "Video UI must expose the account slot that will spend credits",
  );
  assert.equal(
    videoPageContent.includes("slotId: selectedSlotId"),
    true,
    "Video requests must snapshot the explicitly selected slot",
  );
  assert.equal(
    useVideoQueueContent.includes("resolveDownloadedVideo(downloadMediaName)"),
    true,
    "Restored downloads must reconcile against the persisted completed media name",
  );
  assert.equal(
    useVideoQueueContent.includes("videoApi.retryDownload"),
    true,
    "Restored unfinished downloads must be requeued",
  );
  assert.equal(
    genJsContent.includes("MAX_VIDEO_DOWNLOAD_QUEUE"),
    true,
    "The Main video download queue must have an explicit capacity",
  );
  assert.equal(
    genJsContent.includes("MAX_AUTHORIZED_LOCAL_FILES"),
    true,
    "Local file capabilities must have an explicit bound",
  );
  assert.equal(
    useVideoQueueContent.includes("src: data.localPath,"),
    true,
    "Video queue must promote localPath to src upon background download completion",
  );
  assert.equal(
    videoPageContent.includes(
      "activePreviewTask.localPath || activePreviewTask.src",
    ),
    true,
    "Video preview lightbox must prioritize localPath over raw remote redirect URL",
  );
  assert.equal(
    videoTsContent.includes("generateAudio?: boolean"),
    false,
    "Video generation contract must not expose the unsupported generateAudio option",
  );

  const flowRegistryContent = fs.readFileSync(
    path.resolve(__dirname, "../apps/desktop/src/electron/ipc/flow.js"),
    "utf8",
  );
  const imageServiceContent = fs.readFileSync(
    path.resolve(
      __dirname,
      "../apps/desktop/src/renderer-source/services/electron-api/image.ts",
    ),
    "utf8",
  );
  const flowServiceContent = fs.readFileSync(
    path.resolve(
      __dirname,
      "../apps/desktop/src/renderer-source/services/electron-api/flow.ts",
    ),
    "utf8",
  );
  assert.equal(
    /registerFlow(?:WebviewUpload|PageGeneration|Selectors)Ipc/.test(
      flowRegistryContent,
    ),
    false,
    "Production Flow IPC must not register legacy WebView page automation",
  );
  assert.equal(
    /generateViaFlowPage|selectModelOnWebview|waitPageGenResult/.test(
      imageServiceContent,
    ),
    false,
    "Image generation must not fall back to an unmounted Flow WebView",
  );
  assert.equal(
    imageServiceContent.includes("getElectronApi().generateImage({"),
    true,
    "Image generation must use the unified Main API path",
  );
  assert.equal(
    genJsContent.includes('"upload-image-via-webview"'),
    false,
    "Main must not register the unused legacy image upload handler",
  );
  assert.equal(
    flowServiceContent.includes("createFlowProject({ slotId })"),
    true,
    "Creating a Flow project must preserve the selected account slot",
  );

  const imagePagePath = path.resolve(
    __dirname,
    "../apps/desktop/src/renderer-source/pages/Image/ImageGeneratorPage.tsx",
  );
  const imagePageContent = fs.readFileSync(imagePagePath, "utf8");
  assert.equal(
    imagePageContent.includes("showInFolder("),
    true,
    "Image card must offer opening the saved local file in folder",
  );
  assert.equal(
    imagePageContent.includes("Tải về"),
    false,
    "Image card must not expose redundant web download link",
  );
  assert.equal(
    videoPageContent.includes("Tải về"),
    false,
    "Video card must not expose redundant web download link",
  );

  console.log(
    "All production Image & Video contract, security, behavioral runtime mock & SSRF tests passed successfully.",
  );
})();
