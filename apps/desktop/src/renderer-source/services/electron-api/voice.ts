import { getElectronApi } from "@/services/electron-api/client";

export type XttsVoiceMode = "preset" | "clone";
export interface XttsVoiceReference {
  fileUrl: string;
  id: string;
  localPath: string;
  name: string;
}
export interface XttsVoiceRequest {
  language: string;
  mode: XttsVoiceMode;
  referencePath?: string;
  requestId: string;
  speaker?: string;
  speed: number;
  taskName: string;
  text: string;
}
export interface XttsVoiceResult {
  fileUrl: string;
  filename: string;
  id: string;
  localPath: string;
}
export interface XttsVoiceStatus {
  cudaAvailable?: boolean;
  cudaName?: string;
  device?: "cpu" | "cuda";
  installed: boolean;
  languages?: string[];
  modelName?: string;
  pythonPath: string;
  reason?: string;
  runtimeRoot: string;
  speakers?: string[];
  torchVersion?: string;
}

export const XTTS_LANGUAGES = [
  { id: "en", label: "Tiếng Anh" },
  { id: "ja", label: "Tiếng Nhật" },
  { id: "ko", label: "Tiếng Hàn" },
  { id: "es", label: "Tiếng Tây Ban Nha" },
  { id: "fr", label: "Tiếng Pháp" },
  { id: "de", label: "Tiếng Đức" },
  { id: "it", label: "Tiếng Ý" },
  { id: "pt", label: "Tiếng Bồ Đào Nha" },
  { id: "pl", label: "Tiếng Ba Lan" },
  { id: "tr", label: "Tiếng Thổ Nhĩ Kỳ" },
  { id: "ru", label: "Tiếng Nga" },
  { id: "nl", label: "Tiếng Hà Lan" },
  { id: "cs", label: "Tiếng Séc" },
  { id: "ar", label: "Tiếng Ả Rập" },
  { id: "zh-cn", label: "Tiếng Trung giản thể" },
  { id: "hu", label: "Tiếng Hungary" },
  { id: "hi", label: "Tiếng Hindi" },
] as const;

export const voiceApi = {
  status: async () => (await getElectronApi().xttsStatus()) as XttsVoiceStatus,
  prepare: async () =>
    (await getElectronApi().xttsPrepare()) as XttsVoiceStatus,
  importReference: async () =>
    (await getElectronApi().xttsImportReference()) as XttsVoiceReference | null,
  generate: async (request: XttsVoiceRequest) =>
    (await getElectronApi().xttsGenerate(
      request as unknown as Record<string, unknown>,
    )) as XttsVoiceResult,
  cancel: async (requestId: string) =>
    getElectronApi().xttsCancel({ requestId }),
  showInFolder: async (localPath: string) =>
    getElectronApi().xttsShowInFolder({ filePath: localPath }),
};
