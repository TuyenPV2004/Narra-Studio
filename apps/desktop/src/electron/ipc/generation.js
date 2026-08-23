"use strict";

const runtimeEndpoints = require("../../config/runtime-endpoints.json");
const {
  requirePaygateTier,
  resolveVideoModelKey,
} = require("./video-model-policy");

// ── Validation Helpers ───────────────────────────────────────────────
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return true;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return true;
  // GIF: 47 49 46 38
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  )
    return true;
  // WEBP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer.length >= 12 &&
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
}

function isValidVideoBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  // MP4 / MOV / M4V (ISO Base Media File Format box types at offset 4..7)
  const boxType = buffer.toString("ascii", 4, 8);
  if (["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(boxType)) {
    return true;
  }

  // WebM / MKV (EBML header: 1A 45 DF A3)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return true;
  }

  // AVI (RIFF .... AVI )
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "AVI "
  ) {
    return true;
  }

  // FLV (FLV\x01)
  if (
    buffer[0] === 0x46 &&
    buffer[1] === 0x4c &&
    buffer[2] === 0x56 &&
    buffer[3] === 0x01
  ) {
    return true;
  }

  return false;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_IMAGE_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_IMAGE_BASE64_LENGTH = 35 * 1024 * 1024; // ~35MB Base64 string (~25MB binary)

const ALLOWED_VIDEO_EXTS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
]);
const MAX_VIDEO_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB max limit for video upload

module.exports = function registerGenerationIpc(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    clipboard,
    protocol,
    net,
    shell,
    dialog,
    path,
    https,
    http,
    fs,
    os,
    crypto,
    pathToFileURL,
    fileURLToPath,
    captchaBridge,
    runtime,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    truncatePreview,
    SESSION_PARTITION,
    MAX_SLOTS,
    isDev,
    SETTINGS_FILE,
    loadSettings,
    saveSettings,
    getVideoOutputDir,
    getImageOutputDir,
    getNextFilename,
    buildCleanUserAgent,
    DEFAULTS,
    accountSlots,
    getSlot,
    slotRequestCounts,
    markSlotBusy,
    markSlotFree,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    clearSlotSessionData,
    fetchSlotEmail,
    createWindow,
    setupRequestInterception,
    getPlatformChHint,
    getChromeMajorVersion,
    buildHeaders,
    generateUUID,
    DRYRUN_FLAG_FILE,
    DRYRUN_CAPTURE_FILE,
    isDryRunActive,
    makeApiRequest,
    RECAPTCHA_SITE_KEY,
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    makeApiRequestWithCaptcha,
    getChromeRuntime,
  } = dependencies;

  const AUTHORIZED_LOCAL_FILE_TTL_MS = 30 * 60 * 1000;
  const MAX_AUTHORIZED_LOCAL_FILES = 256;
  const authorizedLocalFilePaths = new Map();

  function normalizeCapabilityKey(filePath) {
    if (typeof filePath !== "string" || !filePath) return "";
    const normalized = path.normalize(filePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }

  function grantLocalFileCapability(canonicalPath) {
    const key = normalizeCapabilityKey(canonicalPath);
    if (!key) return canonicalPath;
    const expiresAt = Date.now() + AUTHORIZED_LOCAL_FILE_TTL_MS;
    authorizedLocalFilePaths.delete(key);
    authorizedLocalFilePaths.set(key, expiresAt);
    while (authorizedLocalFilePaths.size > MAX_AUTHORIZED_LOCAL_FILES) {
      authorizedLocalFilePaths.delete(
        authorizedLocalFilePaths.keys().next().value,
      );
    }
    return canonicalPath;
  }

  function hasLocalFileCapability(canonicalPath) {
    const key = normalizeCapabilityKey(canonicalPath);
    if (!key) return false;
    const expiresAt = authorizedLocalFilePaths.get(key);
    if (!expiresAt || expiresAt <= Date.now()) {
      authorizedLocalFilePaths.delete(key);
      return false;
    }
    authorizedLocalFilePaths.set(
      key,
      Date.now() + AUTHORIZED_LOCAL_FILE_TTL_MS,
    );
    return true;
  }

  function resolveLocalPathString(inputPath) {
    if (typeof inputPath !== "string" || !inputPath.trim()) return "";
    let resolvedPath = inputPath.trim();
    try {
      if (resolvedPath.startsWith("file://")) {
        resolvedPath = fileURLToPath(resolvedPath);
      }
    } catch (_) {
      resolvedPath = resolvedPath.replace(/^file:[/\\]{2,3}/, "");
      resolvedPath = decodeURIComponent(resolvedPath);
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(resolvedPath)) {
        resolvedPath = resolvedPath.slice(1);
      }
    }
    if (resolvedPath.includes("%")) {
      try {
        resolvedPath = decodeURIComponent(resolvedPath);
      } catch {}
    }
    return path.normalize(resolvedPath);
  }

  ipcMain.on("authorize-user-selected-file", (event, filePath) => {
    event.returnValue = "";
    try {
      const target = resolveLocalPathString(filePath);
      if (!target) return;
      const canonicalPath = fs.realpathSync(target);
      if (!fs.statSync(canonicalPath).isFile()) return;
      event.returnValue = grantLocalFileCapability(canonicalPath);
    } catch {
      // Fail closed: a path that Electron/Main cannot canonicalize is not
      // eligible for any later upload request from the renderer.
    }
  });

  ipcMain.handle(
    "authorize-user-selected-file-async",
    async (_event, filePath) => {
      const target = resolveLocalPathString(filePath);
      if (!target) return "";
      try {
        const canonicalPath = await fs.promises.realpath(target);
        const stats = await fs.promises.stat(canonicalPath);
        if (!stats.isFile()) return "";
        return grantLocalFileCapability(canonicalPath);
      } catch {
        return "";
      }
    },
  );

  // ── Get Credits Balance ───────────────────────────────────────────────
  ipcMain.handle("get-credits", async (_event, { slotId } = {}) => {
    const slot = getSlot(slotId ?? 0);
    if (!slot.bearerToken) return null;
    try {
      const url = new URL("https://aisandbox-pa.googleapis.com/v1/credits");
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          accept: "*/*",
          authorization: slot.bearerToken,
          origin: "https://labs.google",
          referer: "https://labs.google/",
        },
      });
      if (!resp.ok) return null;
      const data = await resp.json();

      const tier = data.userPaygateTier || "";
      const sku = data.sku || "";
      const isUltra = sku === "G1_TIER2" || sku === "WS_ULTRA";

      // Keep the account-specific model policy on the same isolated slot that
      // owns the authenticated Flow session. Video handlers use this value when
      // resolving tier-dependent model keys.
      if (tier) slot.userPaygateTier = tier;
      if (sku) slot.sku = sku;

      return {
        credits: data.credits || 0,
        tier,
        sku,
        serviceTier: data.serviceTier || "",
        isUltra,
        slotId: slot.id,
      };
    } catch (err) {
      return null;
    }
  });

  // ── License Management ────────────────────────────────────────────────
  // ── Machine fingerprint ──────────────────────────────────────────────

  function normalizeImageAspect(aspect) {
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
  }

  ipcMain.handle(
    "generate-image",
    async (
      _,
      {
        prompt,
        captchaToken,
        model,
        aspectRatio,
        seed,
        projectId: pid,
        bearerToken: manualBt,
        count,
        referenceImageName,
        referenceImageNames,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);

      if (manualBt) {
        slot.bearerToken = manualBt.startsWith("Bearer ")
          ? manualBt
          : "Bearer " + manualBt;
      }

      if (!slot.bearerToken) {
        throw new Error(
          "Chưa có Bearer token! Vui lòng:\n1. Vào tab WebView → tương tác với Flow (tạo project, generate ảnh)\n2. Hoặc vào Cài đặt → nhập Bearer token thủ công",
        );
      }

      if (pid && pid !== slot.projectId) {
        throw new Error(`Project ID không thuộc Slot ${slot.id}.`);
      }
      const projectId = slot.projectId;
      if (!projectId) {
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );
      }

      const normalizedAspect = normalizeImageAspect(aspectRatio);
      const imageCount = Math.min(Math.max(count || 1, 1), 4);
      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();

      const placeholderCtx = {
        recaptchaContext: {
          token: captchaToken || "",
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        projectId,
        tool: "PINHOLE",
        sessionId,
      };

      // Build imageInputs — enforce max 5 reference images in Main process
      const MAX_REFERENCE_IMAGES = 5;
      let imageInputs = [];
      if (referenceImageNames !== undefined && referenceImageNames !== null) {
        if (!Array.isArray(referenceImageNames)) {
          throw new Error("referenceImageNames phải là một mảng chuỗi.");
        }
        if (referenceImageNames.length > MAX_REFERENCE_IMAGES) {
          throw new Error(
            `Số lượng ảnh tham chiếu vượt quá giới hạn tối đa (${MAX_REFERENCE_IMAGES} ảnh).`,
          );
        }
        const cleanNames = referenceImageNames
          .map((name) => (typeof name === "string" ? name.trim() : ""))
          .filter(Boolean);
        const uniqueNames = Array.from(new Set(cleanNames));
        if (uniqueNames.length > MAX_REFERENCE_IMAGES) {
          throw new Error(
            `Số lượng ảnh tham chiếu vượt quá giới hạn tối đa (${MAX_REFERENCE_IMAGES} ảnh).`,
          );
        }
        imageInputs = uniqueNames.map((name) => ({
          imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
          name: name.slice(0, 200),
        }));
        console.log(
          `[SLOT-${slot.id}][API] Using ${imageInputs.length} reference images:`,
          uniqueNames,
        );
      } else if (
        referenceImageName &&
        typeof referenceImageName === "string" &&
        referenceImageName.trim()
      ) {
        imageInputs = [
          {
            imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
            name: referenceImageName.trim().slice(0, 200),
          },
        ];
        console.log(
          `[SLOT-${slot.id}][API] Using reference image: ${referenceImageName}`,
        );
      }

      const requests = [];
      for (let i = 0; i < imageCount; i++) {
        requests.push({
          clientContext: placeholderCtx,
          imageModelName: model || "GEM_PIX_2",
          imageAspectRatio: normalizedAspect,
          structuredPrompt: { parts: [{ text: prompt }] },
          seed: seed ? seed + i : Math.floor(Math.random() * 1000000),
          imageInputs,
        });
      }

      const body = {
        clientContext: placeholderCtx,
        mediaGenerationContext: { batchId },
        useNewMedia: true,
        requests,
      };

      const url = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages`;
      console.log(
        `[SLOT-${slot.id}][API] Batch generate ${imageCount} image(s) [aspect=${normalizedAspect}, model=${model || "GEM_PIX_2"}]`,
      );

      const realCtx = {
        recaptchaContext: {
          token: captchaToken || "",
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        projectId,
        tool: "PINHOLE",
        sessionId,
      };
      body.clientContext = realCtx;
      body.requests.forEach((r) => {
        r.clientContext = realCtx;
      });

      console.log(
        `[SLOT-${slot.id}][API] Getting fresh CAPTCHA via webview...`,
      );
      return makeApiRequestWithCaptcha(url, body, slot.id);
    },
  );

  // ── Edit Image (AI edit with base image) ─────────────────────────────

  ipcMain.handle(
    "edit-image",
    async (
      _,
      {
        prompt,
        captchaToken,
        baseMediaId,
        model,
        aspectRatio,
        seed,
        slotId = 0,
      },
    ) => {
      const slot = getSlot(slotId);
      const bearerToken = slot?.bearerToken;
      if (!bearerToken) {
        throw new Error(
          `Slot ${slotId} chưa được xác thực hoặc chưa có phiên Google Flow.`,
        );
      }
      const projectId = slot.projectId;
      if (!projectId) {
        throw new Error(
          `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );
      }

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const workflowId = generateUUID();
      const ctx = {
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        projectId,
        tool: "PINHOLE",
        workflowId,
        sessionId,
      };

      const body = {
        clientContext: ctx,
        mediaGenerationContext: { batchId },
        useNewMedia: true,
        requests: [
          {
            clientContext: ctx,
            imageModelName: model || "GEM_PIX_2",
            imageAspectRatio: normalizeImageAspect(aspectRatio),
            structuredPrompt: { parts: [{ text: prompt }] },
            seed: seed || Math.floor(Math.random() * 1000000),
            imageInputs: [
              {
                imageInputType: "IMAGE_INPUT_TYPE_BASE_IMAGE",
                name: baseMediaId,
              },
            ],
          },
        ],
      };

      console.log(
        `[SLOT-${slotId}][API] Edit image with base: ${baseMediaId}, prompt: "${prompt}", aspect: ${normalizeImageAspect(aspectRatio)}`,
      );
      const url = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages`;
      return makeApiRequestWithCaptcha(url, body, slotId);
    },
  );

  // ── Upscale Image (1K / 2K / 4K) ─────────────────────────────────────
  ipcMain.handle(
    "upscale-image",
    async (_, { mediaId, captchaToken, targetResolution, slotId = 0 }) => {
      const slot = getSlot(slotId);
      const bearerToken = slot?.bearerToken;
      if (!bearerToken) {
        throw new Error(
          `Slot ${slotId} chưa được xác thực hoặc chưa có phiên Google Flow.`,
        );
      }
      const projectId = slot.projectId;
      if (!projectId) {
        throw new Error(
          `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );
      }
      const sessionId = `;${Date.now()}`;

      const body = {
        mediaId,
        targetResolution, // 'UPSAMPLE_IMAGE_RESOLUTION_1K' | '2K' | '4K'
        clientContext: {
          recaptchaContext: {
            token: captchaToken,
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
          projectId,
          tool: "PINHOLE",
          ...(slot.userPaygateTier
            ? { userPaygateTier: slot.userPaygateTier }
            : {}),
          sessionId,
        },
      };

      console.log(
        `[SLOT-${slotId}][API] Upscale image mediaId=${mediaId} resolution=${targetResolution}`,
      );
      const url = "https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage";
      return makeApiRequestWithCaptcha(url, body, slotId);
    },
  );

  // ── Generate Pinhole GIF (270p animated GIF from video) ───────────────
  ipcMain.handle("generate-pinhole-gif", async (_, { mediaId, slotId = 0 }) => {
    const slot = getSlot(slotId);
    if (!slot?.bearerToken) {
      throw new Error(`Slot ${slotId} chưa có Bearer token!`);
    }
    const body = {
      mediaGenerationId: mediaId,
      mediaId,
    };
    console.log(
      `[SLOT-${slotId}][API] Generate Pinhole GIF mediaId=${mediaId}`,
    );
    const url =
      "https://aisandbox-pa.googleapis.com/v1/video:generatePinholeGif";
    return makeApiRequestWithCaptcha(url, body, slotId);
  });

  // ── Upscale Video (1080p / 4K) ────────────────────────────────────────
  ipcMain.handle(
    "upscale-video",
    async (
      _,
      { mediaId, captchaToken, resolution, aspectRatio, slotId = 0 },
    ) => {
      const slot = getSlot(slotId);
      if (!slot?.bearerToken)
        throw new Error(`Slot ${slotId} chưa có Bearer token!`);
      const resMap = {
        "1080p": {
          res: "VIDEO_RESOLUTION_1080P",
          modelKey: "veo_3_1_upsampler_1080p",
        },
        "4k": { res: "VIDEO_RESOLUTION_4K", modelKey: "veo_3_1_upsampler_4k" },
      };
      const { res, modelKey } = resMap[resolution] || resMap["1080p"];
      const aspectVal =
        aspectRatio === "portrait"
          ? "VIDEO_ASPECT_RATIO_PORTRAIT"
          : "VIDEO_ASPECT_RATIO_LANDSCAPE";
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );
      const body = {
        mediaGenerationContext: { batchId: require("crypto").randomUUID() },
        clientContext: {
          projectId,
          tool: "PINHOLE",
          userPaygateTier: requirePaygateTier(slot.userPaygateTier),
          sessionId: `;${Date.now()}`,
          recaptchaContext: {
            token: captchaToken,
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
        },
        requests: [
          {
            resolution: res,
            aspectRatio: aspectVal,
            seed: Math.floor(Math.random() * 99999),
            videoModelKey: modelKey,
            metadata: { workflowId: require("crypto").randomUUID() },
            videoInput: { mediaId },
          },
        ],
        useV2ModelConfig: true,
      };
      console.log(
        `[SLOT-${slotId}][API] Upscale video ${resolution} mediaId=${mediaId}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo";
      return makeApiRequestWithCaptcha(url, body, slotId, "VIDEO_GENERATION");
    },
  );

  // ── Transform Image (Crop, etc) ───────────────────────────────────────
  ipcMain.handle(
    "transform-image",
    async (_, { mediaId, cropCoordinates, slotId = 0 }) => {
      const slot = getSlot(slotId);
      const bearerToken = slot?.bearerToken;
      if (!bearerToken) {
        throw new Error(
          `Slot ${slotId} chưa có Bearer token hoặc chưa được xác thực!`,
        );
      }

      const body = {
        mediaId,
        isHidden: false,
        cropCoordinates,
        transformationType: "TRANSFORMATION_TYPE_CROP",
      };

      console.log(`[SLOT-${slotId}][API] Transforming image: ${mediaId}`);
      const url = "https://aisandbox-pa.googleapis.com/v1/flow:transformImage";
      return makeApiRequest(url, body, slotId);
    },
  );

  // ── Upload Image ──────────────────────────────────────────────────────
  ipcMain.handle(
    "upload-image",
    async (_, { imageBytes, fileName, mimeType, slotId = 0 }) => {
      if (!imageBytes || typeof imageBytes !== "string") {
        throw new Error("Dữ liệu ảnh không hợp lệ.");
      }
      if (imageBytes.length > MAX_IMAGE_BASE64_LENGTH) {
        throw new Error(
          "Dung lượng base64 vượt quá 35MB (tối đa 25MB decoded).",
        );
      }

      const effectiveMime = (mimeType || "image/jpeg").toLowerCase();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(effectiveMime)) {
        throw new Error(
          `Định dạng MIME không được hỗ trợ: ${mimeType}. Chỉ chấp nhận PNG, JPEG, WebP, GIF.`,
        );
      }

      const buffer = Buffer.from(imageBytes, "base64");
      if (buffer.length > MAX_IMAGE_FILE_SIZE_BYTES) {
        throw new Error(
          `Kích thước ảnh sau giải mã vượt quá 25MB (${(buffer.length / 1024 / 1024).toFixed(1)}MB).`,
        );
      }
      if (!isValidImageBuffer(buffer)) {
        throw new Error(
          "Dữ liệu không phải là hình ảnh hợp lệ (magic bytes không khớp).",
        );
      }

      const slot = getSlot(slotId);
      const bearerToken = slot?.bearerToken;
      if (!bearerToken)
        throw new Error(`Chưa có Bearer token cho slot ${slotId}!`);
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const safeFileName = path
        .basename(fileName || "image.jpg")
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      const body = {
        clientContext: {
          projectId,
          tool: "PINHOLE",
        },
        fileName: safeFileName,
        imageBytes,
        isHidden: false,
        isUserUploaded: true,
        mimeType: effectiveMime,
      };

      console.log(
        `[SLOT-${slotId}][API] Upload image: ${safeFileName} (${(buffer.length / 1024).toFixed(0)}KB)`,
      );
      const url = "https://aisandbox-pa.googleapis.com/v1/flow/uploadImage";
      return makeApiRequest(url, body, slotId);
    },
  );

  // ── Upload Image from file path (avoid renderer memory) ───────────────
  ipcMain.handle(
    "upload-image-from-path",
    async (_, { filePath, fileName, mimeType, slotId = 0 }) => {
      if (!filePath || typeof filePath !== "string") {
        throw new Error("Đường dẫn file không hợp lệ.");
      }

      const slot = getSlot(slotId);
      const bearerToken = slot?.bearerToken;
      if (!bearerToken)
        throw new Error(`Chưa có Bearer token cho slot ${slotId}!`);
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      // Resolve file:// URL → absolute path (fix Windows C:\C:\ double drive + %20 encoding)
      const { fileURLToPath } = require("url");
      let resolvedPath = filePath;
      try {
        if (
          typeof resolvedPath === "string" &&
          resolvedPath.startsWith("file://")
        ) {
          resolvedPath = fileURLToPath(resolvedPath);
        }
      } catch (urlErr) {
        resolvedPath = resolvedPath.replace(/^file:[/\\]{2,3}/, "");
        resolvedPath = decodeURIComponent(resolvedPath);
        if (process.platform === "win32" && /^\/[A-Za-z]:/.test(resolvedPath)) {
          resolvedPath = resolvedPath.slice(1);
        }
      }
      if (resolvedPath.includes("%")) {
        try {
          resolvedPath = decodeURIComponent(resolvedPath);
        } catch {}
      }
      const normalizedPath = path.normalize(resolvedPath);
      console.log(`[UPLOAD] path: ${filePath} → ${normalizedPath}`);
      if (!fs.existsSync(normalizedPath)) {
        throw new Error(
          `File không tồn tại: ${normalizedPath}\n(Path gốc: ${filePath})\nHãy chọn lại ảnh.`,
        );
      }

      let realPath;
      try {
        realPath = fs.realpathSync(normalizedPath);
      } catch {
        realPath = normalizedPath;
      }

      const stats = fs.statSync(realPath);
      if (!stats.isFile()) {
        throw new Error(`Đường dẫn không phải là một file hợp lệ: ${realPath}`);
      }
      if (stats.size > MAX_IMAGE_FILE_SIZE_BYTES) {
        throw new Error(
          `Kích thước file (${(stats.size / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn 25MB.`,
        );
      }

      const ext = path.extname(realPath).toLowerCase();
      if (ext && !ALLOWED_IMAGE_EXTS.has(ext)) {
        throw new Error(
          `Định dạng file không được hỗ trợ (${ext}). Chỉ chấp nhận .jpg, .jpeg, .png, .webp, .gif.`,
        );
      }

      const effectiveMime = (
        mimeType ||
        (ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/jpeg")
      ).toLowerCase();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(effectiveMime)) {
        throw new Error(`Định dạng MIME không được hỗ trợ: ${mimeType}`);
      }

      // Read file in main process and verify magic bytes
      const buffer = fs.readFileSync(realPath);
      if (!isValidImageBuffer(buffer)) {
        throw new Error(
          "Nội dung file không phải định dạng hình ảnh hợp lệ (magic bytes không khớp).",
        );
      }
      const base64 = buffer.toString("base64");
      const safeFileName = path
        .basename(fileName || realPath)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      const body = {
        clientContext: { projectId, tool: "PINHOLE" },
        fileName: safeFileName,
        imageBytes: base64,
        isHidden: false,
        isUserUploaded: true,
        mimeType: effectiveMime,
      };

      console.log(
        `[SLOT-${slotId}][API] Upload image from path: ${safeFileName} (${(buffer.length / 1024).toFixed(0)}KB)`,
      );
      const url = "https://aisandbox-pa.googleapis.com/v1/flow/uploadImage";
      return makeApiRequest(url, body, slotId);
    },
  );

  // ── Generate Video (legacy — used by VideoPage) ──────────────────────
  ipcMain.handle(
    "generate-video",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        projectId: pid,
        duration,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) {
        throw new Error(
          "Chưa có Bearer token! Vào tab WebView → tương tác với Flow trước.",
        );
      }
      if (pid && pid !== slot.projectId) {
        throw new Error(`Project ID không thuộc Slot ${slot.id}.`);
      }
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        ...(slot.userPaygateTier
          ? { userPaygateTier: slot.userPaygateTier }
          : {}),
      };

      const effectiveModelKey = resolveVideoModelKey({
        mode: "text",
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      const body = {
        mediaGenerationContext: { batchId },
        clientContext: ctx,
        requests: [
          {
            aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
            seed: seed || Math.floor(Math.random() * 1000000),
            textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
            videoModelKey: effectiveModelKey,
            metadata: {},
          },
        ],
        useV2ModelConfig: true,
      };

      console.log(
        `[SLOT-${slot.id}][API] Async video generate with model: ${effectiveModelKey}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // ── Generate Video (Text to Video) ────────────────────────────────────
  ipcMain.handle(
    "generate-video-text",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        duration,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        ...(slot.userPaygateTier
          ? { userPaygateTier: slot.userPaygateTier }
          : {}),
      };

      const effectiveModelKey = resolveVideoModelKey({
        mode: "text",
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      const body = {
        mediaGenerationContext: { batchId },
        clientContext: ctx,
        requests: [
          {
            aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
            seed: seed || Math.floor(Math.random() * 1000000),
            textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
            videoModelKey: effectiveModelKey,
            metadata: {},
          },
        ],
        useV2ModelConfig: true,
      };

      console.log(
        `[SLOT-${slot.id}][API] Async video generate with model: ${effectiveModelKey}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // ── Generate Video from Start Image (Image-to-Video) ──────────────────
  ipcMain.handle(
    "generate-video-start-image",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        mediaId,
        cropCoordinates,
        duration,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        ...(slot.userPaygateTier
          ? { userPaygateTier: slot.userPaygateTier }
          : {}),
      };

      const effectiveModelKey = resolveVideoModelKey({
        mode: "image",
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      const body = {
        mediaGenerationContext: { batchId },
        clientContext: ctx,
        requests: [
          {
            aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
            seed: seed || Math.floor(Math.random() * 1000000),
            textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
            videoModelKey: effectiveModelKey,
            metadata: {},
            startImage: cropCoordinates
              ? { mediaId, cropCoordinates }
              : { mediaId },
          },
        ],
        useV2ModelConfig: true,
      };

      console.log(
        `[SLOT-${slot.id}][API] Async video from start image: model=${effectiveModelKey}, mediaId=${mediaId}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage";
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // ── Generate Video from Start + End Image ─────────────────────────────
  ipcMain.handle(
    "generate-video-start-end-image",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        startMediaId,
        endMediaId,
        startCrop,
        endCrop,
        duration,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        ...(slot.userPaygateTier
          ? { userPaygateTier: slot.userPaygateTier }
          : {}),
      };

      const effectiveModelKey = resolveVideoModelKey({
        mode: "startend",
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      const body = {
        mediaGenerationContext: { batchId },
        clientContext: ctx,
        requests: [
          {
            aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
            seed: seed || Math.floor(Math.random() * 1000000),
            textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
            videoModelKey: effectiveModelKey,
            metadata: {},
            startImage: startCrop
              ? { mediaId: startMediaId, cropCoordinates: startCrop }
              : { mediaId: startMediaId },
            endImage: endCrop
              ? { mediaId: endMediaId, cropCoordinates: endCrop }
              : { mediaId: endMediaId },
          },
        ],
        useV2ModelConfig: true,
      };

      console.log(
        `[SLOT-${slot.id}][API] Async video start+end: model=${effectiveModelKey}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage";
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // ── Generate Video with Reference Images (Character Sync) ─────────────
  ipcMain.handle(
    "generate-video-reference-images",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        referenceMediaIds,
        duration,
        slotId,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
        ...(slot.userPaygateTier
          ? { userPaygateTier: slot.userPaygateTier }
          : {}),
      };

      const effectiveModelKey = resolveVideoModelKey({
        mode: "charsync",
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      const referenceImages = (referenceMediaIds || []).map((mediaId) => ({
        mediaId,
        imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
      }));

      const body = {
        mediaGenerationContext: { batchId },
        clientContext: ctx,
        requests: [
          {
            aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
            seed: seed || Math.floor(Math.random() * 1000000),
            textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
            videoModelKey: effectiveModelKey,
            metadata: {},
            referenceImages,
          },
        ],
        useV2ModelConfig: true,
      };

      console.log(
        `[SLOT-${slot.id}][API] Async video reference images: model=${effectiveModelKey}, refs=${referenceMediaIds?.length || 0}`,
      );
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages";
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // Download a generated Flow audio preview through the authenticated account
  // partition. The redirect endpoint authenticates with the labs.google session
  // cookie, while the signed CDN URL it returns needs no Bearer token.
  async function downloadFlowAudioPreview(mediaName, slot, projectId) {
    const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaName)}`;
    const slotSession = session.fromPartition(
      slot.partition || `persist:slot-${slot.id}`,
    );
    const cookies = await slotSession.cookies.get({ domain: "labs.google" });
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      let settled = false;
      let timer = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      const request = net.request({ url: redirectUrl, session: slotSession });
      request.setHeader("Accept", "*/*");
      request.setHeader("Origin", "https://labs.google");
      request.setHeader(
        "Referer",
        `https://labs.google/fx/tools/flow/project/${projectId}`,
      );
      request.setHeader("User-Agent", buildCleanUserAgent());
      if (cookieHeader) request.setHeader("Cookie", cookieHeader);

      request.on("redirect", (statusCode, method, nextUrl) => {
        console.log(
          `[SLOT-${slot.id}][VOICE-PREVIEW] Redirect ${statusCode} → ${String(nextUrl).substring(0, 90)}`,
        );
        request.followRedirect();
      });
      request.on("response", (response) => {
        const rawContentType = response.headers["content-type"];
        const contentType = String(
          Array.isArray(rawContentType)
            ? rawContentType[0]
            : rawContentType || "audio/wav",
        ).split(";")[0];
        if (response.statusCode !== 200) {
          response.on("data", () => {});
          finish(
            new Error(
              `Không thể tải voice preview (HTTP ${response.statusCode}).`,
            ),
          );
          return;
        }
        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 25 * 1024 * 1024) {
            request.abort();
            finish(new Error("Voice preview vượt quá giới hạn 25MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) {
            finish(new Error("Voice preview tải về rỗng."));
            return;
          }
          const mimeType = contentType.startsWith("audio/")
            ? contentType
            : "audio/wav";
          console.log(
            `[SLOT-${slot.id}][VOICE-PREVIEW] Downloaded ${mediaName} (${buffer.length} bytes, ${mimeType})`,
          );
          finish(null, { buffer, mimeType });
        });
        response.on("error", finish);
      });
      request.on("error", finish);
      timer = setTimeout(
        () => finish(new Error("Tải voice preview quá thời gian.")),
        60000,
      );
      request.end();
    });
  }

  // ── Omni Flash custom Voice preview ─────────────────────────────────────────
  ipcMain.handle(
    "generate-flow-voice-preview",
    async (
      _,
      { dialog, voicePerformance, voiceName, baseVoice, slotId = 0 } = {},
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken)
        throw new Error(`Slot ${slotId} chưa có Bearer token!`);
      const projectId = slot.projectId;
      if (!projectId) throw new Error(`Slot ${slotId} chưa có Project ID!`);

      const safeDialog = String(dialog || "")
        .trim()
        .slice(0, 120);
      const safePerformance = String(voicePerformance || "")
        .trim()
        .slice(0, 500);
      const safeVoiceName = String(voiceName || "")
        .trim()
        .slice(0, 80);
      const safeBaseVoice = String(baseVoice || "")
        .trim()
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .slice(0, 80);
      if (!safeDialog) throw new Error("Hãy nhập câu thoại mẫu.");
      if (!safeVoiceName) throw new Error("Hãy nhập tên voice.");
      if (!safeBaseVoice) throw new Error("Hãy chọn voice gốc.");

      const body = {
        clientContext: {
          recaptchaContext: {
            token: "",
            applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
          },
          projectId,
          tool: "PINHOLE",
          sessionId: `;${Date.now()}`,
        },
        requests: [
          {
            dialog: safeDialog,
            voicePerformance: safePerformance,
            modelKey: "gemini_v4s_tts_flow",
            voiceConfigs: [
              {
                speaker: safeVoiceName,
                voice: safeBaseVoice,
              },
            ],
            generationType: "PREVIEW",
          },
        ],
      };

      const response = await makeApiRequestWithCaptcha(
        "https://aisandbox-pa.googleapis.com/v1/flow:batchGenerateAudio",
        body,
        slot.id,
        "IMAGE_GENERATION",
      );
      const data = response && response.data ? response.data : response;
      const media = data && Array.isArray(data.media) ? data.media[0] : null;
      if (!media || !media.name)
        throw new Error("Google Flow chưa trả về voice preview.");
      const downloaded = await downloadFlowAudioPreview(
        String(media.name),
        slot,
        projectId,
      );

      return {
        ...response,
        voice: {
          mediaId: String(media.name),
          name: safeVoiceName,
          description: safePerformance,
          sampleUrl: `data:${downloaded.mimeType};base64,${downloaded.buffer.toString("base64")}`,
          baseVoice: safeBaseVoice,
          custom: true,
          slotId: slot.id,
          projectId,
        },
      };
    },
  );

  // ── Edit Video / Remix ──────────────────────────────────────────────────────
  // Text-only → batchAsyncGenerateVideoText + abra_t2v_8s + useV2ModelConfig
  // With video input → batchAsyncGenerateVideoEditVideo + abra_edit
  ipcMain.handle(
    "generate-video-edit-video",
    async (
      _,
      {
        prompt,
        captchaToken,
        videoModelKey,
        aspectRatio,
        seed,
        videoInputMediaId,
        startFrameIndex,
        endFrameIndex,
        referenceImageMediaIds,
        referenceAudioMediaIds,
        slotId,
        duration,
      },
    ) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const sessionId = `;${Date.now()}`;
      const batchId = generateUUID();
      const ctx = {
        projectId,
        tool: "PINHOLE",
        userPaygateTier: requirePaygateTier(slot.userPaygateTier),
        sessionId,
        recaptchaContext: {
          token: captchaToken,
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
      };

      const hasVideoInput = !!videoInputMediaId;
      const refIds = Array.isArray(referenceImageMediaIds)
        ? referenceImageMediaIds.filter(Boolean)
        : [];
      const audioRefIds = Array.isArray(referenceAudioMediaIds)
        ? referenceAudioMediaIds.filter(Boolean)
        : [];
      const hasRefImages = refIds.length > 0;
      const hasRefAudio = audioRefIds.length > 0;

      const mode = hasVideoInput
        ? "editvideo"
        : hasRefImages || hasRefAudio
          ? "charsync"
          : "text";
      const effectiveModelKey = resolveVideoModelKey({
        mode,
        videoModelKey,
        duration,
        aspectRatio,
        userPaygateTier: slot.userPaygateTier,
      });

      let url;
      if (hasVideoInput) {
        url =
          "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoEditVideo";
      } else if (hasRefImages || hasRefAudio) {
        url =
          "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages";
      } else {
        url =
          "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
      }

      const request = {
        aspectRatio: aspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE",
        seed: seed || Math.floor(Math.random() * 1000000),
        textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
        videoModelKey: effectiveModelKey,
        metadata: {},
      };

      // Add video input if provided
      if (hasVideoInput) {
        request.videoInput = {
          mediaId: videoInputMediaId,
          startFrameIndex: startFrameIndex || 0,
          endFrameIndex: endFrameIndex > 0 ? endFrameIndex : 240,
        };
      }

      // Add reference images if provided (up to 5)
      if (hasRefImages) {
        request.referenceImages = refIds.map((mediaId) => ({
          mediaId,
          imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
        }));
      }
      if (hasRefAudio) {
        request.referenceAudio = audioRefIds.map((mediaId) => ({ mediaId }));
      }

      const body = {
        mediaGenerationContext: {
          batchId,
          audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
        },
        clientContext: ctx,
        requests: [request],
      };
      if (!hasVideoInput) body.useV2ModelConfig = true;

      const modeLabel = hasVideoInput
        ? "edit"
        : hasRefImages || hasRefAudio
          ? "references"
          : "text";
      console.log(
        `[SLOT-${slot.id}][API] Omni Flash: mode=${modeLabel}, model=${effectiveModelKey}, imageRefs=${refIds.length}, voiceRefs=${audioRefIds.length}`,
      );
      if (hasVideoInput)
        console.log(
          `[SLOT-${slot.id}][API] EditVideo videoInput:`,
          JSON.stringify(request.videoInput),
        );
      return makeApiRequestWithCaptcha(url, body, slot.id, "VIDEO_GENERATION");
    },
  );

  // Upload Omni Video (local file → mediaId). The direct request is preferred;
  // a short-lived same-origin BrowserWindow is used only when Google rejects it.
  // Upload video to Google via /fx/api/upload-video proxy (resumable chunked upload).
  // All 3 steps run inside webview executeJavaScript (same-origin, cookies automatic).
  // Chunk-by-chunk base64 transfer to avoid single massive string.
  // Last chunk uses "upload, finalize" (confirmed correct protocol).
  ipcMain.handle("upload-omni-video", async (_, { filePath, slotId = 0 }) => {
    const slot = getSlot(slotId);
    if (!slot?.bearerToken)
      throw new Error(`Slot ${slotId} chưa có Bearer token!`);
    const projectId = slot.projectId;
    if (!projectId)
      throw new Error(
        `Slot ${slotId} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
      );
    const pathMod = require("path");
    const os = require("os");
    const { execFile } = require("child_process");
    const { fileURLToPath } = require("url");

    if (!filePath || typeof filePath !== "string") {
      throw new Error("Đường dẫn file video không hợp lệ.");
    }

    // Windows-safe normalization: resolve file:// URL → absolute path and normalize
    let resolvedPath = filePath;
    try {
      if (
        typeof resolvedPath === "string" &&
        resolvedPath.startsWith("file://")
      ) {
        resolvedPath = fileURLToPath(resolvedPath);
      }
    } catch (_) {
      resolvedPath = resolvedPath.replace(/^file:[/\\]{2,3}/, "");
      resolvedPath = decodeURIComponent(resolvedPath);
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(resolvedPath)) {
        resolvedPath = resolvedPath.slice(1);
      }
    }
    if (resolvedPath.includes("%")) {
      try {
        resolvedPath = decodeURIComponent(resolvedPath);
      } catch {}
    }
    const normalizedPath = pathMod.normalize(resolvedPath);
    let realPath;
    try {
      realPath = await fs.promises.realpath(normalizedPath);
    } catch (error) {
      throw new Error(
        `Không thể xác minh đường dẫn file video: ${error.message}`,
      );
    }

    const stats = await fs.promises.stat(realPath);
    if (!stats.isFile()) {
      throw new Error(`Đường dẫn không phải là một file hợp lệ: ${realPath}`);
    }
    if (!hasLocalFileCapability(realPath)) {
      throw new Error(
        "File video chưa được người dùng cấp quyền qua hộp chọn file.",
      );
    }
    if (stats.size > MAX_VIDEO_FILE_SIZE_BYTES) {
      throw new Error(
        `Kích thước video (${(stats.size / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn cho phép (200MB).`,
      );
    }
    if (stats.size < 12) {
      throw new Error("File video quá nhỏ hoặc bị hỏng.");
    }

    const ext = pathMod.extname(realPath).toLowerCase();
    if (!ext || !ALLOWED_VIDEO_EXTS.has(ext)) {
      throw new Error(
        `Định dạng video không được hỗ trợ (${ext}). Chỉ chấp nhận: ${Array.from(ALLOWED_VIDEO_EXTS).join(", ")}.`,
      );
    }

    // Verify container magic bytes (read first 64KB header)
    const headerSize = Math.min(stats.size, 65536);
    const headerBuffer = Buffer.alloc(headerSize);
    const headerHandle = await fs.promises.open(realPath, "r");
    try {
      await headerHandle.read(headerBuffer, 0, headerSize, 0);
    } finally {
      await headerHandle.close();
    }

    if (!isValidVideoBuffer(headerBuffer)) {
      throw new Error(
        "Nội dung file không phải định dạng video hợp lệ (magic bytes / container signature không khớp).",
      );
    }

    const safeFileName = pathMod
      .basename(realPath)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const originalSize = stats.size;
    console.log(
      `[UPLOAD-VIDEO] Verified file: ${realPath}, size: ${(originalSize / 1024 / 1024).toFixed(2)}MB`,
    );

    // ── Pre-upload compression (match browser's ffmpeg.wasm behavior) ──
    // Browser re-encodes video to ~720p H.264 before upload.
    // We use the bundled ffmpeg-static to do the same.
    let uploadFilePath = realPath;
    let tempCompressedPath = null;
    const COMPRESS_THRESHOLD = 5 * 1024 * 1024; // Compress files > 5MB

    if (originalSize > COMPRESS_THRESHOLD) {
      try {
        const ffmpegBin = getFfmpegBin();
        tempCompressedPath = pathMod.join(
          os.tmpdir(),
          `upload-compressed-${Date.now()}-${Math.floor(Math.random() * 10000)}.mp4`,
        );
        console.log(
          `[UPLOAD-VIDEO] Compressing with FFmpeg → ${tempCompressedPath}`,
        );

        await new Promise((resolve, reject) => {
          const args = [
            "-i",
            realPath,
            "-t",
            "30", // Trim to 30s max (server rejects >30s)
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-b:v",
            "750k", // Target bitrate (matches browser ffmpeg.wasm output)
            "-maxrate",
            "1000k", // Peak bitrate cap
            "-bufsize",
            "1500k", // Rate control buffer
            "-vf",
            "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease", // Cap at 720p
            "-c:a",
            "aac",
            "-b:a",
            "96k", // Re-encode audio
            "-movflags",
            "+faststart", // Web-optimized MP4
            "-y", // Overwrite
            tempCompressedPath,
          ];
          const proc = execFile(ffmpegBin, args, { timeout: 120000 }, (err) => {
            if (err) {
              reject(new Error(`Nén video thất bại: ${err.message}`));
            } else {
              resolve();
            }
          });
          proc.stderr?.on("data", (d) => {
            const line = d.toString().trim();
            if (line.startsWith("frame=") || line.startsWith("size=")) {
              console.log(`[UPLOAD-VIDEO] FFmpeg: ${line.substring(0, 120)}`);
            }
          });
        });

        const compressedStats = await fs.promises.stat(tempCompressedPath);
        const compressedSize = compressedStats.size;
        if (compressedSize < 12) {
          throw new Error("File video sau khi nén rỗng hoặc bị hỏng.");
        }
        const compressedHeaderSize = Math.min(compressedSize, 65536);
        const compressedHeader = Buffer.alloc(compressedHeaderSize);
        const compressedHandle = await fs.promises.open(
          tempCompressedPath,
          "r",
        );
        try {
          await compressedHandle.read(
            compressedHeader,
            0,
            compressedHeaderSize,
            0,
          );
        } finally {
          await compressedHandle.close();
        }
        if (!isValidVideoBuffer(compressedHeader)) {
          throw new Error("File video sau khi nén không có container hợp lệ.");
        }
        const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        console.log(
          `[UPLOAD-VIDEO] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${ratio}% smaller)`,
        );
        uploadFilePath = tempCompressedPath;
      } catch (compressErr) {
        if (tempCompressedPath) {
          try {
            await fs.promises.unlink(tempCompressedPath);
          } catch (_) {}
        }
        // Fail closed: do NOT silently upload unvalidated/broken raw file
        throw new Error(
          `Xử lý và nén video đầu vào bằng FFmpeg thất bại: ${compressErr.message}`,
        );
      }
    } else {
      console.log(`[UPLOAD-VIDEO] File < 5MB, skipping compression`);
    }

    const uploadStats = await fs.promises.stat(uploadFilePath);
    const fileSizeBytes = uploadStats.size;
    console.log(
      `[UPLOAD-VIDEO] Upload size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`,
    );

    const slotSession = session.fromPartition(
      slot.partition || `persist:slot-${slot.id}`,
    );
    const cookies = await slotSession.cookies.get({ domain: "labs.google" });
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const MB = 1048576;
    const CHUNK_SIZE = 2 * MB; // 2MB per chunk (matches browser, 1MB-aligned)

    const fullChunks = Math.floor(fileSizeBytes / CHUNK_SIZE);
    const remainderSize = fileSizeBytes - fullChunks * CHUNK_SIZE;
    const totalChunks = fullChunks + (remainderSize > 0 ? 1 : 0);

    console.log(
      `[UPLOAD-VIDEO] Plan: ${totalChunks} chunks (${fullChunks} × 2MB + remainder ${remainderSize})`,
    );

    // Strategy 1: Direct net.request using slot session cookies (headless/background compatible)
    const doNetRequest = (options, bodyBuffer = null) => {
      return new Promise((resolve, reject) => {
        const req = net.request({
          ...options,
          session: slotSession,
        });
        req.setHeader("Accept", "*/*");
        req.setHeader("Origin", "https://labs.google");
        req.setHeader(
          "Referer",
          `https://labs.google/fx/tools/flow/project/${projectId}`,
        );
        req.setHeader("User-Agent", buildCleanUserAgent());
        if (cookieHeader) req.setHeader("Cookie", cookieHeader);
        if (options.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            req.setHeader(k, String(v));
          }
        }

        let responseData = Buffer.alloc(0);
        let settled = false;
        const finish = (err, res) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve(res);
        };

        req.on("response", (res) => {
          res.on("data", (chunk) => {
            responseData = Buffer.concat([responseData, chunk]);
          });
          res.on("end", () => {
            finish(null, {
              statusCode: res.statusCode,
              headers: res.headers,
              body: responseData.toString("utf8"),
            });
          });
        });
        req.on("error", (err) => finish(err));

        if (bodyBuffer) {
          req.write(bodyBuffer);
        }
        req.end();
      });
    };

    let sessionUrl = null;
    let netUploadError = null;

    try {
      console.log(
        `[UPLOAD-VIDEO-NET] Starting upload session for ${safeFileName}...`,
      );
      const startRes = await doNetRequest({
        method: "POST",
        url: "https://labs.google/fx/api/upload-video?action=start",
        headers: {
          "X-Upload-Content-Length": String(fileSizeBytes),
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-File-Name": safeFileName,
          "X-Upload-Project-Id": projectId,
        },
      });

      if (startRes.statusCode >= 200 && startRes.statusCode < 300) {
        const startData = JSON.parse(startRes.body);
        if (startData && startData.sessionUrl) {
          sessionUrl = startData.sessionUrl;
          console.log(
            `[UPLOAD-VIDEO-NET] Session started: ${sessionUrl.substring(0, 60)}`,
          );
        }
      } else {
        console.warn(
          `[UPLOAD-VIDEO-NET] Start returned HTTP ${startRes.statusCode}: ${startRes.body.substring(0, 200)}`,
        );
      }
    } catch (e) {
      netUploadError = e;
      console.warn(`[UPLOAD-VIDEO-NET] Direct net.request error:`, e.message);
    }

    if (sessionUrl) {
      let uploadHandle = null;
      try {
        uploadHandle = await fs.promises.open(uploadFilePath, "r");
        for (let i = 0; i < totalChunks; i++) {
          const offset = i * CHUNK_SIZE;
          const isLast = i === totalChunks - 1;
          const currentChunkSize = isLast ? fileSizeBytes - offset : CHUNK_SIZE;
          const chunkBuffer = Buffer.alloc(currentChunkSize);
          await uploadHandle.read(chunkBuffer, 0, currentChunkSize, offset);
          const command = isLast ? "upload, finalize" : "upload";

          console.log(
            `[UPLOAD-VIDEO-NET] Chunk ${i + 1}/${totalChunks}: offset=${offset}, size=${chunkBuffer.length}, cmd="${command}"`,
          );

          const chunkRes = await doNetRequest(
            {
              method: "PUT",
              url: "https://labs.google/fx/api/upload-video?action=upload",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Upload-Command": command,
                "X-Upload-File-Name": safeFileName,
                "X-Upload-Offset": String(offset),
                "X-Upload-Project-Id": projectId,
                "X-Upload-Session-Url": sessionUrl,
              },
            },
            chunkBuffer,
          );

          if (chunkRes.statusCode < 200 || chunkRes.statusCode >= 300) {
            throw new Error(
              `Tải chunk ${i + 1}/${totalChunks} thất bại (HTTP ${chunkRes.statusCode}): ${chunkRes.body}`,
            );
          }

          if (isLast) {
            let finalData;
            try {
              finalData = JSON.parse(chunkRes.body);
            } catch (e) {
              throw new Error(
                "Lỗi giải mã JSON phản hồi finalize: " + chunkRes.body,
              );
            }
            if (!finalData || !finalData.mediaServerId) {
              throw new Error(
                "Google không trả về mediaServerId: " + chunkRes.body,
              );
            }
            console.log(
              `[UPLOAD-VIDEO-NET] ✅ Upload hoàn tất: mediaServerId=${finalData.mediaServerId}, ${finalData.videoWidth}x${finalData.videoHeight}`,
            );
            return {
              mediaServerId: finalData.mediaServerId,
              workflowServerId: finalData.workflowServerId || null,
              videoWidth: finalData.videoWidth || 0,
              videoHeight: finalData.videoHeight || 0,
            };
          }
        }
      } finally {
        if (uploadHandle !== null) {
          try {
            await uploadHandle.close();
          } catch (_) {}
        }
        if (tempCompressedPath) {
          try {
            await fs.promises.unlink(tempCompressedPath);
            console.log(`[UPLOAD-VIDEO] Cleaned up temp compressed file`);
          } catch (_) {}
        }
      }
    }

    // Strategy 2: create a short-lived browser bridge with the selected slot's
    // isolated session. The upload endpoint requires a same-origin browser
    // context, but it does not require an Electron <webview>.
    let uploadBridgeWindow = null;
    const closeUploadBridge = () => {
      if (uploadBridgeWindow && !uploadBridgeWindow.isDestroyed()) {
        uploadBridgeWindow.close();
      }
    };
    const cleanUserAgent = slot.userAgent || buildCleanUserAgent();
    slotSession.setUserAgent?.(cleanUserAgent);
    uploadBridgeWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      title: `Google Flow upload — Slot ${slot.id + 1}`,
      webPreferences: {
        partition: slot.partition || `persist:slot-${slot.id}`,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    const wv = uploadBridgeWindow.webContents;
    wv.setUserAgent?.(cleanUserAgent);
    try {
      await wv.loadURL(
        `https://labs.google/fx/tools/flow/project/${encodeURIComponent(projectId)}`,
      );
    } catch (error) {
      closeUploadBridge();
      if (tempCompressedPath) {
        try {
          await fs.promises.unlink(tempCompressedPath);
        } catch (_) {}
      }
      throw new Error(
        `Không thể khởi tạo phiên tải video cho Slot ${slotId}: ${error.message}`,
      );
    }

    // ── Step 1 (same-origin BrowserWindow): Start upload session ──
    let startResult;
    try {
      startResult = await wv.executeJavaScript(`
    (async function() {
      try {
        const res = await fetch('/fx/api/upload-video?action=start', {
          method: 'POST',
          headers: {
            'X-Upload-Content-Length': '${fileSizeBytes}',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-File-Name': ${JSON.stringify(safeFileName)},
            'X-Upload-Project-Id': ${JSON.stringify(projectId)},
          },
        });
        if (!res.ok) {
          const text = await res.text();
          return { ok: false, error: 'Start failed: ' + res.status + ' — ' + text.substring(0, 200) };
        }
        const data = await res.json();
        if (!data.sessionUrl) return { ok: false, error: 'No sessionUrl' };
        window.__uploadSessionUrl = data.sessionUrl;
        console.log('[UPLOAD-VIDEO-WV] Session started:', data.sessionUrl.substring(0, 60));
        return { ok: true, sessionUrl: data.sessionUrl };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })()
  `);
    } catch (error) {
      closeUploadBridge();
      if (tempCompressedPath) {
        try {
          await fs.promises.unlink(tempCompressedPath);
        } catch (_) {}
      }
      throw new Error(`Không thể khởi tạo upload video: ${error.message}`);
    }

    if (!startResult?.ok) {
      closeUploadBridge();
      if (tempCompressedPath) {
        try {
          await fs.promises.unlink(tempCompressedPath);
        } catch (_) {}
      }
      throw new Error(
        startResult?.error || "Google Flow không trả về phiên upload video.",
      );
    }
    console.log(`[UPLOAD-VIDEO] Session started`);

    // ── Step 2 + 3: Upload chunks with chunk-by-chunk file reading to avoid reading entire file into memory ──
    let uploadHandle = null;
    try {
      uploadHandle = await fs.promises.open(uploadFilePath, "r");
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * CHUNK_SIZE;
        const isLast = i === totalChunks - 1;
        const currentChunkSize = isLast ? fileSizeBytes - offset : CHUNK_SIZE;
        const chunkBuffer = Buffer.alloc(currentChunkSize);
        await uploadHandle.read(chunkBuffer, 0, currentChunkSize, offset);
        const chunkB64 = chunkBuffer.toString("base64");
        const command = isLast ? "upload, finalize" : "upload";

        console.log(
          `[UPLOAD-VIDEO] Chunk ${i + 1}/${totalChunks}: offset=${offset}, size=${chunkBuffer.length}, cmd="${command}", b64=${(chunkB64.length / 1024 / 1024).toFixed(1)}MB`,
        );

        const chunkResult = await wv.executeJavaScript(`
        (async function() {
          try {
            const b64 = ${JSON.stringify(chunkB64)};
            const binaryStr = atob(b64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let j = 0; j < binaryStr.length; j++) bytes[j] = binaryStr.charCodeAt(j);
            const blob = new Blob([bytes], { type: 'application/octet-stream' });

            console.log('[UPLOAD-VIDEO-WV] Chunk ${i + 1}/${totalChunks}: decoded ' + bytes.length + ' bytes, cmd="${command}"');

            const res = await fetch('/fx/api/upload-video?action=upload', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Upload-Command': '${command}',
                'X-Upload-File-Name': ${JSON.stringify(safeFileName)},
                'X-Upload-Offset': '${offset}',
                'X-Upload-Project-Id': ${JSON.stringify(projectId)},
                'X-Upload-Session-Url': window.__uploadSessionUrl,
              },
              body: blob,
            });
            const txt = await res.text();
            console.log('[UPLOAD-VIDEO-WV] → ' + res.status + ': ' + txt.substring(0, 300));
            return { ok: res.ok, status: res.status, body: txt.substring(0, 1000) };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        })()
      `);

        if (!chunkResult.ok) {
          throw new Error(
            `Chunk ${i + 1} failed: ${chunkResult.status || ""} — ${chunkResult.body || chunkResult.error}`,
          );
        }
        console.log(
          `[UPLOAD-VIDEO] Chunk ${i + 1}/${totalChunks} → ${chunkResult.status}`,
        );

        // Last chunk (finalize) returns the mediaServerId
        if (isLast) {
          let finalData;
          try {
            finalData = JSON.parse(chunkResult.body);
          } catch (e) {
            throw new Error("Finalize parse error: " + chunkResult.body);
          }
          if (!finalData || !finalData.mediaServerId) {
            throw new Error("No mediaServerId: " + chunkResult.body);
          }
          console.log(
            `[UPLOAD-VIDEO] ✅ Upload complete: mediaServerId=${finalData.mediaServerId}, ${finalData.videoWidth}x${finalData.videoHeight}`,
          );
          return {
            mediaServerId: finalData.mediaServerId,
            workflowServerId: finalData.workflowServerId || null,
            videoWidth: finalData.videoWidth || 0,
            videoHeight: finalData.videoHeight || 0,
          };
        }
      }
    } finally {
      if (uploadHandle !== null) {
        try {
          await uploadHandle.close();
        } catch (_) {}
      }
      // Clean up temp compressed file
      if (tempCompressedPath) {
        try {
          await fs.promises.unlink(tempCompressedPath);
          console.log(`[UPLOAD-VIDEO] Cleaned up temp file`);
        } catch (_) {}
      }
      closeUploadBridge();
    }
  });

  // ── Poll Video Status ─────────────────────────────────────────────────
  ipcMain.handle(
    "poll-video-status",
    async (_, { mediaName, projectId: pid, slotId }) => {
      const slot = getSlot(slotId);
      if (!slot.bearerToken) throw new Error("Chưa có Bearer token!");
      if (pid && pid !== slot.projectId) {
        throw new Error(`Project ID không thuộc Slot ${slot.id}.`);
      }
      const projectId = slot.projectId;
      if (!projectId)
        throw new Error(
          `Slot ${slot.id} chưa có Project ID. Vui lòng mở phiên Flow cho slot này trước.`,
        );

      const body = { media: [{ name: mediaName, projectId }] };
      console.log(`[SLOT-${slot.id}][API] Polling video status: ${mediaName}`);
      const url =
        "https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus";
      return makeApiRequest(url, body, slot.id);
    },
  );

  // ── Download Media Image to Temp File ─────────────────────────────────────────
  // Download ảnh từ Google CDN/media API về temp file — dùng session cookies của slot
  // Trả về local temp path để re-upload với slot khác (per-slot ownership)
  ipcMain.handle(
    "download-media-to-temp",
    async (_, { mediaName, slotId = 0 }) => {
      const os = require("os");

      // Mirror _doDownloadVideo: the labs.google redirect endpoint authenticates via
      // the slot's SESSION COOKIE (not the Bearer token). Using ?input=JSON + Bearer
      // returns a 16-byte "No session found" body. We must use ?name= + Cookie header.
      // Dropping the Authorization header also avoids the double-Bearer poison entirely
      // (the redirect lands on a signed storage.googleapis.com URL that needs no auth).
      const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
      const partition = `persist:slot-${slotId}`;
      const slotSes = session.fromPartition(partition);

      // Lấy cookies của labs.google từ slot session
      let cookieHeader = "";
      try {
        const cookies = await slotSes.cookies.get({ domain: "labs.google" });
        cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        console.log(
          `[SLOT-${slotId}][TEMP-DL] Got ${cookies.length} cookies for labs.google`,
        );
      } catch (e) {
        console.warn(`[SLOT-${slotId}][TEMP-DL] Cookie get failed:`, e.message);
      }

      const buffer = await new Promise((resolve, reject) => {
        const chunks = [];
        let settled = false;
        const finish = (err, buf) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve(buf);
        };

        const request = net.request({ url: redirectUrl, session: slotSes });
        request.setHeader(
          "User-Agent",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        );
        request.setHeader("Origin", "https://labs.google");
        request.setHeader("Referer", "https://labs.google/");
        request.setHeader("Accept", "*/*");
        if (cookieHeader) request.setHeader("Cookie", cookieHeader);

        request.on("redirect", (statusCode, method, nextUrl) => {
          console.log(
            `[SLOT-${slotId}][TEMP-DL] Redirect ${statusCode} → ${String(nextUrl).substring(0, 80)}`,
          );
          request.followRedirect();
        });

        request.on("response", (res) => {
          console.log(
            `[SLOT-${slotId}][TEMP-DL] Response: ${res.statusCode}, content-type: ${res.headers["content-type"]}`,
          );
          if (res.statusCode !== 200) {
            finish(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => finish(null, Buffer.concat(chunks)));
          res.on("error", finish);
        });
        request.on("error", finish);
        const timer = setTimeout(
          () => finish(new Error("Download timeout 120s")),
          120000,
        );
        request.on("response", () => clearTimeout(timer));
        request.end();
      });

      if (!buffer || buffer.length === 0)
        throw new Error("Downloaded file is empty");
      const tmpPath = path.join(
        os.tmpdir(),
        `veo3-char-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
      );
      fs.writeFileSync(tmpPath, buffer);
      console.log(
        `[SLOT-${slotId}][TEMP-DL] Saved to: ${tmpPath} (${(buffer.length / 1024).toFixed(0)}KB)`,
      );
      return { path: tmpPath, size: buffer.length };
    },
  );

  // ── Resolve Video / Media URL (follow redirect using Electron session with SSRF protection) ────────
  ipcMain.handle("resolve-video-url", async (_, { url, slotId = 0 } = {}) => {
    const { net } = require("electron");

    if (typeof url !== "string" || !url.trim()) {
      throw new Error("URL không hợp lệ.");
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Định dạng URL không hợp lệ.");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("Chỉ chấp nhận giao thức HTTPS an toàn.");
    }

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

    if (!isAllowedHost(parsed.hostname)) {
      throw new Error(`Host không được phép truy cập: ${parsed.hostname}`);
    }

    const targetPartition = `persist:slot-${slotId ?? 0}`;
    return new Promise((resolve, reject) => {
      const req = net.request({
        url,
        method: "GET",
        partition: targetPartition,
        redirect: "manual",
      });

      req.on("redirect", (status, method, redirectUrl) => {
        console.log(
          `[MEDIA-SLOT-${slotId}] Redirect ${status} → ${redirectUrl.substring(0, 100)}...`,
        );
        try {
          const redirParsed = new URL(redirectUrl);
          if (redirParsed.protocol !== "https:") {
            return reject(new Error("Redirect protocol không an toàn."));
          }
          if (!isAllowedHost(redirParsed.hostname)) {
            return reject(
              new Error(
                `Redirect host không được phép: ${redirParsed.hostname}`,
              ),
            );
          }
          resolve(redirectUrl);
        } catch (err) {
          reject(err);
        }
      });

      req.on("response", (response) => {
        const loc = response.headers["location"];
        if (loc) {
          const locUrl = Array.isArray(loc) ? loc[0] : loc;
          try {
            const locParsed = new URL(locUrl, url);
            if (!isAllowedHost(locParsed.hostname)) {
              return reject(
                new Error(
                  `Location host không được phép: ${locParsed.hostname}`,
                ),
              );
            }
            console.log(
              `[MEDIA-SLOT-${slotId}] Location header → ${locParsed.toString().substring(0, 100)}...`,
            );
            resolve(locParsed.toString());
          } catch {
            resolve(locUrl);
          }
        } else {
          console.log(`[MEDIA-SLOT-${slotId}] No redirect, using original URL`);
          resolve(url);
        }
        response.on("data", () => {});
        response.on("end", () => {});
      });

      req.on("error", (err) => {
        console.error(`[MEDIA-SLOT-${slotId}] Resolve error:`, err);
        reject(err);
      });

      req.end();
    });
  });

  // Look up mediaName in download-map to find local file path (for thumbnail repair)
  ipcMain.handle("resolve-downloaded-video", async (_, mediaName) => {
    if (
      typeof mediaName !== "string" ||
      !mediaName.trim() ||
      mediaName.length > 2048
    )
      return null;
    const saveDir = getVideoOutputDir();
    const lookupFile = path.join(saveDir, ".download-map.json");
    try {
      const downloadMap = JSON.parse(
        await fs.promises.readFile(lookupFile, "utf-8"),
      );
      const localPath = downloadMap[mediaName];
      if (typeof localPath === "string") {
        await fs.promises.access(localPath);
        return pathToFileURL(localPath).toString();
      }
    } catch {}
    return null;
  });

  // ── Background Video Download Queue ─────────────────────────────────────────
  // Hoàn toàn tách biệt khỏi session slot — không block polling, không conflict
  const _videoDownloadQueue = []; // { mediaName, itemId }
  const MAX_VIDEO_DOWNLOAD_QUEUE = 100;
  const _activeVideoDownloadKeys = new Set();
  let _videoDownloadRunning = false;

  // Push job vào queue, trả về ngay — non-blocking
  ipcMain.handle("queue-video-download", async (_, payload = {}) => {
    const { mediaName, itemId } = payload;
    const slotId =
      Number.isInteger(payload.slotId) && payload.slotId >= 0
        ? payload.slotId
        : 0;
    if (
      typeof mediaName !== "string" ||
      !mediaName.trim() ||
      mediaName.length > 2048
    ) {
      throw new Error("Media name tải video không hợp lệ.");
    }
    if (typeof itemId !== "string" || !itemId.trim() || itemId.length > 512) {
      throw new Error("Item ID tải video không hợp lệ.");
    }
    const downloadKey = `${slotId}:${itemId}`;
    if (_activeVideoDownloadKeys.has(downloadKey))
      return { queued: true, duplicate: true };
    if (_videoDownloadQueue.length >= MAX_VIDEO_DOWNLOAD_QUEUE) {
      throw new Error(
        `Hàng đợi tải video đã đầy (tối đa ${MAX_VIDEO_DOWNLOAD_QUEUE} tác vụ).`,
      );
    }
    _activeVideoDownloadKeys.add(downloadKey);
    _videoDownloadQueue.push({
      mediaName: mediaName.trim(),
      itemId: itemId.trim(),
      slotId,
      downloadKey,
    });
    console.log(
      `[DL-QUEUE] Queued job ${itemId} slot=${slotId} (queue size: ${_videoDownloadQueue.length})`,
    );
    _processNextDownload(); // kick worker nếu chưa chạy
    return { queued: true };
  });

  // Backward compat: download-video vẫn hoạt động synchronously nếu cần
  ipcMain.handle("download-video", async (_, { mediaName, slotId = 0 }) => {
    return _doDownloadVideo(mediaName, slotId);
  });

  async function _processNextDownload() {
    if (_videoDownloadRunning) return;
    if (_videoDownloadQueue.length === 0) return;

    _videoDownloadRunning = true;
    console.log(
      `[DL-QUEUE] Worker started, ${_videoDownloadQueue.length} jobs in queue`,
    );

    // Chạy parallel 2 jobs cùng lúc để tránh job cuối phải chờ quá lâu
    const MAX_CONCURRENT = 2;
    const running = new Set();

    const runJob = async (job) => {
      const { mediaName, itemId, slotId, downloadKey } = job;
      console.log(
        `[DL-QUEUE] Processing job ${itemId} | slot=${slotId} | ${mediaName}`,
      );

      try {
        let localPath = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            localPath = await _doDownloadVideo(mediaName, slotId);
            break;
          } catch (err) {
            console.error(
              `[DL-QUEUE] Attempt ${attempt}/3 failed for ${itemId}:`,
              err.message,
            );
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 5000));
            }
          }
        }

        if (localPath) {
          console.log(`[DL-QUEUE] ✅ Job ${itemId} done: ${localPath}`);

          let thumbnailDataUrl = null;
          try {
            const { fileURLToPath: flu } = require("url");
            const resolvedPath = localPath.startsWith("file://")
              ? flu(localPath)
              : localPath;
            if (fs.existsSync(resolvedPath)) {
              const ffmpegBin = getFfmpegBin();
              const thumbArgs = [
                "-y",
                "-ss",
                "0.5",
                "-i",
                resolvedPath,
                "-frames:v",
                "1",
                "-q:v",
                "4",
                "-vf",
                "scale=320:-1",
                "-f",
                "mjpeg",
                "pipe:1",
              ];
              const thumbBuf = await new Promise((res, rej) => {
                const { execFile } = require("child_process");
                execFile(
                  ffmpegBin,
                  thumbArgs,
                  {
                    timeout: 15000,
                    encoding: "buffer",
                    maxBuffer: 2 * 1024 * 1024,
                  },
                  (err, stdout) => {
                    if (err) {
                      rej(err);
                    } else {
                      res(stdout);
                    }
                  },
                );
              });
              if (thumbBuf && thumbBuf.length > 0) {
                thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuf.toString("base64")}`;
                console.log(
                  `[DL-QUEUE] Thumbnail extracted for ${itemId} (${thumbBuf.length} bytes)`,
                );
              }
            }
          } catch (thumbErr) {
            console.warn(
              `[DL-QUEUE] Thumbnail extraction failed for ${itemId}:`,
              thumbErr.message,
            );
          }

          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
            runtime.mainWindow.webContents.send("video-downloaded", {
              itemId,
              localPath,
              thumbnailDataUrl,
            });
          }
        } else {
          console.error(`[DL-QUEUE] ❌ Job ${itemId} failed after 3 attempts`);
          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
            runtime.mainWindow.webContents.send("video-download-failed", {
              itemId,
              error: "Failed after 3 attempts",
            });
          }
        }
      } finally {
        _activeVideoDownloadKeys.delete(downloadKey);
        running.delete(job);
      }
    };

    while (_videoDownloadQueue.length > 0 || running.size > 0) {
      // Kick off up to MAX_CONCURRENT jobs
      while (_videoDownloadQueue.length > 0 && running.size < MAX_CONCURRENT) {
        const job = _videoDownloadQueue.shift();
        running.add(job);
        void runJob(job).catch((err) =>
          console.error(`[DL-QUEUE] Unexpected worker error:`, err),
        );
      }
      // Wait a bit before checking again
      await new Promise((r) => setTimeout(r, 500));
    }

    _videoDownloadRunning = false;
    console.log(`[DL-QUEUE] Worker done`);
  }

  async function _doDownloadVideo(mediaName, slotId = 0) {
    const saveDir = getVideoOutputDir();
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    // Dedup cache
    const lookupFile = path.join(saveDir, ".download-map.json");
    let downloadMap = {};
    try {
      downloadMap = JSON.parse(fs.readFileSync(lookupFile, "utf-8"));
    } catch {}
    if (downloadMap[mediaName] && fs.existsSync(downloadMap[mediaName])) {
      console.log(`[VIDEO] Cache hit: ${downloadMap[mediaName]}`);
      return pathToFileURL(downloadMap[mediaName]).toString();
    }

    const filename = getNextFilename(saveDir, "mp4");
    const filepath = path.join(saveDir, filename);
    const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
    console.log(
      `[VIDEO] Downloading: ${mediaName} → ${filename} (slot=${slotId})`,
    );

    // Dùng đúng session của slot đã generate video
    const partition = `persist:slot-${slotId}`;
    const slotSes = session.fromPartition(partition);

    // Lấy cookies của labs.google từ slot session
    let cookieHeader = "";
    try {
      const cookies = await slotSes.cookies.get({ domain: "labs.google" });
      cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      console.log(`[VIDEO] Got ${cookies.length} cookies for labs.google`);
    } catch (e) {
      console.warn(`[VIDEO] Cookie get failed:`, e.message);
    }

    await new Promise((resolve, reject) => {
      let fileStream = null;
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        try {
          if (fileStream) fileStream.close();
        } catch {}
        if (err) {
          try {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
          } catch {}
          reject(err);
        } else {
          resolve();
        }
      };

      const request = net.request({
        url: redirectUrl,
        session: slotSes, // session OBJECT thay vì partition string
      });

      // Browser-like headers để tránh 401
      request.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      );
      request.setHeader("Origin", "https://labs.google");
      request.setHeader("Referer", "https://labs.google/");
      request.setHeader("Accept", "*/*");
      if (cookieHeader) request.setHeader("Cookie", cookieHeader);

      request.on("redirect", (statusCode, method, redirectUrl, headers) => {
        console.log(
          `[VIDEO] Redirect ${statusCode} → ${redirectUrl.substring(0, 80)}`,
        );
        request.followRedirect();
      });

      request.on("response", (response) => {
        console.log(
          `[VIDEO] Response: ${response.statusCode}, content-type: ${response.headers["content-type"]}`,
        );
        if (response.statusCode !== 200) {
          finish(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        fileStream = fs.createWriteStream(filepath);
        let totalBytes = 0;
        response.on("data", (chunk) => {
          totalBytes += chunk.length;
          fileStream.write(chunk);
        });
        response.on("end", () => {
          fileStream.end(() => {
            console.log(
              `[VIDEO] Stream done: ${filepath} (${totalBytes} bytes)`,
            );
            finish(null);
          });
        });
        response.on("error", finish);
      });

      request.on("error", (err) => {
        console.error(`[VIDEO] net.request error:`, err.message);
        finish(err);
      });

      // Timeout 120s cho video lớn
      const timer = setTimeout(
        () => finish(new Error("Download timeout 120s")),
        120000,
      );
      request.on("response", () => clearTimeout(timer));

      request.end();
    });

    const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
    if (size === 0) throw new Error("Downloaded file is empty");
    console.log(`[VIDEO] ✅ Saved: ${filepath} (${size} bytes)`);
    _saveDownloadMap(lookupFile, mediaName, filepath);
    return pathToFileURL(filepath).toString();
  }

  function _saveDownloadMap(lookupFile, mediaName, filepath) {
    try {
      let map = {};
      try {
        map = JSON.parse(fs.readFileSync(lookupFile, "utf-8"));
      } catch {}
      map[mediaName] = filepath;
      fs.writeFileSync(lookupFile, JSON.stringify(map, null, 2));
    } catch {}
  }

  async function _downloadViaBrowserWindow(mediaName, filepath) {
    const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
    // Dùng SESSION_PARTITION (slot-0, có cookie Google) thay vì partition rỗng
    // Named listener để có thể removeListener sau khi xong → không tích lũy
    return new Promise((resolve, reject) => {
      let done = false;
      let willDownloadHandler = null;
      const finish = (err) => {
        if (done) return;
        done = true;
        // Cleanup listener trước khi close để tránh accumulation
        if (willDownloadHandler) {
          try {
            win.webContents.session.removeListener(
              "will-download",
              willDownloadHandler,
            );
          } catch {}
        }
        try {
          win.close();
        } catch {}
        if (err) reject(err);
        else resolve();
      };
      const win = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: { partition: SESSION_PARTITION }, // ← có Google cookies
      });
      willDownloadHandler = (event, item) => {
        item.setSavePath(filepath);
        item.once("done", (e, state) => {
          if (state === "completed") finish(null);
          else finish(new Error(`Download ${state}`));
        });
      };
      win.webContents.session.on("will-download", willDownloadHandler);
      win.webContents.on("did-navigate", (e, url) => {
        if (url.includes("storage.googleapis.com")) {
          try {
            win.close();
          } catch {}
          https
            .get(url, (res) => {
              if (res.statusCode !== 200) {
                finish(new Error(`GCS: ${res.statusCode}`));
                return;
              }
              const stream = fs.createWriteStream(filepath);
              res.pipe(stream);
              stream.on("finish", () => {
                stream.close();
                finish(null);
              });
              stream.on("error", finish);
            })
            .on("error", finish);
        }
      });
      setTimeout(
        () => finish(new Error("Fallback download timeout 60s")),
        60000,
      );
      win.loadURL(redirectUrl).catch(() => {});
    });
  }

  return {
    resolveVideoModelKey,
    isValidVideoBuffer,
    isValidImageBuffer,
    ALLOWED_VIDEO_EXTS,
    MAX_VIDEO_FILE_SIZE_BYTES,
    ALLOWED_IMAGE_EXTS,
    MAX_IMAGE_FILE_SIZE_BYTES,
  };
};

module.exports.resolveVideoModelKey = resolveVideoModelKey;
module.exports.isValidVideoBuffer = isValidVideoBuffer;
module.exports.isValidImageBuffer = isValidImageBuffer;
module.exports.ALLOWED_VIDEO_EXTS = ALLOWED_VIDEO_EXTS;
module.exports.MAX_VIDEO_FILE_SIZE_BYTES = MAX_VIDEO_FILE_SIZE_BYTES;
module.exports.ALLOWED_IMAGE_EXTS = ALLOWED_IMAGE_EXTS;
module.exports.MAX_IMAGE_FILE_SIZE_BYTES = MAX_IMAGE_FILE_SIZE_BYTES;
