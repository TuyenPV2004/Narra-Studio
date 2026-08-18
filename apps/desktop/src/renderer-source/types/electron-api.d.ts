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
  openOutputFolder: (path?: string) => Promise<unknown>;
  changeOutputFolder: () => Promise<unknown>;
  getImageOutputPath: () => Promise<unknown>;
  changeImageOutputFolder: () => Promise<unknown>;
  setManualAuth: (payload: {
    bearerToken: string;
    projectId: null;
  }) => Promise<unknown>;
  copyToClipboard: (text: string) => Promise<unknown>;
  openExternalUrl: (url: string) => Promise<unknown>;
  getAllSlots: () => Promise<unknown>;
  pickRandomSlot: () => Promise<unknown>;
  generateImage: (payload: Record<string, unknown>) => Promise<unknown>;
  selectModelOnWebview: (payload: { model: string }) => Promise<unknown>;
  selectQuantityOnWebview: (payload: { quantity: number }) => Promise<unknown>;
  selectAspectOnWebview: (payload: { aspect: string }) => Promise<unknown>;
  generateViaPage: (payload: Record<string, unknown>) => Promise<unknown>;
  waitPageGenResult: (payload: {
    timeoutMs: number;
    requestId?: string;
  }) => Promise<unknown>;
  saveImageLocally: (payload: {
    src: string;
    fileName: string;
  }) => Promise<unknown>;
  upscaleImage: (payload: Record<string, unknown>) => Promise<unknown>;
  getFlowProjectInitialData: (payload: { slotId: number }) => Promise<unknown>;
  generateFlowVoicePreview: (
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  saveFileDialog: (payload: Record<string, unknown>) => Promise<unknown>;
  getFilePath: (file: File) => string;
  uploadImage: (payload: Record<string, unknown>) => Promise<unknown>;
  uploadImageFromPath: (payload: Record<string, unknown>) => Promise<unknown>;
  editImage: (payload: Record<string, unknown>) => Promise<unknown>;
  transformImage: (payload: {
    mediaId: string;
    cropCoordinates: {
      top: number;
      left: number;
      right: number;
      bottom: number;
    };
  }) => Promise<unknown>;
  resolveVideoUrl: (payload: Record<string, unknown>) => Promise<unknown>;
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
  pollVideoStatus: (payload: Record<string, unknown>) => Promise<unknown>;
  queueVideoDownload: (payload: Record<string, unknown>) => Promise<unknown>;
  downloadVideo: (payload: { mediaName: string }) => Promise<unknown>;
  generatePinholeGif: (payload: { mediaId: string }) => Promise<unknown>;
  upscaleVideo: (payload: Record<string, unknown>) => Promise<unknown>;
  listImageFiles: () => Promise<unknown>;
  listVideoFiles: () => Promise<unknown>;
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
  switchWebviewSlot: (payload: { slotId: number }) => Promise<unknown>;
  onSlotLoginDone: (callback: (payload: unknown) => void) => () => void;
  onSlotEmailUpdated: (callback: (payload: unknown) => void) => () => void;
  onSlotSessionUpdated: (callback: (payload: unknown) => void) => () => void;
  onSlotLoggedOut: (callback: (payload: unknown) => void) => () => void;
  onAutoEnteredProject: (callback: () => void) => () => void;
  getDashboardStats: () => Promise<unknown>;
  getCredits: (payload?: { slotId: number }) => Promise<unknown>;
  createFlowProject: (payload?: Record<string, unknown>) => Promise<unknown>;
  onFlowProjectChanged: (callback: (payload: unknown) => void) => () => void;
  aiAgentChat: (payload: Record<string, unknown>) => Promise<unknown>;
  aiAgentChatStream: (
    payload: Record<string, unknown>,
    callback: (payload: unknown) => void,
  ) => { promise: Promise<unknown>; cancel: () => void };
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
