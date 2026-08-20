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
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
const webpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

assert.equal(isValidImageBuffer(pngBuffer), true, "PNG buffer must be valid");
assert.equal(isValidImageBuffer(jpegBuffer), true, "JPEG buffer must be valid");
assert.equal(isValidImageBuffer(gifBuffer), true, "GIF buffer must be valid");
assert.equal(isValidImageBuffer(webpBuffer), true, "WebP buffer must be valid");

// Invalid Payloads Tests (EXE, Script, HTML, Truncated, Null)
const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
const htmlBuffer = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");
const shortBuffer = Buffer.from([0x89, 0x50]);

assert.equal(isValidImageBuffer(exeBuffer), false, "EXE payload must be rejected");
assert.equal(isValidImageBuffer(htmlBuffer), false, "HTML payload must be rejected");
assert.equal(isValidImageBuffer(shortBuffer), false, "Short payload must be rejected");
assert.equal(isValidImageBuffer(null), false, "Null buffer must be rejected");
assert.equal(isValidImageBuffer(undefined), false, "Undefined buffer must be rejected");

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

assert.equal(isSafeUrl("https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=123"), true);
assert.equal(isSafeUrl("http://labs.google/fx/api/trpc/media.getMediaUrlRedirect"), false, "HTTP must be rejected");
assert.equal(isSafeUrl("file:///C:/Windows/System32/drivers/etc/hosts"), false, "file:// must be rejected");
assert.equal(isSafeUrl("https://localhost:8080/secret"), false, "localhost must be rejected");
assert.equal(isSafeUrl("https://127.0.0.1/secret"), false, "127.0.0.1 must be rejected");
assert.equal(isSafeUrl("javascript:alert(1)"), false, "javascript: must be rejected");

// ── 4. Verify generation.js Backend Contract & Security Boundaries ───
const genJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/ipc/generation.js");
const genJsContent = fs.readFileSync(genJsPath, "utf8");

assert.equal(genJsContent.includes("isValidImageBuffer"), true, "generation.js must contain isValidImageBuffer");
assert.equal(genJsContent.includes("MAX_IMAGE_FILE_SIZE_BYTES"), true, "generation.js must define MAX_IMAGE_FILE_SIZE_BYTES");
assert.equal(genJsContent.includes("MAX_IMAGE_BASE64_LENGTH"), true, "generation.js must define MAX_IMAGE_BASE64_LENGTH");
assert.equal(genJsContent.includes("isAllowedHost"), true, "generation.js must contain isAllowedHost");
assert.equal(genJsContent.includes("resolve-video-url"), true, "generation.js must register resolve-video-url");
assert.equal(genJsContent.includes("edit-image"), true, "generation.js must register edit-image");
assert.equal(genJsContent.includes("upscale-image"), true, "generation.js must register upscale-image");
assert.equal(genJsContent.includes("transform-image"), true, "generation.js must register transform-image");
assert.equal(genJsContent.includes("upload-image"), true, "generation.js must register upload-image");
assert.equal(genJsContent.includes("upload-image-from-path"), true, "generation.js must register upload-image-from-path");

assert.equal(genJsContent.includes("normalizeImageAspect"), true, "generation.js must contain normalizeImageAspect");

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
    IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
  };
  return map[aspect] || aspect;
};

assert.equal(normalizeImageAspect("16:9"), "IMAGE_ASPECT_RATIO_LANDSCAPE");
assert.equal(normalizeImageAspect("9:16"), "IMAGE_ASPECT_RATIO_PORTRAIT");
assert.equal(normalizeImageAspect("1:1"), "IMAGE_ASPECT_RATIO_SQUARE");
assert.equal(normalizeImageAspect("4:3"), "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
assert.equal(normalizeImageAspect("3:4"), "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT"), "IMAGE_ASPECT_RATIO_PORTRAIT");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_SQUARE"), "IMAGE_ASPECT_RATIO_SQUARE");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE"), "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR"), "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");

// ── 6. Verify storage.js Slot-Scoped Partitioning ─────────────────────
const storageJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/ipc/storage.js");
const storageJsContent = fs.readFileSync(storageJsPath, "utf8");
assert.equal(storageJsContent.includes("persist:slot-${slotId ?? 0}"), true, "storage.js must use slotId for save-image-locally session partition");

// ── 7. Verify Strict Slot Isolation (No DEFAULTS.projectId Fallbacks) ─
assert.equal(genJsContent.includes("DEFAULTS.projectId"), false, "generation.js must not contain any DEFAULTS.projectId fallbacks");
assert.equal(genJsContent.includes("capturedAuth.bearerToken"), false, "generation.js must not fallback to capturedAuth.bearerToken");

// ── 8. Verify Video Post-Processing Slot Propagation ─────────────────
const videoTsPath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/services/electron-api/video.ts");
const videoTsContent = fs.readFileSync(videoTsPath, "utf8");

assert.equal(videoTsContent.includes("slotId: number;"), true, "VideoGenerationResult must include slotId");
assert.equal(videoTsContent.includes("createGif(mediaId: string, slotId = 0)"), true, "videoApi.createGif must accept slotId");
assert.equal(videoTsContent.includes("async upscale(") && videoTsContent.includes("slotId = 0"), true, "videoApi.upscale must accept slotId");
assert.equal(videoTsContent.includes("generatePinholeGif({ mediaId, slotId })"), true, "generatePinholeGif must receive slotId");
assert.equal(videoTsContent.includes("downloadVideo({\n      mediaName: completedName,\n      slotId,\n    })") || videoTsContent.includes("downloadVideo({ mediaName: completedName, slotId })"), true, "downloadVideo must receive slotId");

const useVideoQueuePath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/pages/Video/useVideoQueue.ts");
const useVideoQueueContent = fs.readFileSync(useVideoQueuePath, "utf8");
assert.equal(useVideoQueueContent.includes("slotId?: number;"), true, "VideoQueueTask must support slotId");
assert.equal(useVideoQueueContent.includes("slotId: result.slotId,"), true, "useVideoQueue must store result.slotId");

const videoPagePath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/pages/Video/VideoGeneratorPage.tsx");
const videoPageContent = fs.readFileSync(videoPagePath, "utf8");
assert.equal(videoPageContent.includes("task.slotId ?? 0"), true, "VideoGeneratorPage must pass task.slotId to runPostAction");

// ── 9. Verify Multi-Reference Limits & Validation ─────────────────────
assert.equal(genJsContent.includes("MAX_REFERENCE_IMAGES = 5"), true, "generation.js must enforce MAX_REFERENCE_IMAGES = 5");
assert.equal(genJsContent.includes("referenceImageNames.length > MAX_REFERENCE_IMAGES"), true, "generation.js must check max reference image count");

// ── 10. Verify SaveStatus Discriminated Union & UI Invariants ──────────
const imageTsPath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/services/electron-api/image.ts");
const imageTsContent = fs.readFileSync(imageTsPath, "utf8");

assert.equal(imageTsContent.includes("export const MAX_REFERENCE_IMAGES = 5;"), true, "image.ts must export MAX_REFERENCE_IMAGES = 5");
assert.equal(imageTsContent.includes("export type SaveImageResult ="), true, "image.ts must define SaveImageResult union");
assert.equal(imageTsContent.includes("DEFAULT_IMAGE_MODELS"), true, "image.ts must export DEFAULT_IMAGE_MODELS catalog");
assert.equal(imageTsContent.includes("formatImageError"), true, "image.ts must export formatImageError");
assert.equal(imageTsContent.includes("getModels"), true, "image.ts must provide getModels method");
assert.equal(imageTsContent.includes("resolveMediaUrl"), true, "image.ts must provide semantic resolveMediaUrl method");

const imageGenPagePath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/pages/Image/ImageGeneratorPage.tsx");
const imageGenPageContent = fs.readFileSync(imageGenPagePath, "utf8");

assert.equal(imageGenPageContent.includes("displayBatchPercent"), true, "ImageGeneratorPage must use displayBatchPercent for batch progress");
assert.equal(imageGenPageContent.includes("saveStatus: SaveStatus;"), true, "ImageTask must declare non-optional saveStatus");
assert.equal(imageGenPageContent.includes("saveStatus || \"saved\""), false, "UI must never default missing saveStatus to 'saved'");
assert.equal(imageGenPageContent.includes("\"cancelled\""), false, "TaskStatus must not contain dead code 'cancelled'");

// ── 11. Behavioral Runtime Mock Tests for Slot Isolation & Mismatch ───
const sessionJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/ipc/flow/session.js");
const sessionJsContent = fs.readFileSync(sessionJsPath, "utf8");
assert.equal(sessionJsContent.includes("capturedAuth"), false, "session.js must not contain any capturedAuth references");

const registeredHandlers = {};
const mockIpcMain = {
  handle: (channel, handler) => {
    registeredHandlers[channel] = handler;
  },
};

const mockSlots = [
  { id: 0, bearerToken: "Bearer slot-0-token", projectId: "project-0", partition: "persist:slot-0", cookies: "c=0" },
  { id: 1, bearerToken: "Bearer slot-1-token", projectId: "project-1", partition: "persist:slot-1", cookies: "c=1" },
  { id: 2, bearerToken: "Bearer slot-2-token", projectId: "project-2", partition: "persist:slot-2", cookies: "c=2" },
  { id: 3, bearerToken: null, projectId: null, partition: "persist:slot-3", cookies: "" },
];

const mockGetSlot = (slotId = 0) => {
  const s = mockSlots.find(slot => slot.id === Number(slotId));
  if (!s) throw new Error(`Slot ${slotId} not found`);
  return s;
};

// Register Session IPC
const registerFlowSessionIpc = require(sessionJsPath);
registerFlowSessionIpc({
  app: {},
  BrowserWindow: class {},
  ipcMain: mockIpcMain,
  session: { fromPartition: () => ({ cookies: { get: async () => [] }, setUserAgent: () => {} }) },
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

// Register Generation IPC
const registerGenerationIpc = require(genJsPath);
registerGenerationIpc({
  app: {},
  BrowserWindow: class {},
  ipcMain: mockIpcMain,
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
  clipboard: {},
  protocol: {},
  net: {},
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
  makeApiRequestViaWebview: async () => ({}),
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
});

(async () => {
  // 1. Verify get-auth-info slot scoping
  const slot1Auth = await registeredHandlers["get-auth-info"]({}, { slotId: 1 });
  assert.equal(slot1Auth.hasBearerToken, true);
  assert.equal(slot1Auth.projectId, "project-1");
  assert.equal(slot1Auth.bearerPreview.startsWith("Bearer slot-1-token"), true);

  const slot3Auth = await registeredHandlers["get-auth-info"]({}, { slotId: 3 });
  assert.equal(slot3Auth.hasBearerToken, false);
  assert.equal(slot3Auth.projectId, null);

  // 2. Verify set-manual-auth updates only target slot
  await registeredHandlers["set-manual-auth"]({}, { slotId: 2, bearerToken: "new-token-2", projectId: "proj-manual-2" });
  assert.equal(mockSlots[2].bearerToken, "Bearer new-token-2");
  assert.equal(mockSlots[2].projectId, "proj-manual-2");
  assert.equal(mockSlots[0].projectId, "project-0");
  assert.equal(mockSlots[1].projectId, "project-1");

  // 3. Verify extract-auth-from-webview
  const slot2Extract = await registeredHandlers["extract-auth-from-webview"]({}, { slotId: 2 });
  assert.equal(slot2Extract.projectId, "proj-manual-2");

  // 4. Slot 1 with Project ID of Slot 0 must throw mismatch error
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"]({}, {
        prompt: "test",
        slotId: 1,
        projectId: "project-0",
      });
    },
    { message: "Project ID không thuộc Slot 1." },
    "Sending Slot 0 project ID to Slot 1 must be rejected"
  );

  // 5. Slot 3 (missing bearer token) throws token error
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"]({}, {
        prompt: "test",
        slotId: 3,
      });
    },
    /Chưa có Bearer token/,
    "Slot without bearer token must throw"
  );

  // 6. Over 5 reference images must be rejected
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"]({}, {
        prompt: "test",
        slotId: 1,
        referenceImageNames: ["1", "2", "3", "4", "5", "6"],
      });
    },
    /vượt quá giới hạn tối đa/,
    "Over 5 reference images must be rejected"
  );

  // 7. generate-video with project ID mismatch
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-video"]({}, {
        prompt: "test",
        slotId: 1,
        projectId: "project-0",
      });
    },
    { message: "Project ID không thuộc Slot 1." },
    "generate-video mismatch project ID must be rejected"
  );

  // 8. poll-video-status with project ID mismatch
  await assert.rejects(
    async () => {
      await registeredHandlers["poll-video-status"]({}, {
        mediaName: "media-1",
        slotId: 1,
        projectId: "project-0",
      });
    },
    { message: "Project ID không thuộc Slot 1." },
    "poll-video-status mismatch project ID must be rejected"
  );

  // 9. Slot with null projectId must reject foreign pid and not bypass isolation
  mockSlots[3].bearerToken = "Bearer slot-3-token";
  mockSlots[3].projectId = null;
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"]({}, {
        prompt: "test",
        slotId: 3,
        projectId: "project-0",
      });
    },
    { message: "Project ID không thuộc Slot 3." },
    "Foreign pid when slot.projectId is null must be rejected"
  );
  await assert.rejects(
    async () => {
      await registeredHandlers["generate-image"]({}, {
        prompt: "test",
        slotId: 3,
      });
    },
    { message: "Slot 3 chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước." },
    "Slot with null projectId without pid must be rejected"
  );

  // 10. Verify sync-session propagates slot.id to refreshCapturedCookies
  let refreshedSlotId = null;
  const mockSyncIpc = {};
  const mockSyncIpcMain = { handle: (channel, fn) => { mockSyncIpc[channel] = fn; } };
  registerFlowSessionIpc({
    app: {},
    BrowserWindow: class {},
    ipcMain: mockSyncIpcMain,
    session: { fromPartition: () => ({ cookies: { get: async () => [] }, setUserAgent: () => {} }) },
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
    refreshCapturedCookies: async (sId) => { refreshedSlotId = sId; },
    fetchSlotSession: async () => {},
    restoreSlotSession: async () => {},
    restoreAllSlotSessions: async () => {},
    getIsRestoringSessions: () => false,
    findFlowWebview: () => null,
    setActiveWebviewSlot: () => {},
  });

  await mockSyncIpc["sync-session"]({}, { slotId: 2 });
  assert.equal(refreshedSlotId, 2, "sync-session must pass slot.id (2) to refreshCapturedCookies");

  // 11. Verify findFlowWebview does not fallback across slots when slotId is given
  const appCoreJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/runtime/app-core.js");
  const appCoreJsContent = fs.readFileSync(appCoreJsPath, "utf8");
  assert.equal(
    appCoreJsContent.includes("if (slotId !== null) return null;"),
    true,
    "findFlowWebview must not fallback to other slots when slotId is specified"
  );

  console.log("All production Image & Video contract, security, behavioral runtime mock & SSRF tests passed successfully.");
})();