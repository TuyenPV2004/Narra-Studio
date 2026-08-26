export type ProviderId = "veo3";

export interface ProviderSelectionPayload {
  providerId: ProviderId;
  activate: boolean;
}

export interface ProviderPayload {
  providerId: ProviderId;
}

export interface NarraElectronApi {
  providerGetActive: () => Promise<unknown>;
  providerSetActive: (payload: ProviderSelectionPayload) => Promise<unknown>;
  providerGetStatus: (payload: ProviderPayload) => Promise<unknown>;
  providerGetCredential: (payload: ProviderPayload) => Promise<unknown>;
  aiProviderProfileList: () => Promise<unknown>;
  aiProviderProfileSave: (payload: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    model?: string;
  }) => Promise<unknown>;
  aiProviderProfileDelete: (payload: { id: string }) => Promise<unknown>;
  aiProviderProfileSetActive: (payload: {
    id: string;
    capability?: string;
  }) => Promise<unknown>;
  aiProviderProfileTest: (payload: {
    id?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    protocol?: string;
  }) => Promise<unknown>;
  aiProviderProfileModels: (payload: {
    id?: string;
    baseUrl?: string;
    apiKey?: string;
  }) => Promise<unknown>;
  getCaptchaBridgeStatus: () => Promise<unknown>;
  testCaptchaExtension: () => Promise<unknown>;
  openExtensionFolder: () => Promise<unknown>;
  getVideoOutputPath: () => Promise<unknown>;
  openOutputFolder: (path?: string) => Promise<
    | boolean
    | {
        ok: boolean;
        error: string | null;
      }
  >;
  changeOutputFolder: () => Promise<unknown>;
  getImageOutputPath: () => Promise<unknown>;
  changeImageOutputFolder: () => Promise<unknown>;
  getVoiceOutputPath: () => Promise<unknown>;
  changeVoiceOutputFolder: () => Promise<unknown>;
  setManualAuth: (payload: {
    bearerToken: string;
    projectId: null;
  }) => Promise<unknown>;
  copyToClipboard: (text: string) => Promise<unknown>;
  openExternalUrl: (url: string) => Promise<unknown>;
  getAllSlots: () => Promise<unknown>;
  pickRandomSlot: () => Promise<unknown>;
  generateImage: (payload: {
    aspectRatio?: string;
    captchaToken?: string;
    count?: number;
    model?: string;
    prompt: string;
    referenceImageName?: string | null;
    referenceImageNames?: string[];
    seed?: number;
    slotId?: number;
  }) => Promise<unknown>;
  saveImageLocally: (payload: {
    fileName?: string;
    slotId?: number;
    src: string;
  }) => Promise<unknown>;
  upscaleImage: (payload: {
    captchaToken?: string;
    mediaId: string;
    slotId?: number;
    targetResolution?: string;
  }) => Promise<unknown>;
  getFlowProjectInitialData: (payload: { slotId: number }) => Promise<unknown>;
  xttsStatus: () => Promise<unknown>;
  xttsImportReference: (payload: { limit: number }) => Promise<unknown>;
  xttsReleaseReferences: (payload: {
    referencePaths: string[];
  }) => Promise<unknown>;
  xttsGenerate: (payload: Record<string, unknown>) => Promise<unknown>;
  xttsCancel: (payload: { requestId: string }) => Promise<unknown>;
  xttsShowInFolder: (payload: { filePath: string }) => Promise<unknown>;
  onXttsProgress: (
    callback: (payload: Record<string, unknown>) => void,
  ) => () => void;
  saveFileDialog: (payload: Record<string, unknown>) => Promise<unknown>;
  authorizeFilePath: (file: File) => Promise<string>;
  getFilePath: (file: File) => string;
  uploadImage: (payload: {
    fileName?: string;
    imageBytes: string;
    mimeType?: string;
    slotId?: number;
  }) => Promise<unknown>;
  uploadImageFromPath: (payload: {
    fileName?: string;
    filePath: string;
    mimeType?: string;
    slotId?: number;
  }) => Promise<unknown>;
  editImage: (payload: {
    baseMediaId: string;
    captchaToken?: string;
    prompt: string;
    slotId?: number;
  }) => Promise<unknown>;
  transformImage: (payload: {
    cropCoordinates: {
      bottom: number;
      left: number;
      right: number;
      top: number;
    };
    mediaId: string;
    slotId?: number;
  }) => Promise<unknown>;
  resolveVideoUrl: (payload: {
    slotId?: number;
    url: string;
  }) => Promise<unknown>;
  generateVideo: (payload: Record<string, unknown>) => Promise<unknown>;
  generateVideoStartImage: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  generateVideoStartEndImage: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  generateVideoReferenceImages: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  generateVideoEditVideo: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  uploadOmniVideo: (payload: Record<string, unknown>) => Promise<unknown>;
  pollVideoStatus: (payload: {
    mediaName: string;
    projectId?: string | null;
    slotId?: number;
  }) => Promise<unknown>;
  queueVideoDownload: (payload: {
    itemId: string;
    mediaName: string;
    slotId?: number;
  }) => Promise<unknown>;
  resolveDownloadedVideo: (mediaName: string) => Promise<unknown>;
  downloadVideo: (payload: {
    mediaName: string;
    slotId?: number;
  }) => Promise<unknown>;
  generatePinholeGif: (payload: {
    mediaId: string;
    slotId?: number;
  }) => Promise<unknown>;
  upscaleVideo: (payload: {
    aspectRatio: string;
    captchaToken?: string;
    mediaId: string;
    resolution: string;
    slotId?: number;
  }) => Promise<unknown>;
  listImageFiles: () => Promise<unknown>;
  listVideoFiles: () => Promise<unknown>;
  listVoiceFiles: () => Promise<unknown>;
  deleteFile: (path: string) => Promise<unknown>;
  selectFiles: () => Promise<unknown>;
  selectVideoFiles: () => Promise<unknown>;
  concatVideos: (payload: { filePaths: string[] }) => Promise<unknown>;
  trimVideo: (payload: {
    filePath: string;
    startTime: number;
    endTime: number;
  }) => Promise<unknown>;
  trimAudio: (payload: {
    filePath: string;
    startTime: number;
    endTime: number;
    outputName?: string;
  }) => Promise<unknown>;
  getVideoInfo: (payload: Record<string, unknown>) => Promise<unknown>;
  getAudioInfo: (payload: { filePath: string }) => Promise<unknown>;
  extractThumbnail: (payload: Record<string, unknown>) => Promise<unknown>;
  extractAudio: (payload: Record<string, unknown>) => Promise<unknown>;
  selectSrtFile: () => Promise<unknown>;
  selectAudioFile: () => Promise<unknown>;
  aiGenerateSubtitles: (payload: Record<string, unknown>) => Promise<unknown>;
  aiDetectWatermark: (payload: Record<string, unknown>) => Promise<unknown>;
  concatWithTransitions: (payload: Record<string, unknown>) => Promise<unknown>;
  selectOutputFolder: () => Promise<unknown>;
  listVideoProjects: () => Promise<unknown>;
  saveVideoProject: (payload: {
    id?: string;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  loadVideoProject: (id: string) => Promise<unknown>;
  deleteVideoProject: (id: string) => Promise<unknown>;
  showInFolder: (filePath: string) => Promise<unknown>;
  textToSpeech: (payload: Record<string, unknown>) => Promise<unknown>;
  textToSpeechCancel: (payload: { progressTag: string }) => Promise<unknown>;
  lipSyncVideo: (payload: Record<string, unknown>) => Promise<unknown>;
  aiSuggestDeflicker: (payload: Record<string, unknown>) => Promise<unknown>;
  saveFile: (payload: Record<string, unknown>) => Promise<unknown>;
  selectMediaFiles: () => Promise<unknown>;
  getVideoDuration: (payload: Record<string, unknown>) => Promise<unknown>;
  concatVideosWithTransitions: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  applyVideoFilters: (payload: Record<string, unknown>) => Promise<unknown>;
  projectsList: () => Promise<unknown>;
  projectsGet: (id: string) => Promise<unknown>;
  projectsSave: (project: Record<string, unknown>) => Promise<unknown>;
  projectsDelete: (id: string) => Promise<unknown>;
  projectsRename: (id: string, name: string) => Promise<unknown>;
  projectsDuplicate: (id: string, newName: string) => Promise<unknown>;
  openIncognitoLogin: (payload: { slotId: number }) => Promise<unknown>;
  logoutSlot: (payload: { slotId: number }) => Promise<unknown>;
  syncSlotSession: (payload: { slotId: number }) => Promise<unknown>;
  openFlowSession: (payload: { slotId: number }) => Promise<unknown>;
  onSlotLoginDone: (callback: (payload: unknown) => void) => () => void;
  onSlotEmailUpdated: (callback: (payload: unknown) => void) => () => void;
  onSlotSessionUpdated: (callback: (payload: unknown) => void) => () => void;
  onSlotLoggedOut: (callback: (payload: unknown) => void) => () => void;
  onAutoEnteredProject: (callback: () => void) => () => void;
  getDashboardStats: () => Promise<unknown>;
  getCredits: (payload?: { slotId: number }) => Promise<unknown>;
  createFlowProject: (payload: { slotId: number }) => Promise<unknown>;
  onFlowProjectChanged: (callback: (payload: unknown) => void) => () => void;
  onVideoDownloaded: (
    callback: (payload: {
      itemId: string;
      localPath: string;
      thumbnailDataUrl?: string | null;
    }) => void,
  ) => () => void;
  onVideoDownloadFailed: (
    callback: (payload: { itemId: string; error: string }) => void,
  ) => () => void;
  aiAgentChat: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentChatStream: (
    payload: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ) => { promise: Promise<unknown>; cancel: () => void };
  aiAgentChatCancel: (payload: {
    requestId: string;
  }) => Promise<{ cancelled: boolean; requestId?: string }>;
  aiAgentIntent: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentWorkflow: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentPolishWorkflow: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentDeepAnalyze: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentReviewOutput: (payload: Record<string, unknown>) => Promise<unknown>;
  loadHistory: (key: string) => Promise<unknown>;
  saveHistory: (key: string, items: unknown[]) => Promise<unknown>;
  workspaceExportJson: (payload: {
    payload: Record<string, unknown>;
    suggestedName: string;
  }) => Promise<unknown>;
  workspaceBackupLocal: (payload: {
    payload: Record<string, unknown>;
    suggestedName: string;
  }) => Promise<unknown>;
  workspaceImportPrepare: () => Promise<unknown>;
  workspaceBackupVerify: () => Promise<unknown>;
  workspaceImportMediaRead: (payload: {
    sessionId: string;
    index: number;
  }) => Promise<unknown>;
  workspaceImportRelease: (payload: { sessionId: string }) => Promise<unknown>;
  teamWorkspaceList: (payload?: Record<string, unknown>) => Promise<unknown>;
  teamWorkspaceCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  teamWorkspaceRename: (payload: Record<string, unknown>) => Promise<unknown>;
  teamWorkspaceDelete: (payload: { id: string }) => Promise<unknown>;
  teamCanvasList: (payload: Record<string, unknown>) => Promise<unknown>;
  teamCanvasCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  teamCanvasGet: (payload: { id: string }) => Promise<unknown>;
  teamCanvasSync: (payload: Record<string, unknown>) => Promise<unknown>;
  teamCanvasRename: (payload: Record<string, unknown>) => Promise<unknown>;
  teamCanvasEpisodeUpdate: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamCanvasEpisodesReorder: (payload: {
    workspaceId: string;
    ids: string[];
  }) => Promise<unknown>;
  teamCanvasRevisions: (payload: { id: string }) => Promise<unknown>;
  teamCanvasRestore: (payload: {
    id: string;
    version: number;
  }) => Promise<unknown>;
  teamNodeLock: (payload: Record<string, unknown>) => Promise<unknown>;
  teamNodeComplete: (payload: Record<string, unknown>) => Promise<unknown>;
  teamNodeRelease: (payload: Record<string, unknown>) => Promise<unknown>;
  loadUserPresets: () => Promise<unknown>;
  saveUserPresets: (payload: Record<string, unknown>) => Promise<unknown>;
  importUserPresetFile: () => Promise<unknown>;
  exportUserPresetTemplate: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamCanvasArchive: (payload: { id: string }) => Promise<unknown>;
  teamCanvasDelete: (payload: { id: string }) => Promise<unknown>;
  selectAgentCanvasMediaFiles: () => Promise<unknown>;
  cropVideo: (payload: {
    filePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
    outputName?: string;
  }) => Promise<unknown>;
  depthAnythingVideo: (payload: Record<string, unknown>) => Promise<unknown>;
  cancelDepthAnythingVideo: (payload: { jobId: string }) => Promise<unknown>;
  onDepthAnythingProgress: (callback: (payload: unknown) => void) => () => void;
  demuxVideoAudio: (payload: {
    source: string;
    jobId: string;
    audioFormat: "mp3" | "wav";
  }) => Promise<unknown>;
  cancelVideoAudioDemux: (payload: { jobId: string }) => Promise<unknown>;
  onVideoAudioDemuxProgress: (
    callback: (payload: unknown) => void,
  ) => () => void;
  separateVideoAudioStems: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  cancelVideoAudioSeparation: (payload: {
    operationId: string;
  }) => Promise<unknown>;
  onVideoAudioSeparationProgress: (
    callback: (payload: unknown) => void,
  ) => () => void;
  teamWorkspaceAssetList: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamWorkspaceAssetUpsert: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamWorkspaceAssetCloneRecord: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamMediaUpload: (payload: Record<string, unknown>) => Promise<unknown>;
  teamWorkspaceAssetArchive: (payload: { id: string }) => Promise<unknown>;
  teamWorkspaceToolboxList: (payload: {
    workspaceId: string;
  }) => Promise<unknown>;
  teamWorkspaceToolboxUpsert: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  teamWorkspaceToolboxDelete: (payload: {
    workspaceId: string;
    id: string;
  }) => Promise<unknown>;
  importSkillFolder: () => Promise<unknown>;
  readSkillFiles: (payload: Record<string, unknown>) => Promise<unknown>;
  createAIAgentStoryProject: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  saveDirectorScene: (payload: Record<string, unknown>) => Promise<unknown>;
  loadDirectorScene: (payload: { id: string }) => Promise<unknown>;
  listDirectorScenes: () => Promise<unknown>;
  saveDirectorCapture: (payload: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    api?: NarraElectronApi;
  }
}
