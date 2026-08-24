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
  /** Compatibility with queue snapshots created before multi-reference cloning. */
  referencePath?: string;
  referencePaths?: string[];
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
export interface XttsVoiceProgress {
  completedSegments: number;
  event: string;
  requestId: string;
  resumedSegments: number;
  segmentIndex: number;
  totalSegments: number;
}

export const XTTS_DEFAULT_SPEAKERS = [
  "Claribel Dervla",
  "Daisy Studious",
  "Gracie Wise",
  "Tammie Ema",
  "Alison Dietlinde",
  "Ana Florence",
  "Annmarie Nele",
  "Asya Anara",
  "Brenda Stern",
  "Gitta Nikolina",
  "Henriette Usha",
  "Sofia Hellen",
  "Tammy Grit",
  "Tanja Adelina",
  "Vjollca Johnnie",
  "Andrew Chipper",
  "Badr Odhiambo",
  "Dionisio Schuyler",
  "Royston Min",
  "Viktor Eka",
  "Aaron Dreschner",
  "Abrahan Mack",
  "Adde Michal",
  "Alexandra Hisakawa",
  "Alma María",
  "Baldur Sanjin",
  "Barbora MacLean",
  "Camilla Holmström",
  "Chandra MacFarland",
  "Craig Gutsy",
  "Damian Black",
  "Damjan Chapman",
  "Eugenio Mataracı",
  "Ferran Simen",
  "Filip Traverse",
  "Gilberto Mathias",
  "Ige Behringer",
  "Ilkin Urbano",
  "Kazuhiko Atallah",
  "Kumar Dahl",
  "Lidiya Szekeres",
  "Lilya Stainthorpe",
  "Ludvig Milivoj",
  "Luis Moray",
  "Maja Ruoho",
  "Marcos Rudaski",
  "Narelle Moon",
  "Nova Hogarth",
  "Owen Nen",
  "Porfírio Anhanguera",
  "Queenie Zola",
  "Ramon Judah",
  "Rogerio Mccready",
  "Sami Eadwig",
  "Seren Eirian",
  "Suad Qasim",
  "Szofi Granger",
  "Tadashko Masa",
  "Tiffani Napolitani",
  "Tove Law",
  "Vittorio Cosma",
  "Xenia Kononova",
  "Yezen Al-Qudsi",
] as const;

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
  importReferences: async (limit: number) =>
    (await getElectronApi().xttsImportReference({
      limit,
    })) as XttsVoiceReference[],
  generate: async (request: XttsVoiceRequest) =>
    (await getElectronApi().xttsGenerate(
      request as unknown as Record<string, unknown>,
    )) as XttsVoiceResult,
  cancel: async (requestId: string) =>
    getElectronApi().xttsCancel({ requestId }),
  showInFolder: async (localPath: string) =>
    getElectronApi().xttsShowInFolder({ filePath: localPath }),
  onProgress: (callback: (progress: XttsVoiceProgress) => void) =>
    getElectronApi().onXttsProgress((payload) => {
      callback({
        requestId: String(payload.requestId || ""),
        event: String(payload.event || ""),
        segmentIndex: Number(payload.segmentIndex || 0),
        totalSegments: Number(payload.totalSegments || 0),
        completedSegments: Number(payload.completedSegments || 0),
        resumedSegments: Number(payload.resumedSegments || 0),
      });
    }),
};
