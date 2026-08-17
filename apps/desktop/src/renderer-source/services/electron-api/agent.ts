import { getElectronApi } from "@/services/electron-api/client";

export interface AgentMessage extends Record<string, unknown> {
  content: string;
  role: "assistant" | "user";
}
export type ScriptStage =
  "confirm-camera" | "prepare-assets" | "synthesize-prompts";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
export const agentApi = {
  analyzeVideoStory: (source: string) =>
    getElectronApi().avisAnalyzeVideoStory({ source }),
  cancelScriptStage: (progressId: string) =>
    getElectronApi().avisCancelScriptStage({ progressId }),
  async chat(message: string, history: AgentMessage[]): Promise<string> {
    const response = record(
      await getElectronApi().aiAgentChat({ message, history, hasPlan: false }),
    );
    if (typeof response.reply !== "string" || !response.reply.trim())
      throw new Error("AI Agent không trả về nội dung.");
    return response.reply.trim();
  },
  async chatStream(
    message: string,
    history: AgentMessage[],
    onDelta: (content: string) => void,
  ): Promise<string> {
    const requestId = `agent-${Date.now()}-${crypto.randomUUID()}`;
    let content = "";
    const stream = getElectronApi().aiAgentChatStream(
      { requestId, message, history, hasPlan: false },
      (payload) => {
        const event = record(payload);
        if (event.type === "delta" && typeof event.delta === "string") {
          content += event.delta;
          onDelta(content);
        }
        if (event.type === "done" && typeof event.reply === "string") {
          content = event.reply;
          onDelta(content);
        }
      },
    );
    const result = record(await stream.promise);
    const reply =
      typeof result.reply === "string" ? result.reply.trim() : content.trim();
    if (!reply) throw new Error("AI Agent không trả về nội dung.");
    return reply;
  },
  intent: (message: string, history: AgentMessage[] = []) =>
    getElectronApi().aiAgentIntent({
      message,
      history,
      hasReference: false,
      hasPriorImage: false,
    }),
  deepAnalyze: (brief: string) =>
    getElectronApi().aiAgentDeepAnalyze({
      brief,
      localAnalysis: {},
      references: [],
    }),
  workflow: (
    brief: string,
    finalInstruction: string,
    kind: "campaign" | "image" | "video",
    aspect: "landscape" | "portrait",
  ) =>
    getElectronApi().aiAgentWorkflow({
      brief,
      finalInstruction,
      kind,
      aspect,
      expectedImageCount: null,
      expectedVideoCount: null,
    }),
  polishWorkflow: (brief: string, finalInstruction: string, plan: unknown) =>
    getElectronApi().aiAgentPolishWorkflow({ brief, finalInstruction, plan }),
  reviewOutput: (
    prompt: string,
    outputKind: "image" | "video",
    outputUrl: string,
  ) => getElectronApi().aiAgentReviewOutput({ prompt, outputKind, outputUrl }),
  runScriptStage(
    stage: ScriptStage,
    input: { project?: unknown; script?: string; shots?: unknown[] },
    progressId: string,
    onProgress: (payload: unknown) => void,
  ) {
    return getElectronApi().avisGenerateScriptStage(
      {
        stage,
        progressId,
        ...(stage === "confirm-camera"
          ? { script: input.script || "" }
          : stage === "prepare-assets"
            ? { project: input.project }
            : {
                project: input.project,
                shots: input.shots || [],
                synthesisMode: "intelligent",
              }),
      },
      onProgress,
    );
  },
  async generateNote(instruction: string): Promise<string> {
    const response = record(
      await getElectronApi().avisGenerateNoteText({
        instruction,
        references: [],
      }),
    );
    if (typeof response.text !== "string" || !response.text.trim())
      throw new Error("Cloud AI không trả nội dung ghi chú.");
    return response.text.trim();
  },
  async generateAudio(text: string): Promise<{ jobId: string; src: string }> {
    const voiceResponse = await getElectronApi().avisListAudioVoices({
      language: "vi",
    });
    const responseRecord = record(voiceResponse);
    const rawVoices = Array.isArray(voiceResponse)
      ? voiceResponse
      : Array.isArray(responseRecord.voices)
        ? responseRecord.voices
        : [];
    const voice = rawVoices
      .map(record)
      .find((item) => typeof item.voiceType === "string");
    if (!voice || typeof voice.voiceType !== "string")
      throw new Error("Cloud AI chưa có giọng đọc phù hợp.");
    let response = record(
      await getElectronApi().avisCreateAudio({
        product: "text-to-speech",
        text,
        voiceType: voice.voiceType,
        format: "mp3",
        enableLanguageDetector: true,
      }),
    );
    const generationId =
      typeof response.generationId === "string" ? response.generationId : "";
    if (!generationId)
      throw new Error("Cloud AI không trả generationId audio.");
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (response.status === "done" && typeof response.audioUrl === "string")
        return { jobId: generationId, src: response.audioUrl };
      if (response.status === "error")
        throw new Error(
          typeof response.error === "string"
            ? response.error
            : "Cloud AI tạo audio thất bại.",
        );
      await wait(2_500);
      response = record(await getElectronApi().avisPollAudio({ generationId }));
    }
    throw new Error("Hết thời gian chờ Cloud AI tạo audio.");
  },
};
