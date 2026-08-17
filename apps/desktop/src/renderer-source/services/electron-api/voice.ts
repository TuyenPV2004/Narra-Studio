import { getElectronApi } from "@/services/electron-api/client";

export interface FlowVoice {
  baseVoice?: string;
  description?: string;
  mediaId: string;
  name: string;
  sampleUrl?: string;
  slotId: number;
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const voiceApi = {
  async listVoices(): Promise<FlowVoice[]> {
    const slots = await getElectronApi().getAllSlots();
    const connected = Array.isArray(slots)
      ? slots
          .map(record)
          .find(
            (slot) =>
              slot.status === "connected" && slot.hasBearerToken === true,
          )
      : undefined;
    const slotId = typeof connected?.id === "number" ? connected.id : 0;
    const project = record(
      await getElectronApi().getFlowProjectInitialData({ slotId }),
    );
    return (Array.isArray(project.voices) ? project.voices : [])
      .map(record)
      .flatMap((voice) => {
        if (typeof voice.mediaId !== "string" || typeof voice.name !== "string")
          return [];
        return [
          {
            mediaId: voice.mediaId,
            name: voice.name,
            slotId,
            ...(typeof voice.baseVoice === "string"
              ? { baseVoice: voice.baseVoice }
              : {}),
            ...(typeof voice.description === "string"
              ? { description: voice.description }
              : {}),
            ...(typeof voice.sampleUrl === "string"
              ? { sampleUrl: voice.sampleUrl }
              : {}),
          },
        ];
      });
  },
  async generate(dialog: string, voice: FlowVoice) {
    const response = record(
      await getElectronApi().generateFlowVoicePreview({
        dialog,
        voicePerformance: voice.description || "",
        voiceName: voice.name,
        baseVoice: voice.baseVoice || voice.name,
        slotId: voice.slotId,
      }),
    );
    const generated = record(response.voice);
    if (typeof generated.sampleUrl !== "string")
      throw new Error("Google Flow chưa trả về audio voice.");
    return {
      mediaId:
        typeof generated.mediaId === "string"
          ? generated.mediaId
          : `flow-voice-${Date.now()}`,
      sampleUrl: generated.sampleUrl,
    };
  },
  async save(sampleUrl: string, filename: string): Promise<void> {
    const response = await fetch(sampleUrl);
    if (!response.ok)
      throw new Error(`Không thể tải audio (${response.status}).`);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const mimeType = blob.type || "audio/mpeg";
    const extension = mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("ogg")
        ? "ogg"
        : "mp3";
    const safeName =
      filename
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "-")
        .slice(0, 80) || "narra-voice";
    await getElectronApi().saveFileDialog({
      data: btoa(binary),
      filename: `${safeName}.${extension}`,
      filters: [{ name: "Audio", extensions: [extension] }],
    });
  },
};
