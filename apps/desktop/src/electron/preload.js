const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  authorizeFilePath: (file) => {
    try {
      let filePath = "";
      if (file && typeof file === "object") {
        try {
          filePath = webUtils.getPathForFile(file);
        } catch {
          filePath = "";
        }
      }
      if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
        return Promise.resolve("");
      }
      return ipcRenderer
        .invoke("authorize-user-selected-file-async", filePath)
        .catch(() => {
          return ipcRenderer.sendSync("authorize-user-selected-file", filePath)
            ? filePath
            : "";
        });
    } catch {
      return Promise.resolve("");
    }
  },
  getFilePath: (file) => {
    try {
      let filePath = "";
      if (file && typeof file === "object") {
        try {
          filePath = webUtils.getPathForFile(file);
        } catch {
          filePath = "";
        }
      }
      if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
        return "";
      }
      return ipcRenderer.sendSync("authorize-user-selected-file", filePath)
        ? filePath
        : "";
    } catch {
      return "";
    }
  },
  openDevTools: () => ipcRenderer.invoke("open-dev-tools"),
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  getLastProjectUrl: () => ipcRenderer.invoke("get-last-project-url"),
  getAuthInfo: () => ipcRenderer.invoke("get-auth-info"),
  getFlowProjectInitialData: (p) =>
    ipcRenderer.invoke("get-flow-project-initial-data", p),
  onFlowProjectChanged: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on("flow-project-changed", handler);
    return () => ipcRenderer.removeListener("flow-project-changed", handler);
  },
  createFlowProject: (p) => ipcRenderer.invoke("create-flow-project", p),
  providersList: () => ipcRenderer.invoke("providers-list"),
  providerGetActive: () => ipcRenderer.invoke("provider-get-active"),
  providerSetActive: (p) => ipcRenderer.invoke("provider-set-active", p),
  providerGetStatus: (p) => ipcRenderer.invoke("provider-get-status", p),
  providerGetCredential: (p) =>
    ipcRenderer.invoke("provider-get-credential", p),
  aiProviderProfileList: () => ipcRenderer.invoke("ai-provider-profile-list"),
  aiProviderProfileSave: (p) =>
    ipcRenderer.invoke("ai-provider-profile-save", p),
  aiProviderProfileDelete: (p) =>
    ipcRenderer.invoke("ai-provider-profile-delete", p),
  aiProviderProfileSetActive: (p) =>
    ipcRenderer.invoke("ai-provider-profile-set-active", p),
  aiProviderProfileTest: (p) =>
    ipcRenderer.invoke("ai-provider-profile-test", p),
  aiProviderProfileModels: (p) =>
    ipcRenderer.invoke("ai-provider-profile-models", p),

  getCaptchaBridgeStatus: () => ipcRenderer.invoke("get-captcha-bridge-status"),
  testCaptchaExtension: () => ipcRenderer.invoke("test-captcha-extension"),
  openExtensionFolder: () => ipcRenderer.invoke("open-extension-folder"),
  setManualAuth: (d) => ipcRenderer.invoke("set-manual-auth", d),
  generateImage: (p) => ipcRenderer.invoke("generate-image", p),
  generateVideo: (p) => ipcRenderer.invoke("generate-video", p),
  generateVideoStartImage: (p) =>
    ipcRenderer.invoke("generate-video-start-image", p),
  generateVideoStartEndImage: (p) =>
    ipcRenderer.invoke("generate-video-start-end-image", p),
  generateVideoReferenceImages: (p) =>
    ipcRenderer.invoke("generate-video-reference-images", p),
  generateVideoEditVideo: (p) =>
    ipcRenderer.invoke("generate-video-edit-video", p),
  generateFlowVoicePreview: (p) =>
    ipcRenderer.invoke("generate-flow-voice-preview", p),
  uploadOmniVideo: (p) => ipcRenderer.invoke("upload-omni-video", p),
  pollVideoStatus: (p) => ipcRenderer.invoke("poll-video-status", p),
  resolveVideoUrl: (p) => ipcRenderer.invoke("resolve-video-url", p),
  resolveDownloadedVideo: (mediaName) =>
    ipcRenderer.invoke("resolve-downloaded-video", mediaName),
  downloadVideo: (p) => ipcRenderer.invoke("download-video", p),
  queueVideoDownload: (p) => ipcRenderer.invoke("queue-video-download", p),
  uploadImage: (p) => ipcRenderer.invoke("upload-image", p),
  uploadImageFromPath: (p) => ipcRenderer.invoke("upload-image-from-path", p),
  downloadMediaToTemp: (p) => ipcRenderer.invoke("download-media-to-temp", p),
  editImage: (p) => ipcRenderer.invoke("edit-image", p),
  upscaleImage: (p) => ipcRenderer.invoke("upscale-image", p),
  generatePinholeGif: (p) => ipcRenderer.invoke("generate-pinhole-gif", p),
  upscaleVideo: (p) => ipcRenderer.invoke("upscale-video", p),
  transformImage: (p) => ipcRenderer.invoke("transform-image", p),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectImageFolder: () => ipcRenderer.invoke("select-image-folder"),
  importSkillFolder: () => ipcRenderer.invoke("import-skill-folder"),
  readSkillFolder: (rootPath) =>
    ipcRenderer.invoke("read-skill-folder", rootPath),
  readSkillFiles: (p) => ipcRenderer.invoke("read-skill-files", p),
  saveFile: (p) => ipcRenderer.invoke("save-file", p),
  saveFileDialog: (p) => ipcRenderer.invoke("save-file-dialog", p),
  workspaceBackupLocal: (p) => ipcRenderer.invoke("workspace-backup-local", p),
  workspaceExportJson: (p) => ipcRenderer.invoke("workspace-export-json", p),
  workspaceBackupVerify: () => ipcRenderer.invoke("workspace-backup-verify"),
  workspaceImportPrepare: () => ipcRenderer.invoke("workspace-import-prepare"),
  workspaceImportMediaRead: (p) =>
    ipcRenderer.invoke("workspace-import-media-read", p),
  workspaceImportRelease: (p) =>
    ipcRenderer.invoke("workspace-import-release", p),
  createAIAgentStoryProject: (p) =>
    ipcRenderer.invoke("create-ai-agent-story-project", p),
  captureRegion: (rect) => ipcRenderer.invoke("capture-region", rect),
  saveImageLocally: (p) => ipcRenderer.invoke("save-image-locally", p),
  selectDirectorAssets: () => ipcRenderer.invoke("select-director-assets"),
  importDirectorAsset: (p) => ipcRenderer.invoke("import-director-asset", p),
  saveDirectorScene: (p) => ipcRenderer.invoke("save-director-scene", p),
  loadDirectorScene: (p) => ipcRenderer.invoke("load-director-scene", p),
  listDirectorScenes: () => ipcRenderer.invoke("list-director-scenes"),
  saveDirectorCapture: (p) => ipcRenderer.invoke("save-director-capture", p),
  loadMediaLibrary: () => ipcRenderer.invoke("load-media-library"),
  saveMediaLibrary: (items) => ipcRenderer.invoke("save-media-library", items),
  loadHistory: (key) => ipcRenderer.invoke("load-history", key),
  saveHistory: (key, items) => ipcRenderer.invoke("save-history", key, items),

  // Local workspace compatibility API. Names stay stable for the recovered renderer;
  // implementations persist only under Electron userData and never call a team server.
  teamWorkspaceList: () => ipcRenderer.invoke("team-workspace-list"),
  teamWorkspaceCreate: (p) => ipcRenderer.invoke("team-workspace-create", p),
  teamWorkspaceGet: (p) => ipcRenderer.invoke("team-workspace-get", p),
  teamWorkspaceActivity: (p) =>
    ipcRenderer.invoke("team-workspace-activity", p),
  teamWorkspaceAccept: (p) => ipcRenderer.invoke("team-workspace-accept", p),
  teamWorkspaceInvite: (p) => ipcRenderer.invoke("team-workspace-invite", p),
  teamWorkspaceRemoveMember: (p) =>
    ipcRenderer.invoke("team-workspace-remove-member", p),
  teamWorkspaceRename: (p) => ipcRenderer.invoke("team-workspace-rename", p),
  teamWorkspaceMemberRole: (p) =>
    ipcRenderer.invoke("team-workspace-member-role", p),
  teamWorkspaceTransferOwner: (p) =>
    ipcRenderer.invoke("team-workspace-transfer-owner", p),
  teamWorkspaceDelete: (p) => ipcRenderer.invoke("team-workspace-delete", p),
  teamPresenceConnect: (p) => ipcRenderer.invoke("team-presence-connect", p),
  teamPresenceCursor: (p) => ipcRenderer.send("team-presence-cursor", p),
  teamPresenceDocUpdate: (p) => ipcRenderer.send("team-presence-doc-update", p),
  teamPresenceWalStatus: (p) =>
    ipcRenderer.invoke("team-presence-wal-status", p),
  teamPresenceWalClear: (p) => ipcRenderer.invoke("team-presence-wal-clear", p),
  teamPresenceDisconnect: () => ipcRenderer.send("team-presence-disconnect"),
  onTeamPresence: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("team-presence-event", handler);
    return () => ipcRenderer.removeListener("team-presence-event", handler);
  },
  teamCanvasList: (p) => ipcRenderer.invoke("team-canvas-list", p),
  teamCanvasCreate: (p) => ipcRenderer.invoke("team-canvas-create", p),
  teamCanvasGet: (p) => ipcRenderer.invoke("team-canvas-get", p),
  teamNodeAuditAppend: (p) => ipcRenderer.invoke("team-node-audit-append", p),
  teamNodeAuditList: (p) => ipcRenderer.invoke("team-node-audit-list", p),
  teamCanvasSync: (p) => ipcRenderer.invoke("team-canvas-sync", p),
  teamCanvasRename: (p) => ipcRenderer.invoke("team-canvas-rename", p),
  teamCanvasEpisodeUpdate: (p) =>
    ipcRenderer.invoke("team-canvas-episode-update", p),
  teamCanvasEpisodesReorder: (p) =>
    ipcRenderer.invoke("team-canvas-episodes-reorder", p),
  teamCanvasArchive: (p) => ipcRenderer.invoke("team-canvas-archive", p),
  teamCanvasDelete: (p) => ipcRenderer.invoke("team-canvas-delete", p),
  teamCanvasRevisions: (p) => ipcRenderer.invoke("team-canvas-revisions", p),
  teamCanvasRestore: (p) => ipcRenderer.invoke("team-canvas-restore", p),
  teamNodeLock: (p) => ipcRenderer.invoke("team-node-lock", p),
  teamNodeComplete: (p) => ipcRenderer.invoke("team-node-complete", p),
  teamNodeRelease: (p) => ipcRenderer.invoke("team-node-release", p),
  teamWorkspaceAssetList: (p) =>
    ipcRenderer.invoke("team-workspace-asset-list", p),
  teamWorkspaceAssetUpsert: (p) =>
    ipcRenderer.invoke("team-workspace-asset-upsert", p),
  teamWorkspaceAssetCloneRecord: (p) =>
    ipcRenderer.invoke("team-workspace-asset-clone-record", p),
  teamWorkspaceAssetArchive: (p) =>
    ipcRenderer.invoke("team-workspace-asset-archive", p),
  teamWorkspaceToolboxList: (p) =>
    ipcRenderer.invoke("team-workspace-toolbox-list", p),
  teamWorkspaceToolboxUpsert: (p) =>
    ipcRenderer.invoke("team-workspace-toolbox-upsert", p),
  teamWorkspaceToolboxDelete: (p) =>
    ipcRenderer.invoke("team-workspace-toolbox-delete", p),
  teamMediaUpload: (p) => ipcRenderer.invoke("team-media-upload", p),
  // ── User-defined preset library (CapCut transitions + effects) ──
  loadUserPresets: () => ipcRenderer.invoke("load-user-presets"),
  saveUserPresets: (payload) =>
    ipcRenderer.invoke("save-user-presets", payload),
  importUserPresetFile: () => ipcRenderer.invoke("import-user-preset-file"),
  exportUserPresetTemplate: (params) =>
    ipcRenderer.invoke("export-user-preset-template", params),
  getVideoOutputPath: () => ipcRenderer.invoke("get-video-output-path"),
  openOutputFolder: (path) => ipcRenderer.invoke("open-output-folder", path),
  changeOutputFolder: () => ipcRenderer.invoke("change-output-folder"),
  getImageOutputPath: () => ipcRenderer.invoke("get-image-output-path"),
  changeImageOutputFolder: () =>
    ipcRenderer.invoke("change-image-output-folder"),
  listImageFiles: () => ipcRenderer.invoke("list-image-files"),
  listVideoFiles: () => ipcRenderer.invoke("list-video-files"),
  getDashboardStats: () => ipcRenderer.invoke("get-dashboard-stats"),
  getCredits: (params) => ipcRenderer.invoke("get-credits", params),

  onAuthCaptured: (cb) => ipcRenderer.on("auth-captured", (_, d) => cb(d)),
  concatVideos: (p) => ipcRenderer.invoke("concat-videos", p),
  concatVideosWithTransitions: (p) =>
    ipcRenderer.invoke("concat-videos-with-transitions", p),
  // Project management
  projectsList: () => ipcRenderer.invoke("projects:list"),
  projectsGet: (id) => ipcRenderer.invoke("projects:get", { id }),
  projectsSave: (project) => ipcRenderer.invoke("projects:save", project),
  projectsDelete: (id) => ipcRenderer.invoke("projects:delete", { id }),
  projectsRename: (id, name) =>
    ipcRenderer.invoke("projects:rename", { id, name }),
  projectsDuplicate: (id, newName) =>
    ipcRenderer.invoke("projects:duplicate", { id, newName }),
  deleteFile: (p) => ipcRenderer.invoke("delete-file", p),
  getVideoDuration: (p) => ipcRenderer.invoke("get-video-duration", p),
  cropVideo: (p) => ipcRenderer.invoke("crop-video", p),
  trimVideo: (p) => ipcRenderer.invoke("trim-video", p),
  trimAudio: (p) => ipcRenderer.invoke("trim-audio", p),
  selectVideoFiles: () => ipcRenderer.invoke("select-video-files"),
  selectMediaFiles: () => ipcRenderer.invoke("select-media-files"),
  selectAgentCanvasMediaFiles: () =>
    ipcRenderer.invoke("select-agent-canvas-media-files"),
  applyVideoFilters: (p) => ipcRenderer.invoke("apply-video-filters", p),
  depthAnythingVideo: (p) => ipcRenderer.invoke("depth-anything-video", p),
  cancelDepthAnythingVideo: (p) =>
    ipcRenderer.invoke("depth-anything-cancel", p),
  onDepthAnythingProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("depth-anything-progress", handler);
    return () => ipcRenderer.removeListener("depth-anything-progress", handler);
  },
  extractAudio: (p) => ipcRenderer.invoke("extract-audio", p),
  demuxVideoAudio: (p) => ipcRenderer.invoke("video-audio-demux", p),
  cancelVideoAudioDemux: (p) =>
    ipcRenderer.invoke("video-audio-demux-cancel", p),
  onVideoAudioDemuxProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("video-audio-demux-progress", handler);
    return () =>
      ipcRenderer.removeListener("video-audio-demux-progress", handler);
  },
  separateVideoAudioStems: (p) =>
    ipcRenderer.invoke("video-audio-separate-stems", p),
  cancelVideoAudioSeparation: (p) =>
    ipcRenderer.invoke("video-audio-separate-stems-cancel", p),
  onVideoAudioSeparationProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("video-audio-separation-progress", handler);
    return () =>
      ipcRenderer.removeListener("video-audio-separation-progress", handler);
  },
  extractThumbnail: (p) => ipcRenderer.invoke("extract-thumbnail", p),
  imageThumbnail: (p) => ipcRenderer.invoke("image-thumbnail", p),
  imageGridSegment: (p) => ipcRenderer.invoke("image-grid-segment", p),
  getVideoInfo: (p) => ipcRenderer.invoke("get-video-info", p),
  getAudioInfo: (p) => ipcRenderer.invoke("get-audio-info", p),
  selectSrtFile: () => ipcRenderer.invoke("select-srt-file"),
  selectAudioFile: () => ipcRenderer.invoke("select-audio-file"),
  selectAudioUploadFile: () => ipcRenderer.invoke("select-audio-upload-file"),
  readLocalAudioFile: (p) => ipcRenderer.invoke("read-local-audio-file", p),
  aiGenerateSubtitles: (p) => ipcRenderer.invoke("ai-generate-subtitles", p),
  aiTranscribeAudio: (p) => ipcRenderer.invoke("ai-transcribe-audio", p),
  aiTranscribeCancel: (p) => ipcRenderer.invoke("ai-transcribe-cancel", p),
  onExportProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("export-progress", handler);
    return () => ipcRenderer.removeListener("export-progress", handler);
  },
  onSttProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("stt-progress", handler);
    return () => ipcRenderer.removeListener("stt-progress", handler);
  },
  aiDetectWatermark: (p) => ipcRenderer.invoke("ai-detect-watermark", p),
  concatWithTransitions: (p) =>
    ipcRenderer.invoke("concat-with-transitions", p),
  selectOutputFolder: () => ipcRenderer.invoke("select-output-folder"),
  listVideoProjects: () => ipcRenderer.invoke("list-video-projects"),
  saveVideoProject: (p) => ipcRenderer.invoke("save-video-project", p),
  loadVideoProject: (id) => ipcRenderer.invoke("load-video-project", id),
  deleteVideoProject: (id) => ipcRenderer.invoke("delete-video-project", id),
  showInFolder: (filePath) => ipcRenderer.invoke("show-in-folder", filePath),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  onAutoEnteredProject: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("auto-entered-project", handler);
    return () => ipcRenderer.removeListener("auto-entered-project", handler);
  },

  // ── Voice Changer Asset Cache ──
  // Real downloadable IR (impulse-response) WAV files used by the voice
  // changer's reverb-based presets. See electron/main.js download-voice-asset
  // handler + src/components/capcut/voiceAssets.ts registry.
  downloadVoiceAsset: (assetId) =>
    ipcRenderer.invoke("download-voice-asset", { assetId }),
  listVoiceAssetsCached: () => ipcRenderer.invoke("list-voice-assets-cached"),
  onVoiceAssetProgress: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on("voice-asset-progress", handler);
    return () => ipcRenderer.removeListener("voice-asset-progress", handler);
  },

  // ── Video Download Events ──
  onVideoDownloaded: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on("video-downloaded", handler);
    return () => ipcRenderer.removeListener("video-downloaded", handler);
  },
  onVideoDownloadFailed: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on("video-download-failed", handler);
    return () => ipcRenderer.removeListener("video-download-failed", handler);
  },

  // ── Auto-Update ──
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getAppArch: () => ipcRenderer.invoke("get-app-arch"),
  // Ngôn ngữ giao diện — lưu trong flow-settings.json, renderer cache lại ở localStorage
  getUiLanguage: () => ipcRenderer.invoke("get-ui-language"),
  setUiLanguage: (language) => ipcRenderer.invoke("set-ui-language", language),
  syncSession: () => ipcRenderer.invoke("sync-session"),
  getAllSlots: () => ipcRenderer.invoke("get-all-slots"),
  pickRandomSlot: () => ipcRenderer.invoke("pick-random-slot"),
  syncSlotSession: (p) => ipcRenderer.invoke("sync-slot-session", p),
  importSlotCookies: (p) => ipcRenderer.invoke("import-slot-cookies", p),
  openLoginWindow: (p) => ipcRenderer.invoke("open-login-window", p),
  logoutSlot: (p) => ipcRenderer.invoke("logout-slot", p),
  openIncognitoLogin: (p) => ipcRenderer.invoke("open-incognito-login", p),
  openFlowSession: (p) => ipcRenderer.invoke("open-flow-session", p),
  onSlotLoginDone: (cb) => {
    ipcRenderer.on("slot-login-done", (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners("slot-login-done");
  },
  onSlotEmailUpdated: (cb) => {
    ipcRenderer.on("slot-email-updated", (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners("slot-email-updated");
  },
  onSlotSessionUpdated: (cb) => {
    ipcRenderer.on("slot-session-updated", (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners("slot-session-updated");
  },
  onSlotLoggedOut: (cb) => {
    ipcRenderer.on("slot-logged-out", (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners("slot-logged-out");
  },

  // ── Text-to-Speech ──
  textToSpeech: (p) => ipcRenderer.invoke("text-to-speech", p),
  textToSpeechCancel: (p) => ipcRenderer.invoke("text-to-speech-cancel", p),
  getLipSyncSettings: () => ipcRenderer.invoke("get-lip-sync-settings"),
  getLocalLipSyncStatus: () => ipcRenderer.invoke("get-local-lip-sync-status"),
  prepareLocalLipSyncEngine: (p) =>
    ipcRenderer.invoke("prepare-local-lip-sync-engine", p),
  getLocalTtsStatus: () => ipcRenderer.invoke("get-local-tts-status"),
  prepareLocalTtsEngine: (p) =>
    ipcRenderer.invoke("prepare-local-tts-engine", p),
  saveLipSyncSettings: (p) => ipcRenderer.invoke("save-lip-sync-settings", p),
  lipSyncVideo: (p) => ipcRenderer.invoke("lip-sync-video", p),
  aiAgentChat: (p) => ipcRenderer.invoke("ai-agent-chat", p),
  aiAgentChatStream: (p, cb) => {
    const requestId = p && p.requestId;
    const handler = (_event, payload) => {
      if (!requestId || payload?.requestId === requestId) cb(payload);
    };
    ipcRenderer.on("ai-agent-chat-stream", handler);
    const promise = ipcRenderer
      .invoke("ai-agent-chat-stream", p)
      .finally(() =>
        ipcRenderer.removeListener("ai-agent-chat-stream", handler),
      );
    return {
      promise,
      cancel: () => ipcRenderer.removeListener("ai-agent-chat-stream", handler),
    };
  },
  aiAgentIntent: (p) => ipcRenderer.invoke("ai-agent-intent", p),
  aiAgentWorkflow: (p) => ipcRenderer.invoke("ai-agent-workflow", p),
  aiAgentPolishWorkflow: (p) =>
    ipcRenderer.invoke("ai-agent-polish-workflow", p),
  aiAgentDeepAnalyze: (p) => ipcRenderer.invoke("ai-agent-deep-analyze", p),
  aiAgentReviewOutput: (p) => ipcRenderer.invoke("ai-agent-review-output", p),
  aiSuggestDeflicker: (p) => ipcRenderer.invoke("ai-suggest-deflicker", p),
  ttsModels: (p) => ipcRenderer.invoke("tts-models", p),
  ttsLanguages: (p) => ipcRenderer.invoke("tts-languages", p),
  ttsMinimaxVoices: (p) => ipcRenderer.invoke("tts-minimax-voices", p),
  ttsSharedVoices: (p) => ipcRenderer.invoke("tts-shared-voices", p),
  ttsDefaultVoices: (p) => ipcRenderer.invoke("tts-default-voices", p),
  ttsHistory: (p) => ipcRenderer.invoke("tts-history", p),
  ttsHistoryDelete: (p) => ipcRenderer.invoke("tts-history-delete", p),
  ttsHistoryRetry: (p) => ipcRenderer.invoke("tts-history-retry", p),
  ttsDialogue: (p) => ipcRenderer.invoke("tts-dialogue", p),
  ttsVoiceChanger: (p) => ipcRenderer.invoke("tts-voice-changer", p),
  selectFile: (opts) => ipcRenderer.invoke("dialog:openFile", opts),
});
