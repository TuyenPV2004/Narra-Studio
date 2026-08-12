'use strict';

const runtimeEndpoints = require('../../config/runtime-endpoints.json');

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
    avisProvider,
    cloudflareImagesProvider,
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
    capturedAuth,
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
    findFlowWebview,
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    makeApiRequestViaWebview,
    setActiveWebviewSlot,
    getChromeRuntime,
    getAvisMediaRuntime,
  } = dependencies;

// ── Get Credits Balance ───────────────────────────────────────────────
ipcMain.handle('get-credits', async (_event, { slotId } = {}) => {
  const slot = getSlot(slotId ?? 0);
  if (!slot.bearerToken) return null;
  try {
    const googleFlowApiKey = String(process.env.GOOGLE_FLOW_API_KEY || '').trim();
    const url = new URL('https://aisandbox-pa.googleapis.com/v1/credits');
    if (googleFlowApiKey) url.searchParams.set('key', googleFlowApiKey);
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': '*/*',
        'authorization': slot.bearerToken,
        'origin': 'https://labs.google',
        'referer': 'https://labs.google/',
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();

    const tier = data.userPaygateTier || '';
    const sku = data.sku || '';
    const isUltra = sku === 'G1_TIER2' || sku === 'WS_ULTRA';

    return {
      credits: data.credits || 0,
      tier,
      sku,
      serviceTier: data.serviceTier || '',
      isUltra,
      slotId: slot.id,
    };
  } catch (err) {
    return null;
  }
});

// ── License Management ────────────────────────────────────────────────
// ── Machine fingerprint ──────────────────────────────────────────────

ipcMain.handle('generate-image', async (_, { prompt, captchaToken, model, aspectRatio, seed, projectId: pid, bearerToken: manualBt, count, referenceImageName, referenceImageNames, slotId }) => {
  const slot = getSlot(slotId);

  if (manualBt) {
    slot.bearerToken = manualBt.startsWith('Bearer ') ? manualBt : 'Bearer ' + manualBt;
  }

  const projectId = pid || slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) {
    throw new Error('Chưa có Bearer token! Vui lòng:\n1. Vào tab WebView → tương tác với Flow (tạo project, generate ảnh)\n2. Hoặc vào Cài đặt → nhập Bearer token thủ công');
  }

  const imageCount = Math.min(Math.max(count || 1, 1), 4);
  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();

  const placeholderCtx = {
    recaptchaContext: { token: captchaToken || '', applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
    projectId, tool: 'PINHOLE', sessionId,
  };

  // Build imageInputs — support multiple reference images
  let imageInputs = [];
  if (referenceImageNames && referenceImageNames.length > 0) {
    imageInputs = referenceImageNames.map(name => ({ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name }));
    console.log(`[SLOT-${slot.id}][API] Using ${referenceImageNames.length} reference images:`, referenceImageNames);
  } else if (referenceImageName) {
    imageInputs = [{ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: referenceImageName }];
    console.log(`[SLOT-${slot.id}][API] Using reference image: ${referenceImageName}`);
  }

  const requests = [];
  for (let i = 0; i < imageCount; i++) {
    requests.push({
      clientContext: placeholderCtx,
      imageModelName: model || 'GEM_PIX_2',
      imageAspectRatio: aspectRatio || 'IMAGE_ASPECT_RATIO_LANDSCAPE',
      structuredPrompt: { parts: [{ text: prompt }] },
      seed: seed ? (seed + i) : Math.floor(Math.random() * 1000000),
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
  console.log(`[SLOT-${slot.id}][API] Batch generate ${imageCount} image(s)`);

  const realCtx = {
    recaptchaContext: { token: captchaToken || '', applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
    projectId, tool: 'PINHOLE', sessionId,
  };
  body.clientContext = realCtx;
  body.requests.forEach(r => { r.clientContext = realCtx; });

  console.log(`[SLOT-${slot.id}][API] Getting fresh CAPTCHA via webview...`);
  return makeApiRequestViaWebview(url, body, slot.id);
});

// ── Edit Image (AI edit with base image) ─────────────────────────────

ipcMain.handle('edit-image', async (_, { prompt, captchaToken, baseMediaId, model, aspectRatio, seed }) => {
  const projectId = capturedAuth.projectId || DEFAULTS.projectId;
  if (!capturedAuth.bearerToken) {
    throw new Error('Chưa có Bearer token!');
  }

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const workflowId = generateUUID();
  const ctx = {
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
    projectId, tool: 'PINHOLE', workflowId, sessionId,
  };

  const body = {
    clientContext: ctx,
    mediaGenerationContext: { batchId },
    useNewMedia: true,
    requests: [{
      clientContext: ctx,
      imageModelName: model || 'GEM_PIX_2',
      imageAspectRatio: aspectRatio || 'IMAGE_ASPECT_RATIO_LANDSCAPE',
      structuredPrompt: { parts: [{ text: prompt }] },
      seed: seed || Math.floor(Math.random() * 1000000),
      imageInputs: [{ imageInputType: 'IMAGE_INPUT_TYPE_BASE_IMAGE', name: baseMediaId }],
    }],
  };

  console.log(`[API] Edit image with base: ${baseMediaId}, prompt: "${prompt}"`);
  const url = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages`;
  return makeApiRequestViaWebview(url, body);
});

// ── Upscale Image (1K / 2K / 4K) ─────────────────────────────────────
ipcMain.handle('upscale-image', async (_, { mediaId, captchaToken, targetResolution }) => {
  if (!capturedAuth.bearerToken) {
    throw new Error('Chưa có Bearer token!');
  }
  const projectId = capturedAuth.projectId || DEFAULTS.projectId;
  const sessionId = `;${Date.now()}`;

  const body = {
    mediaId,
    targetResolution, // 'UPSAMPLE_IMAGE_RESOLUTION_1K' | '2K' | '4K'
    clientContext: {
      recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
      projectId,
      tool: 'PINHOLE',
      userPaygateTier: 'PAYGATE_TIER_TWO',
      sessionId,
    },
  };

  console.log(`[API] Upscale image mediaId=${mediaId} resolution=${targetResolution}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage';
  return makeApiRequestViaWebview(url, body);
});

// ── Generate Pinhole GIF (270p animated GIF from video) ───────────────
ipcMain.handle('generate-pinhole-gif', async (_, { mediaId }) => {
  if (!capturedAuth.bearerToken) {
    throw new Error('Chưa có Bearer token!');
  }
  const body = {
    mediaGenerationId: mediaId,
    mediaId,
  };
  console.log(`[API] Generate Pinhole GIF mediaId=${mediaId}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:generatePinholeGif';
  return makeApiRequestViaWebview(url, body);
});

// ── Upscale Video (1080p / 4K) ────────────────────────────────────────
ipcMain.handle('upscale-video', async (_, { mediaId, captchaToken, resolution, aspectRatio }) => {
  if (!capturedAuth.bearerToken) throw new Error('Chưa có Bearer token!');
  const resMap = {
    '1080p': { res: 'VIDEO_RESOLUTION_1080P', modelKey: 'veo_3_1_upsampler_1080p' },
    '4k': { res: 'VIDEO_RESOLUTION_4K', modelKey: 'veo_3_1_upsampler_4k' },
  };
  const { res, modelKey } = resMap[resolution] || resMap['1080p'];
  const aspectVal = aspectRatio === 'portrait' ? 'VIDEO_ASPECT_RATIO_PORTRAIT' : 'VIDEO_ASPECT_RATIO_LANDSCAPE';
  const body = {
    mediaGenerationContext: { batchId: require('crypto').randomUUID() },
    clientContext: {
      projectId: capturedAuth.projectId || '',
      tool: 'PINHOLE',
      userPaygateTier: 'PAYGATE_TIER_TWO',
      sessionId: `;${Date.now()}`,
      recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
    },
    requests: [{
      resolution: res,
      aspectRatio: aspectVal,
      seed: Math.floor(Math.random() * 99999),
      videoModelKey: modelKey,
      metadata: { workflowId: require('crypto').randomUUID() },
      videoInput: { mediaId },
    }],
    useV2ModelConfig: true,
  };
  console.log(`[API] Upscale video ${resolution} mediaId=${mediaId}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo';
  return makeApiRequestViaWebview(url, body, 0, 'VIDEO_GENERATION');
});



// ── Transform Image (Crop, etc) ───────────────────────────────────────
ipcMain.handle('transform-image', async (_, { mediaId, cropCoordinates }) => {
  if (!capturedAuth.bearerToken) {
    throw new Error('Chưa có Bearer token!');
  }

  const body = {
    mediaId,
    isHidden: false,
    cropCoordinates,
    transformationType: "TRANSFORMATION_TYPE_CROP"
  };

  console.log(`[API] Transforming image: ${mediaId}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/flow:transformImage';
  return makeApiRequest(url, body);
});

// ── Upload Image ──────────────────────────────────────────────────────
ipcMain.handle('upload-image', async (_, { imageBytes, fileName, mimeType }) => {
  if (!capturedAuth.bearerToken) throw new Error('Chưa có Bearer token!');
  const projectId = capturedAuth.projectId || DEFAULTS.projectId;

  const body = {
    clientContext: {
      projectId,
      tool: 'PINHOLE',
    },
    fileName: fileName || 'image.jpg',
    imageBytes,
    isHidden: false,
    isUserUploaded: true,
    mimeType: mimeType || 'image/jpeg',
  };

  console.log(`[API] Upload image: ${fileName} (${(imageBytes.length * 0.75 / 1024).toFixed(0)}KB)`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/flow/uploadImage';
  return makeApiRequest(url, body);
});

// ── Upload Image from file path (avoid renderer memory) ───────────────
ipcMain.handle('upload-image-from-path', async (_, { filePath, fileName, mimeType, slotId = 0 }) => {
  const slot = getSlot(slotId);
  if (!slot?.bearerToken) throw new Error(`Chưa có Bearer token cho slot ${slotId}!`);
  const projectId = slot.projectId || capturedAuth.projectId || DEFAULTS.projectId;

  // Resolve file:// URL → absolute path (fix Windows C:\C:\ double drive + %20 encoding)
  const { fileURLToPath } = require('url');
  let resolvedPath = filePath;
  try {
    if (typeof resolvedPath === 'string' && resolvedPath.startsWith('file://')) {
      resolvedPath = fileURLToPath(resolvedPath);
    }
  } catch (urlErr) {
    // fallback: manual strip
    resolvedPath = resolvedPath.replace(/^file:[/\\]{2,3}/, '');
    resolvedPath = decodeURIComponent(resolvedPath);
    // On Windows, path may start with /C:/ → strip leading slash
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(resolvedPath)) {
      resolvedPath = resolvedPath.slice(1);
    }
  }
  // Also decode any remaining %20 etc from non-file:// paths
  if (resolvedPath.includes('%')) {
    try { resolvedPath = decodeURIComponent(resolvedPath); } catch {}
  }
  const normalizedPath = path.normalize(resolvedPath);
  console.log(`[UPLOAD] path: ${filePath} → ${normalizedPath}`);
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`File không tồn tại: ${normalizedPath}\n(Path gốc: ${filePath})\nHãy chọn lại ảnh.`);
  }

  // Read file in main process
  const buffer = fs.readFileSync(normalizedPath);
  const base64 = buffer.toString('base64');

  const body = {
    clientContext: { projectId, tool: 'PINHOLE' },
    fileName: fileName || path.basename(filePath),
    imageBytes: base64,
    isHidden: false,
    isUserUploaded: true,
    mimeType: mimeType || 'image/jpeg',
  };

  console.log(`[SLOT-${slotId}][API] Upload image from path: ${fileName} (${(buffer.length / 1024).toFixed(0)}KB)`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/flow/uploadImage';
  return makeApiRequest(url, body, slotId);
});

// ── Upload Image via Webview (có reCAPTCHA, trả về CDN URL) ──────────
ipcMain.handle('upload-image-via-webview', async (_, { filePath, imageBytes, fileName, mimeType }) => {
  if (!capturedAuth.bearerToken) throw new Error('Chưa có Bearer token!');
  const projectId = capturedAuth.projectId || DEFAULTS.projectId;

  let base64 = imageBytes;
  if (filePath && !base64) {
    const buffer = fs.readFileSync(filePath);
    base64 = buffer.toString('base64');
  }

  const body = {
    clientContext: { projectId, tool: 'PINHOLE' },
    fileName: fileName || (filePath ? path.basename(filePath) : 'image.jpg'),
    imageBytes: base64,
    isHidden: false,
    isUserUploaded: true,
    mimeType: mimeType || 'image/jpeg',
  };

  console.log(`[API-WEBVIEW] Upload image via webview: ${body.fileName}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/flow/uploadImage';
  return makeApiRequestViaWebview(url, body);
});

// ── Generate Video (legacy — used by VideoPage) ──────────────────────
ipcMain.handle('generate-video', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, projectId: pid, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = pid || slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) {
    throw new Error('Chưa có Bearer token! Vào tab WebView → tương tác với Flow trước.');
  }

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId,
    tool: 'PINHOLE',
    userPaygateTier: 'PAYGATE_TIER_TWO',
    sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const body = {
    mediaGenerationContext: { batchId },
    clientContext: ctx,
    requests: [{
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      seed: seed || Math.floor(Math.random() * 1000000),
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModelKey || 'veo_3_1_t2v_lite_low_priority',
      metadata: {},
    }],
    useV2ModelConfig: true,
  };

  console.log(`[SLOT-${slot.id}][API] Async video generate with model: ${videoModelKey}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// ── Generate Video (Text to Video) ────────────────────────────────────
ipcMain.handle('generate-video-text', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId,
    tool: 'PINHOLE',
    userPaygateTier: 'PAYGATE_TIER_TWO',
    sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const body = {
    mediaGenerationContext: { batchId },
    clientContext: ctx,
    requests: [{
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      seed: seed || Math.floor(Math.random() * 1000000),
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModelKey || 'veo_3_1_t2v_lite_low_priority',
      metadata: {},
    }],
    useV2ModelConfig: true,
  };

  console.log(`[SLOT-${slot.id}][API] Async video generate with model: ${videoModelKey}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// ── Generate Video from Start Image (Image-to-Video) ──────────────────
ipcMain.handle('generate-video-start-image', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, mediaId, cropCoordinates, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId, tool: 'PINHOLE', userPaygateTier: 'PAYGATE_TIER_TWO', sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const body = {
    mediaGenerationContext: { batchId },
    clientContext: ctx,
    requests: [{
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      seed: seed || Math.floor(Math.random() * 1000000),
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModelKey || 'veo_3_1_i2v_lite_low_priority',
      metadata: {},
      startImage: cropCoordinates ? { mediaId, cropCoordinates } : { mediaId },
    }],
    useV2ModelConfig: true,
  };

  console.log(`[SLOT-${slot.id}][API] Async video from start image: model=${videoModelKey}, mediaId=${mediaId}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage';
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// ── Generate Video from Start + End Image ─────────────────────────────
ipcMain.handle('generate-video-start-end-image', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, startMediaId, endMediaId, startCrop, endCrop, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId, tool: 'PINHOLE', userPaygateTier: 'PAYGATE_TIER_TWO', sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const body = {
    mediaGenerationContext: { batchId },
    clientContext: ctx,
    requests: [{
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      seed: seed || Math.floor(Math.random() * 1000000),
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModelKey || 'veo_3_1_interpolation_lite_low_priority',
      metadata: {},
      startImage: startCrop ? { mediaId: startMediaId, cropCoordinates: startCrop } : { mediaId: startMediaId },
      endImage: endCrop ? { mediaId: endMediaId, cropCoordinates: endCrop } : { mediaId: endMediaId },
    }],
    useV2ModelConfig: true,
  };

  console.log(`[SLOT-${slot.id}][API] Async video start+end: model=${videoModelKey}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage';
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// ── Generate Video with Reference Images (Character Sync) ─────────────
ipcMain.handle('generate-video-reference-images', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, referenceMediaIds, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId, tool: 'PINHOLE', userPaygateTier: 'PAYGATE_TIER_TWO', sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const referenceImages = (referenceMediaIds || []).map(mediaId => ({
    mediaId,
    imageUsageType: 'IMAGE_USAGE_TYPE_ASSET',
  }));

  const body = {
    mediaGenerationContext: { batchId },
    clientContext: ctx,
    requests: [{
      aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
      seed: seed || Math.floor(Math.random() * 1000000),
      textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
      videoModelKey: videoModelKey || 'veo_3_1_r2v_lite_low_priority',
      metadata: {},
      referenceImages,
    }],
    useV2ModelConfig: true,
  };

  console.log(`[SLOT-${slot.id}][API] Async video reference images: model=${videoModelKey}, refs=${referenceMediaIds?.length || 0}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages';
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// Download a generated Flow audio preview through the authenticated account
// partition. The redirect endpoint authenticates with the labs.google session
// cookie, while the signed CDN URL it returns needs no Bearer token.
async function downloadFlowAudioPreview(mediaName, slot, projectId) {
  const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaName)}`;
  const slotSession = session.fromPartition(slot.partition || `persist:slot-${slot.id}`);
  const cookies = await slotSession.cookies.get({ domain: 'labs.google' });
  const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

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
    request.setHeader('Accept', '*/*');
    request.setHeader('Origin', 'https://labs.google');
    request.setHeader('Referer', `https://labs.google/fx/tools/flow/project/${projectId}`);
    request.setHeader('User-Agent', buildCleanUserAgent());
    if (cookieHeader) request.setHeader('Cookie', cookieHeader);

    request.on('redirect', (statusCode, method, nextUrl) => {
      console.log(`[SLOT-${slot.id}][VOICE-PREVIEW] Redirect ${statusCode} → ${String(nextUrl).substring(0, 90)}`);
      request.followRedirect();
    });
    request.on('response', response => {
      const rawContentType = response.headers['content-type'];
      const contentType = String(Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || 'audio/wav').split(';')[0];
      if (response.statusCode !== 200) {
        response.on('data', () => {});
        finish(new Error(`Không thể tải voice preview (HTTP ${response.statusCode}).`));
        return;
      }
      response.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > 25 * 1024 * 1024) {
          request.abort();
          finish(new Error('Voice preview vượt quá giới hạn 25MB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) {
          finish(new Error('Voice preview tải về rỗng.'));
          return;
        }
        const mimeType = contentType.startsWith('audio/') ? contentType : 'audio/wav';
        console.log(`[SLOT-${slot.id}][VOICE-PREVIEW] Downloaded ${mediaName} (${buffer.length} bytes, ${mimeType})`);
        finish(null, { buffer, mimeType });
      });
      response.on('error', finish);
    });
    request.on('error', finish);
    timer = setTimeout(() => finish(new Error('Tải voice preview quá thời gian.')), 60000);
    request.end();
  });
}

// ── Omni Flash custom Voice preview ─────────────────────────────────────────
ipcMain.handle('generate-flow-voice-preview', async (_, {
  dialog,
  voicePerformance,
  voiceName,
  baseVoice,
  slotId = 0,
} = {}) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || capturedAuth.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const safeDialog = String(dialog || '').trim().slice(0, 120);
  const safePerformance = String(voicePerformance || '').trim().slice(0, 500);
  const safeVoiceName = String(voiceName || '').trim().slice(0, 80);
  const safeBaseVoice = String(baseVoice || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80);
  if (!safeDialog) throw new Error('Hãy nhập câu thoại mẫu.');
  if (!safeVoiceName) throw new Error('Hãy nhập tên voice.');
  if (!safeBaseVoice) throw new Error('Hãy chọn voice gốc.');

  const body = {
    clientContext: {
      recaptchaContext: {
        token: '',
        applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
      },
      projectId,
      tool: 'PINHOLE',
      sessionId: `;${Date.now()}`,
    },
    requests: [{
      dialog: safeDialog,
      voicePerformance: safePerformance,
      modelKey: 'gemini_v4s_tts_flow',
      voiceConfigs: [{
        speaker: safeVoiceName,
        voice: safeBaseVoice,
      }],
      generationType: 'PREVIEW',
    }],
  };

  const response = await makeApiRequestViaWebview(
    'https://aisandbox-pa.googleapis.com/v1/flow:batchGenerateAudio',
    body,
    slot.id,
    'AUDIO_GENERATION',
  );
  const data = response && response.data ? response.data : response;
  const media = data && Array.isArray(data.media) ? data.media[0] : null;
  if (!media || !media.name) throw new Error('Google Flow chưa trả về voice preview.');
  const downloaded = await downloadFlowAudioPreview(String(media.name), slot, projectId);

  return {
    ...response,
    voice: {
      mediaId: String(media.name),
      name: safeVoiceName,
      description: safePerformance,
      sampleUrl: `data:${downloaded.mimeType};base64,${downloaded.buffer.toString('base64')}`,
      baseVoice: safeBaseVoice,
      custom: true,
      slotId: slot.id,
      projectId,
    },
  };
});

// ── Edit Video / Remix ──────────────────────────────────────────────────────
// Text-only → batchAsyncGenerateVideoText + abra_t2v_8s + useV2ModelConfig
// With video input → batchAsyncGenerateVideoEditVideo + abra_edit
ipcMain.handle('generate-video-edit-video', async (_, { prompt, captchaToken, videoModelKey, aspectRatio, seed, videoInputMediaId, startFrameIndex, endFrameIndex, referenceImageMediaIds, referenceAudioMediaIds, slotId, duration }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const sessionId = `;${Date.now()}`;
  const batchId = generateUUID();
  const ctx = {
    projectId, tool: 'PINHOLE', userPaygateTier: 'PAYGATE_TIER_TWO', sessionId,
    recaptchaContext: { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
  };

  const hasVideoInput = !!videoInputMediaId;
  const refIds = Array.isArray(referenceImageMediaIds) ? referenceImageMediaIds.filter(Boolean) : [];
  const audioRefIds = Array.isArray(referenceAudioMediaIds) ? referenceAudioMediaIds.filter(Boolean) : [];
  const hasRefImages = refIds.length > 0;
  const hasRefAudio = audioRefIds.length > 0;

  // 3 modes: video+edit, ref-images-only, text-only
  // duration: '4s' | '6s' | '8s' | '10s' — default 8s
  const durSuffix = duration && duration !== '8s' ? duration : '8s';
  let modelKey, url;
  if (hasVideoInput) {
    modelKey = videoModelKey || 'abra_edit';
    url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoEditVideo';
  } else if (hasRefImages || hasRefAudio) {
    modelKey = videoModelKey || `abra_r2v_${durSuffix}`;
    url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages';
  } else {
    modelKey = videoModelKey || `abra_t2v_${durSuffix}`;
    url = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
  }

  const request = {
    aspectRatio: aspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    seed: seed || Math.floor(Math.random() * 1000000),
    textInput: { structuredPrompt: { parts: [{ text: prompt }] } },
    videoModelKey: modelKey,
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
    request.referenceImages = refIds.map(mediaId => ({
      mediaId,
      imageUsageType: 'IMAGE_USAGE_TYPE_ASSET',
    }));
  }
  if (hasRefAudio) {
    request.referenceAudio = audioRefIds.map(mediaId => ({ mediaId }));
  }

  const body = {
    mediaGenerationContext: { batchId, audioFailurePreference: 'BLOCK_SILENCED_VIDEOS' },
    clientContext: ctx,
    requests: [request],
  };
  if (!hasVideoInput) body.useV2ModelConfig = true;

  const modeLabel = hasVideoInput ? 'edit' : (hasRefImages || hasRefAudio) ? 'references' : 'text';
  console.log(`[SLOT-${slot.id}][API] Omni Flash: mode=${modeLabel}, model=${modelKey}, imageRefs=${refIds.length}, voiceRefs=${audioRefIds.length}`);
  if (hasVideoInput) console.log(`[SLOT-${slot.id}][API] EditVideo videoInput:`, JSON.stringify(request.videoInput));
  return makeApiRequestViaWebview(url, body, slot.id, 'VIDEO_GENERATION');
});

// ── Upload Omni Video (local file → mediaId) ─────────────────────────
// Strategy: execute the upload INSIDE the webview via executeJavaScript.
// All Node.js-based approaches (net.request, https.request) fail with 500
// ── Debug: intercept browser's own upload-video fetch calls ──
ipcMain.handle('spy-upload', async (_, { slotId = 0 }) => {
  const wv = findFlowWebview(slotId);
  if (!wv) throw new Error('WebView not found');

  console.log('[SPY-UPLOAD] Injecting fetch interceptor into webview...');
  await wv.executeJavaScript(`
    (function() {
      if (window.__uploadSpyActive) { console.log('[SPY] Already active'); return; }
      window.__uploadSpyActive = true;
      window.__uploadSpyLogs = [];
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const [url, opts] = args;
        const urlStr = typeof url === 'string' ? url : url.url;

        // Only intercept upload-video calls
        if (urlStr && urlStr.includes('upload-video')) {
          const method = (opts && opts.method) || 'GET';
          const headers = {};
          if (opts && opts.headers) {
            if (opts.headers instanceof Headers) {
              opts.headers.forEach((v, k) => { headers[k] = v; });
            } else {
              Object.assign(headers, opts.headers);
            }
          }

          // Get body size
          let bodySize = 0;
          if (opts && opts.body) {
            if (opts.body instanceof Blob) bodySize = opts.body.size;
            else if (opts.body instanceof ArrayBuffer) bodySize = opts.body.byteLength;
            else if (opts.body instanceof Uint8Array) bodySize = opts.body.byteLength;
            else if (typeof opts.body === 'string') bodySize = opts.body.length;
            else bodySize = -1;
          }

          const entry = {
            ts: new Date().toISOString(),
            method,
            url: urlStr.substring(0, 120),
            headers,
            bodySize,
          };

          console.log('[SPY-UPLOAD] >>>', method, urlStr.substring(0, 80),
            'cmd=' + (headers['X-Upload-Command'] || headers['x-upload-command'] || '?'),
            'offset=' + (headers['X-Upload-Offset'] || headers['x-upload-offset'] || '?'),
            'bodySize=' + bodySize);

          const res = await origFetch.apply(this, args);

          // Clone response to read body without consuming
          const clone = res.clone();
          let resBody = '';
          try { resBody = await clone.text(); } catch(e) { resBody = '[read error]'; }

          // Log response headers
          const resHeaders = {};
          res.headers.forEach((v, k) => { resHeaders[k] = v; });

          entry.status = res.status;
          entry.resHeaders = resHeaders;
          entry.resBody = resBody.substring(0, 500);
          window.__uploadSpyLogs.push(entry);

          console.log('[SPY-UPLOAD] <<<', res.status, resBody.substring(0, 300));

          return res;
        }

        return origFetch.apply(this, args);
      };
      console.log('[SPY] ✅ Fetch interceptor installed. Now upload a video via browser UI.');
    })()
  `);

  console.log('[SPY-UPLOAD] ✅ Interceptor installed. Upload a video via labs.google UI, then call get-spy-logs.');
  return { ok: true, message: 'Interceptor installed. Upload video via browser UI now.' };
});

// ── Retrieve captured spy logs ──
ipcMain.handle('get-spy-logs', async (_, { slotId = 0 }) => {
  const wv = findFlowWebview(slotId);
  if (!wv) throw new Error('WebView not found');

  const logs = await wv.executeJavaScript(`JSON.parse(JSON.stringify(window.__uploadSpyLogs || []))`);
  console.log('[SPY-UPLOAD] Collected logs:', JSON.stringify(logs, null, 2));
  return logs;
});

// on finalize — the browser's native fetch in the webview context works
// Upload video to Google via /fx/api/upload-video proxy (resumable chunked upload).
// All 3 steps run inside webview executeJavaScript (same-origin, cookies automatic).
// Chunk-by-chunk base64 transfer to avoid single massive string.
// Last chunk uses "upload, finalize" (confirmed correct protocol).
ipcMain.handle('upload-omni-video', async (_, { filePath, slotId = 0 }) => {
  const slot = getSlot(slotId);
  const projectId = slot.projectId || DEFAULTS.projectId;
  const pathMod = require('path');
  const os = require('os');
  const { execFile } = require('child_process');

  // Windows-safe normalization: renderer may pass a stray file:// prefix or a
  // leading slash before the drive letter (file:///C:/… → /C:/…). On Windows fs
  // resolves /C:/… against the current drive root → C:\C:\… (ENOENT). Strip both.
  if (typeof filePath === 'string') {
    filePath = filePath
      .replace(/^file:[/\\]{2,3}/, '')
      .replace(/^\/([A-Za-z]:)/, '$1');
  }
  const fileName = pathMod.basename(filePath);

  const originalSize = fs.statSync(filePath).size;
  console.log(`[UPLOAD-VIDEO] File: ${filePath}, size: ${(originalSize / 1024 / 1024).toFixed(2)}MB`);

  // ── Pre-upload compression (match browser's ffmpeg.wasm behavior) ──
  // Browser re-encodes video to ~720p H.264 before upload.
  // We use the bundled ffmpeg-static to do the same.
  let uploadFilePath = filePath;
  let tempCompressedPath = null;
  const COMPRESS_THRESHOLD = 5 * 1024 * 1024; // Only compress files > 5MB

  if (originalSize > COMPRESS_THRESHOLD) {
    try {
      const ffmpegBin = getFfmpegBin();
      tempCompressedPath = pathMod.join(os.tmpdir(), `upload-compressed-${Date.now()}.mp4`);
      console.log(`[UPLOAD-VIDEO] Compressing with FFmpeg → ${tempCompressedPath}`);

      await new Promise((resolve, reject) => {
        const args = [
          '-i', filePath,
          '-t', '30',                      // Trim to 30s max (server rejects >30s)
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-b:v', '750k',                  // Target bitrate (matches browser ffmpeg.wasm output)
          '-maxrate', '1000k',             // Peak bitrate cap
          '-bufsize', '1500k',             // Rate control buffer
          '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",  // Cap at 720p
          '-c:a', 'aac', '-b:a', '96k',   // Re-encode audio
          '-movflags', '+faststart',       // Web-optimized MP4
          '-y',                            // Overwrite
          tempCompressedPath,
        ];
        const proc = execFile(ffmpegBin, args, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) {
            console.error(`[UPLOAD-VIDEO] FFmpeg compress failed:`, err.message);
            reject(err);
          } else {
            resolve();
          }
        });
        proc.stderr?.on('data', d => {
          const line = d.toString().trim();
          if (line.startsWith('frame=') || line.startsWith('size=')) {
            console.log(`[UPLOAD-VIDEO] FFmpeg: ${line.substring(0, 120)}`);
          }
        });
      });

      const compressedSize = fs.statSync(tempCompressedPath).size;
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      console.log(`[UPLOAD-VIDEO] Compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${ratio}% smaller)`);
      uploadFilePath = tempCompressedPath;
    } catch (compressErr) {
      console.warn(`[UPLOAD-VIDEO] Compression failed, uploading original: ${compressErr.message}`);
      // Fall back to original file
      if (tempCompressedPath && fs.existsSync(tempCompressedPath)) {
        try { fs.unlinkSync(tempCompressedPath); } catch (_) {}
      }
      tempCompressedPath = null;
    }
  } else {
    console.log(`[UPLOAD-VIDEO] File < 5MB, skipping compression`);
  }

  const videoBuffer = fs.readFileSync(uploadFilePath);
  const fileSizeBytes = videoBuffer.length;
  console.log(`[UPLOAD-VIDEO] Upload size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`);

  const wv = findFlowWebview(slotId);
  if (!wv) throw new Error('WebView not found — hãy mở tab WebView trước');

  const MB = 1048576;
  const CHUNK_SIZE = 2 * MB; // 2MB per chunk (matches browser, 1MB-aligned)

  const fullChunks = Math.floor(fileSizeBytes / CHUNK_SIZE);
  const remainderSize = fileSizeBytes - (fullChunks * CHUNK_SIZE);
  const totalChunks = fullChunks + (remainderSize > 0 ? 1 : 0);

  console.log(`[UPLOAD-VIDEO] Plan: ${totalChunks} chunks (${fullChunks} × 2MB + remainder ${remainderSize})`);

  // ── Step 1: Start upload session ──
  const startResult = await wv.executeJavaScript(`
    (async function() {
      try {
        const res = await fetch('/fx/api/upload-video?action=start', {
          method: 'POST',
          headers: {
            'X-Upload-Content-Length': '${fileSizeBytes}',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-File-Name': ${JSON.stringify(fileName)},
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

  if (!startResult.ok) {
    if (tempCompressedPath && fs.existsSync(tempCompressedPath)) { try { fs.unlinkSync(tempCompressedPath); } catch (_) {} }
    throw new Error(startResult.error);
  }
  console.log(`[UPLOAD-VIDEO] Session started`);

  // ── Step 2 + 3: Upload chunks, last chunk = "upload, finalize" ──
  try {
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * CHUNK_SIZE;
      const isLast = (i === totalChunks - 1);
      const chunkEnd = isLast ? fileSizeBytes : offset + CHUNK_SIZE;
      const chunkBuffer = videoBuffer.slice(offset, chunkEnd);
      const chunkB64 = chunkBuffer.toString('base64');
      const command = isLast ? 'upload, finalize' : 'upload';

      console.log(`[UPLOAD-VIDEO] Chunk ${i + 1}/${totalChunks}: offset=${offset}, size=${chunkBuffer.length}, cmd="${command}", b64=${(chunkB64.length / 1024 / 1024).toFixed(1)}MB`);

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
                'X-Upload-File-Name': ${JSON.stringify(fileName)},
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
        throw new Error(`Chunk ${i + 1} failed: ${chunkResult.status || ''} — ${chunkResult.body || chunkResult.error}`);
      }
      console.log(`[UPLOAD-VIDEO] Chunk ${i + 1}/${totalChunks} → ${chunkResult.status}`);

      // Last chunk (finalize) returns the mediaServerId
      if (isLast) {
        let finalData;
        try { finalData = JSON.parse(chunkResult.body); } catch (e) {
          throw new Error('Finalize parse error: ' + chunkResult.body);
        }
        if (!finalData || !finalData.mediaServerId) {
          throw new Error('No mediaServerId: ' + chunkResult.body);
        }
        console.log(`[UPLOAD-VIDEO] ✅ Upload complete: mediaServerId=${finalData.mediaServerId}, ${finalData.videoWidth}x${finalData.videoHeight}`);
        return {
          mediaServerId: finalData.mediaServerId,
          workflowServerId: finalData.workflowServerId || null,
          videoWidth: finalData.videoWidth || 0,
          videoHeight: finalData.videoHeight || 0,
        };
      }
    }
  } finally {
    // Clean up temp compressed file
    if (tempCompressedPath && fs.existsSync(tempCompressedPath)) {
      try { fs.unlinkSync(tempCompressedPath); console.log(`[UPLOAD-VIDEO] Cleaned up temp file`); } catch (_) {}
    }
  }
});

// ── Poll Video Status ─────────────────────────────────────────────────
ipcMain.handle('poll-video-status', async (_, { mediaName, projectId: pid, slotId }) => {
  const slot = getSlot(slotId);
  const projectId = pid || slot.projectId || DEFAULTS.projectId;
  if (!slot.bearerToken) throw new Error('Chưa có Bearer token!');

  const body = { media: [{ name: mediaName, projectId }] };
  console.log(`[SLOT-${slot.id}][API] Polling video status: ${mediaName}`);
  const url = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
  return makeApiRequest(url, body, slot.id);
});

// ── Download Media Image to Temp File ─────────────────────────────────────────
// Download ảnh từ Google CDN/media API về temp file — dùng session cookies của slot
// Trả về local temp path để re-upload với slot khác (per-slot ownership)
ipcMain.handle('download-media-to-temp', async (_, { mediaName, slotId = 0 }) => {
  const os = require('os');

  // Mirror _doDownloadVideo: the labs.google redirect endpoint authenticates via
  // the slot's SESSION COOKIE (not the Bearer token). Using ?input=JSON + Bearer
  // returns a 16-byte "No session found" body. We must use ?name= + Cookie header.
  // Dropping the Authorization header also avoids the double-Bearer poison entirely
  // (the redirect lands on a signed storage.googleapis.com URL that needs no auth).
  const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
  const partition = `persist:slot-${slotId}`;
  const slotSes = session.fromPartition(partition);

  // Lấy cookies của labs.google từ slot session
  let cookieHeader = '';
  try {
    const cookies = await slotSes.cookies.get({ domain: 'labs.google' });
    cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log(`[SLOT-${slotId}][TEMP-DL] Got ${cookies.length} cookies for labs.google`);
  } catch (e) {
    console.warn(`[SLOT-${slotId}][TEMP-DL] Cookie get failed:`, e.message);
  }

  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(buf);
    };

    const request = net.request({ url: redirectUrl, session: slotSes });
    request.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    request.setHeader('Origin', 'https://labs.google');
    request.setHeader('Referer', 'https://labs.google/');
    request.setHeader('Accept', '*/*');
    if (cookieHeader) request.setHeader('Cookie', cookieHeader);

    request.on('redirect', (statusCode, method, nextUrl) => {
      console.log(`[SLOT-${slotId}][TEMP-DL] Redirect ${statusCode} → ${String(nextUrl).substring(0, 80)}`);
      request.followRedirect();
    });

    request.on('response', (res) => {
      console.log(`[SLOT-${slotId}][TEMP-DL] Response: ${res.statusCode}, content-type: ${res.headers['content-type']}`);
      if (res.statusCode !== 200) {
        finish(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', finish);
    });
    request.on('error', finish);
    const timer = setTimeout(() => finish(new Error('Download timeout 120s')), 120000);
    request.on('response', () => clearTimeout(timer));
    request.end();
  });

  if (!buffer || buffer.length === 0) throw new Error('Downloaded file is empty');
  const tmpPath = path.join(os.tmpdir(), `veo3-char-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  fs.writeFileSync(tmpPath, buffer);
  console.log(`[SLOT-${slotId}][TEMP-DL] Saved to: ${tmpPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
  return { path: tmpPath, size: buffer.length };
});

// ── Resolve Video URL (follow redirect using Electron session) ────────
ipcMain.handle('resolve-video-url', async (_, { url }) => {
  const { net } = require('electron');
  return new Promise((resolve, reject) => {
    const req = net.request({
      url,
      method: 'GET',
      partition: SESSION_PARTITION,
      redirect: 'manual',
    });

    req.on('redirect', (status, method, redirectUrl) => {
      console.log(`[VIDEO] Redirect ${status} → ${redirectUrl.substring(0, 100)}...`);
      resolve(redirectUrl);
    });

    req.on('response', (response) => {
      // If no redirect, check location header
      const loc = response.headers['location'];
      if (loc) {
        const locUrl = Array.isArray(loc) ? loc[0] : loc;
        console.log(`[VIDEO] Location header → ${locUrl.substring(0, 100)}...`);
        resolve(locUrl);
      } else {
        // No redirect — use original URL
        console.log('[VIDEO] No redirect, using original URL');
        resolve(url);
      }
      response.on('data', () => { }); // drain
      response.on('end', () => { });
    });

    req.on('error', (err) => {
      console.error('[VIDEO] Resolve error:', err);
      reject(err);
    });

    req.end();
  });
});

// Look up mediaName in download-map to find local file path (for thumbnail repair)
ipcMain.handle('resolve-downloaded-video', async (_, mediaName) => {
  const saveDir = getVideoOutputDir();
  const lookupFile = path.join(saveDir, '.download-map.json');
  try {
    const downloadMap = JSON.parse(fs.readFileSync(lookupFile, 'utf-8'));
    const localPath = downloadMap[mediaName];
    if (localPath && fs.existsSync(localPath)) {
      return pathToFileURL(localPath).toString();
    }
  } catch { }
  return null;
});

// ── Background Video Download Queue ─────────────────────────────────────────
// Hoàn toàn tách biệt khỏi session slot — không block polling, không conflict
const _videoDownloadQueue = []; // { mediaName, itemId }
let _videoDownloadRunning = false;

// Push job vào queue, trả về ngay — non-blocking
ipcMain.handle('queue-video-download', async (_, { mediaName, itemId, slotId }) => {
  _videoDownloadQueue.push({ mediaName, itemId, slotId: slotId ?? 0 });
  console.log(`[DL-QUEUE] Queued job ${itemId} slot=${slotId ?? 0} (queue size: ${_videoDownloadQueue.length})`);
  _processNextDownload(); // kick worker nếu chưa chạy
  return { queued: true };
});

// Backward compat: download-video vẫn hoạt động synchronously nếu cần
ipcMain.handle('download-video', async (_, { mediaName }) => {
  return _doDownloadVideo(mediaName);
});

// Download a completed Avis video from its R2 URL. R2 asset URLs are gated by
// the Avis Bearer key, so the fetch must run here (main process) — the renderer
// has no access to the secret. Saves into the configured video output folder,
// dedups by URL, and returns a file:// path like _doDownloadVideo.
ipcMain.handle('download-avis-video', async (_, { url, fileName } = {}) => {
  if (!url || typeof url !== 'string') throw new Error('download-avis-video: missing url');
  const runtime = getAvisMediaRuntime();
  const saveDir = getVideoOutputDir();
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  // Dedup cache keyed by URL (shared map file with Flow downloads).
  const lookupFile = path.join(saveDir, '.download-map.json');
  let downloadMap = {};
  try { downloadMap = JSON.parse(fs.readFileSync(lookupFile, 'utf-8')); } catch { }
  if (downloadMap[url] && fs.existsSync(downloadMap[url])) {
    console.log(`[AVIS-DL] Cache hit: ${downloadMap[url]}`);
    return pathToFileURL(downloadMap[url]).toString();
  }

  const safeName = (fileName && String(fileName).trim()) || getNextFilename(saveDir, 'mp4');
  const filename = /\.mp4$/i.test(safeName) ? safeName : `${safeName}.mp4`;
  const filepath = path.join(saveDir, filename);
  console.log(`[AVIS-DL] Downloading Avis video → ${filename}`);

  // Presigned storage URLs (Cloudflare R2 / Volcengine TOS / S3) already carry
  // their auth inside the query signature. Adding an `Authorization: Bearer`
  // header makes those hosts reject the request with HTTP 400 ("only one auth
  // mechanism allowed") — that was the merge-step download failure. Only attach
  // the Avis key when the URL is on the Avis API host AND has no signature query;
  // otherwise fetch clean. If the first attempt fails with an auth-ish status,
  // flip the auth mode once so we survive whichever URL shape Avis returns.
  const isPresigned = /[?&](x-amz-|x-tos-|x-goog-|sig=|signature=|expires=|se=|st=|sv=|token=)/i.test(url);
  let apiHost = '';
  try { apiHost = new URL(runtime.apiBase).host; } catch { }
  let urlHost = '';
  try { urlHost = new URL(url).host; } catch { }
  const onAvisHost = !!apiHost && !!urlHost && (urlHost === apiHost || /(^|\.)avis\./i.test(urlHost));
  const wantAuthFirst = !!runtime.apiKey && onAvisHost && !isPresigned;

  const attempt = (useAuth) => new Promise((resolve, reject) => {
    let fileStream = null;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { if (fileStream) fileStream.close(); } catch { }
      if (err) {
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { }
        reject(err);
      } else {
        resolve();
      }
    };

    const request = net.request({ url, method: 'GET' });
    if (useAuth && runtime.apiKey) request.setHeader('Authorization', `Bearer ${runtime.apiKey}`);
    request.setHeader('Accept', '*/*');

    request.on('redirect', (_statusCode, _method, _redirectUrl) => {
      request.followRedirect();
    });

    request.on('response', (response) => {
      console.log(`[AVIS-DL] Response: ${response.statusCode} (auth=${useAuth}), content-type: ${response.headers['content-type']}`);
      if (response.statusCode !== 200) {
        const e = new Error(`HTTP ${response.statusCode}`);
        e.statusCode = response.statusCode;
        finish(e);
        return;
      }
      fileStream = fs.createWriteStream(filepath);
      let totalBytes = 0;
      response.on('data', (chunk) => { totalBytes += chunk.length; fileStream.write(chunk); });
      response.on('end', () => {
        fileStream.end(() => {
          console.log(`[AVIS-DL] Stream done: ${filepath} (${totalBytes} bytes)`);
          finish(null);
        });
      });
      response.on('error', finish);
    });

    request.on('error', (err) => {
      console.error(`[AVIS-DL] net.request error:`, err.message);
      finish(err);
    });

    const timer = setTimeout(() => finish(new Error('AI Provider download timeout 180s')), 180000);
    request.on('response', () => clearTimeout(timer));

    request.end();
  });

  try {
    await attempt(wantAuthFirst);
  } catch (err) {
    // 400/401/403 → likely the wrong auth mode for this URL shape. Flip once.
    if ([400, 401, 403].includes(err && err.statusCode)) {
      console.log(`[AVIS-DL] HTTP ${err.statusCode} with auth=${wantAuthFirst} → retry with auth=${!wantAuthFirst}`);
      await attempt(!wantAuthFirst);
    } else {
      throw err;
    }
  }

  const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
  if (size === 0) throw new Error('Downloaded AI Provider video is empty');
  console.log(`[AVIS-DL] ✅ Saved: ${filepath} (${size} bytes)`);
  _saveDownloadMap(lookupFile, url, filepath);
  return pathToFileURL(filepath).toString();
});

async function _processNextDownload() {
  if (_videoDownloadRunning) return;
  if (_videoDownloadQueue.length === 0) return;

  _videoDownloadRunning = true;
  console.log(`[DL-QUEUE] Worker started, ${_videoDownloadQueue.length} jobs in queue`);

  // Chạy parallel 2 jobs cùng lúc để tránh job cuối phải chờ quá lâu
  const MAX_CONCURRENT = 2;
  const running = new Set();

  const runJob = async (job) => {
    const { mediaName, itemId, slotId } = job;
    console.log(`[DL-QUEUE] Processing job ${itemId} | slot=${slotId} | ${mediaName}`);

    let localPath = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        localPath = await _doDownloadVideo(mediaName, slotId);
        break; // success
      } catch (err) {
        console.error(`[DL-QUEUE] Attempt ${attempt}/3 failed for ${itemId}:`, err.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 5000)); // wait 5s before retry
        }
      }
    }

    if (localPath) {
      console.log(`[DL-QUEUE] ✅ Job ${itemId} done: ${localPath}`);

      // Extract thumbnail for media library display
      let thumbnailDataUrl = null;
      try {
        const { fileURLToPath: flu } = require('url');
        const resolvedPath = localPath.startsWith('file://') ? flu(localPath) : localPath;
        if (fs.existsSync(resolvedPath)) {
          const ffmpegBin = getFfmpegBin();
          const thumbArgs = ['-y', '-ss', '0.5', '-i', resolvedPath, '-frames:v', '1', '-q:v', '4', '-vf', 'scale=320:-1', '-f', 'mjpeg', 'pipe:1'];
          const thumbBuf = await new Promise((res, rej) => {
            const { execFile } = require('child_process');
            execFile(ffmpegBin, thumbArgs, { timeout: 15000, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
              if (err) { rej(err); } else { res(stdout); }
            });
          });
          if (thumbBuf && thumbBuf.length > 0) {
            thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
            console.log(`[DL-QUEUE] Thumbnail extracted for ${itemId} (${thumbBuf.length} bytes)`);
          }
        }
      } catch (thumbErr) {
        console.warn(`[DL-QUEUE] Thumbnail extraction failed for ${itemId}:`, thumbErr.message);
      }

      if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
        runtime.mainWindow.webContents.send('video-downloaded', { itemId, localPath, thumbnailDataUrl });
      }
    } else {
      console.error(`[DL-QUEUE] ❌ Job ${itemId} failed after 3 attempts`);
      if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
        runtime.mainWindow.webContents.send('video-download-failed', { itemId, error: 'Failed after 3 attempts' });
      }
    }
    running.delete(job);
  };

  while (_videoDownloadQueue.length > 0 || running.size > 0) {
    // Kick off up to MAX_CONCURRENT jobs
    while (_videoDownloadQueue.length > 0 && running.size < MAX_CONCURRENT) {
      const job = _videoDownloadQueue.shift();
      running.add(job);
      runJob(job); // intentionally not awaited — runs concurrently
    }
    // Wait a bit before checking again
    await new Promise(r => setTimeout(r, 500));
  }

  _videoDownloadRunning = false;
  console.log(`[DL-QUEUE] Worker done`);
}


async function _doDownloadVideo(mediaName, slotId = 0) {
  const saveDir = getVideoOutputDir();
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  // Dedup cache
  const lookupFile = path.join(saveDir, '.download-map.json');
  let downloadMap = {};
  try { downloadMap = JSON.parse(fs.readFileSync(lookupFile, 'utf-8')); } catch { }
  if (downloadMap[mediaName] && fs.existsSync(downloadMap[mediaName])) {
    console.log(`[VIDEO] Cache hit: ${downloadMap[mediaName]}`);
    return pathToFileURL(downloadMap[mediaName]).toString();
  }

  const filename = getNextFilename(saveDir, 'mp4');
  const filepath = path.join(saveDir, filename);
  const redirectUrl = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaName}`;
  console.log(`[VIDEO] Downloading: ${mediaName} → ${filename} (slot=${slotId})`);

  // Dùng đúng session của slot đã generate video
  const partition = `persist:slot-${slotId}`;
  const slotSes = session.fromPartition(partition);

  // Lấy cookies của labs.google từ slot session
  let cookieHeader = '';
  try {
    const cookies = await slotSes.cookies.get({ domain: 'labs.google' });
    cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
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
      try { if (fileStream) fileStream.close(); } catch { }
      if (err) {
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { }
        reject(err);
      } else {
        resolve();
      }
    };

    const request = net.request({
      url: redirectUrl,
      session: slotSes,    // session OBJECT thay vì partition string
    });

    // Browser-like headers để tránh 401
    request.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    request.setHeader('Origin', 'https://labs.google');
    request.setHeader('Referer', 'https://labs.google/');
    request.setHeader('Accept', '*/*');
    if (cookieHeader) request.setHeader('Cookie', cookieHeader);

    request.on('redirect', (statusCode, method, redirectUrl, headers) => {
      console.log(`[VIDEO] Redirect ${statusCode} → ${redirectUrl.substring(0, 80)}`);
      request.followRedirect();
    });

    request.on('response', (response) => {
      console.log(`[VIDEO] Response: ${response.statusCode}, content-type: ${response.headers['content-type']}`);
      if (response.statusCode !== 200) {
        finish(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      fileStream = fs.createWriteStream(filepath);
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        fileStream.write(chunk);
      });
      response.on('end', () => {
        fileStream.end(() => {
          console.log(`[VIDEO] Stream done: ${filepath} (${totalBytes} bytes)`);
          finish(null);
        });
      });
      response.on('error', finish);
    });

    request.on('error', (err) => {
      console.error(`[VIDEO] net.request error:`, err.message);
      finish(err);
    });

    // Timeout 120s cho video lớn
    const timer = setTimeout(() => finish(new Error('Download timeout 120s')), 120000);
    request.on('response', () => clearTimeout(timer));

    request.end();
  });

  const size = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0;
  if (size === 0) throw new Error('Downloaded file is empty');
  console.log(`[VIDEO] ✅ Saved: ${filepath} (${size} bytes)`);
  _saveDownloadMap(lookupFile, mediaName, filepath);
  return pathToFileURL(filepath).toString();
}


function _saveDownloadMap(lookupFile, mediaName, filepath) {
  try {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(lookupFile, 'utf-8')); } catch { }
    map[mediaName] = filepath;
    fs.writeFileSync(lookupFile, JSON.stringify(map, null, 2));
  } catch { }
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
        try { win.webContents.session.removeListener('will-download', willDownloadHandler); } catch { }
      }
      try { win.close(); } catch { }
      if (err) reject(err); else resolve();
    };
    const win = new BrowserWindow({
      show: false, width: 1, height: 1,
      webPreferences: { partition: SESSION_PARTITION }, // ← có Google cookies
    });
    willDownloadHandler = (event, item) => {
      item.setSavePath(filepath);
      item.once('done', (e, state) => {
        if (state === 'completed') finish(null);
        else finish(new Error(`Download ${state}`));
      });
    };
    win.webContents.session.on('will-download', willDownloadHandler);
    win.webContents.on('did-navigate', (e, url) => {
      if (url.includes('storage.googleapis.com')) {
        try { win.close(); } catch { }
        https.get(url, (res) => {
          if (res.statusCode !== 200) { finish(new Error(`GCS: ${res.statusCode}`)); return; }
          const stream = fs.createWriteStream(filepath);
          res.pipe(stream);
          stream.on('finish', () => { stream.close(); finish(null); });
          stream.on('error', finish);
        }).on('error', finish);
      }
    });
    setTimeout(() => finish(new Error('Fallback download timeout 60s')), 60000);
    win.loadURL(redirectUrl).catch(() => { });
  });
}



  return {};
};
