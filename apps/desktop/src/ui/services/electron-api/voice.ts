import { getElectronApi } from "@/services/electron-api/client";

export type XttsVoiceMode = "preset" | "clone";
export interface XttsVoiceReference {
  fileUrl: string;
  id: string;
  localPath: string;
  name: string;
}
export interface XttsReferenceReleaseResult {
  removed: number;
}
export interface XttsVoiceRequest {
  language: string;
  mode: XttsVoiceMode;

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

export type XttsPresetVoiceGender = "female" | "male";
export type XttsPresetVoiceUseCase =
  | "Kể chuyện"
  | "Tài liệu"
  | "Giáo dục"
  | "Nhân vật"
  | "Giải trí"
  | "Mạng xã hội"
  | "Quảng cáo";

export interface XttsPresetVoice {
  gender: XttsPresetVoiceGender;
  name: string;
  useCases: readonly XttsPresetVoiceUseCase[];
}

export const XTTS_PRESET_VOICES = [
  {
    name: "Claribel Dervla",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Daisy Studious",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  { name: "Gracie Wise", gender: "female", useCases: ["Nhân vật", "Giải trí"] },
  { name: "Tammie Ema", gender: "female", useCases: ["Nhân vật", "Giải trí"] },
  {
    name: "Alison Dietlinde",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Ana Florence",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Annmarie Nele",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  { name: "Asya Anara", gender: "female", useCases: ["Nhân vật", "Giải trí"] },
  {
    name: "Brenda Stern",
    gender: "female",
    useCases: ["Mạng xã hội", "Quảng cáo"],
  },
  {
    name: "Gitta Nikolina",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Henriette Usha",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Sofia Hellen",
    gender: "female",
    useCases: ["Mạng xã hội", "Quảng cáo"],
  },
  {
    name: "Tammy Grit",
    gender: "female",
    useCases: ["Quảng cáo", "Mạng xã hội"],
  },
  {
    name: "Tanja Adelina",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Vjollca Johnnie",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Andrew Chipper",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Badr Odhiambo",
    gender: "female",
    useCases: ["Nhân vật", "Mạng xã hội"],
  },
  {
    name: "Dionisio Schuyler",
    gender: "male",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Royston Min",
    gender: "male",
    useCases: ["Mạng xã hội", "Nhân vật"],
  },
  { name: "Viktor Eka", gender: "male", useCases: ["Giải trí", "Nhân vật"] },
  {
    name: "Abrahan Mack",
    gender: "male",
    useCases: ["Mạng xã hội", "Quảng cáo"],
  },
  {
    name: "Adde Michal",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Baldur Sanjin",
    gender: "male",
    useCases: ["Mạng xã hội", "Nhân vật"],
  },
  { name: "Craig Gutsy", gender: "male", useCases: ["Nhân vật", "Giải trí"] },
  { name: "Damien Black", gender: "male", useCases: ["Nhân vật", "Giải trí"] },
  {
    name: "Gilberto Mathias",
    gender: "male",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Ilkin Urbano",
    gender: "male",
    useCases: ["Nhân vật", "Kể chuyện", "Tài liệu"],
  },
  {
    name: "Kazuhiko Atallah",
    gender: "male",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Ludvig Milivoj",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Quảng cáo"],
  },
  {
    name: "Suad Qasim",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Torcull Diarmuid",
    gender: "male",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Viktor Menelaos",
    gender: "male",
    useCases: ["Giải trí", "Nhân vật"],
  },
  {
    name: "Zacharie Aimilios",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Nova Hogarth",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Maja Ruoho",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Uta Obando",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Lidiya Szekeres",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Chandra MacFarland",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Szofi Granger",
    gender: "female",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Camilla Holmström",
    gender: "female",
    useCases: ["Nhân vật", "Mạng xã hội"],
  },
  {
    name: "Lilya Stainthorpe",
    gender: "female",
    useCases: ["Giải trí", "Nhân vật"],
  },
  {
    name: "Zofija Kendrick",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Narelle Moon",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Barbora MacLean",
    gender: "female",
    useCases: ["Mạng xã hội", "Nhân vật"],
  },
  {
    name: "Alexandra Hisakawa",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  { name: "Alma María", gender: "female", useCases: ["Nhân vật", "Giải trí"] },
  {
    name: "Rosemary Okafor",
    gender: "female",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Ige Behringer",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Filip Traverse",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Giáo dục"],
  },
  {
    name: "Damjan Chapman",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Wulf Carlevaro",
    gender: "male",
    useCases: ["Mạng xã hội", "Quảng cáo"],
  },
  {
    name: "Aaron Dreschner",
    gender: "male",
    useCases: ["Nhân vật", "Giải trí"],
  },
  {
    name: "Kumar Dahl",
    gender: "male",
    useCases: ["Nhân vật", "Kể chuyện", "Tài liệu"],
  },
  {
    name: "Eugenio Mataracı",
    gender: "male",
    useCases: ["Nhân vật", "Mạng xã hội"],
  },
  { name: "Ferran Simen", gender: "male", useCases: ["Nhân vật", "Giải trí"] },
  {
    name: "Xavier Hayasaka",
    gender: "male",
    useCases: ["Mạng xã hội", "Quảng cáo"],
  },
  {
    name: "Luis Moray",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Nhân vật"],
  },
  {
    name: "Marcos Rudaski",
    gender: "male",
    useCases: ["Kể chuyện", "Tài liệu", "Quảng cáo"],
  },
] as const satisfies readonly XttsPresetVoice[];

export const XTTS_DEFAULT_SPEAKERS = XTTS_PRESET_VOICES.map(({ name }) => name);

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
  importReferences: async (limit: number) =>
    (await getElectronApi().xttsImportReference({
      limit,
    })) as XttsVoiceReference[],
  releaseReferences: async (referencePaths: string[]) =>
    (await getElectronApi().xttsReleaseReferences({
      referencePaths,
    })) as XttsReferenceReleaseResult,
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
