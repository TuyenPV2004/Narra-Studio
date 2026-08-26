import { getElectronApi } from "@/services/electron-api/client";
import { aiProviderApi } from "@/services/electron-api/ai-providers";

export interface AgentMessage extends Record<string, unknown> {
  id?: string | undefined;
  role: "assistant" | "user" | "system";
  content: string;
  status?: "streaming" | "completed" | "cancelled" | "failed" | undefined;
  error?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  planProposal?: unknown | undefined;
}

export interface WorkflowContextPayload {
  brief?: string | undefined;
  planTitle?: string | undefined;
  runItemsCount?: number | undefined;
  kind?: string | undefined;
}

export type ScriptStage =
  "confirm-camera" | "prepare-assets" | "synthesize-prompts";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const parseJson = (value: string): unknown => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
  try {
    return JSON.parse(fenced.trim());
  } catch {
    return { text: value.trim() };
  }
};
const activeRequests = new Map<string, () => void>();

const streamChat = async (
  message: string,
  history: AgentMessage[],
  requestId: string,
  onDelta: (content: string) => void,
  onCancelReady?: (cancel: () => void) => void,
  hasPlan = false,
  workflowContext?: WorkflowContextPayload,
  onMeta?: (meta: { model?: string | undefined; source?: string | undefined }) => void,
): Promise<{ reply: string; model?: string | undefined; source?: string | undefined }> => {
  let content = "";
  const stream = getElectronApi().aiAgentChatStream(
    {
      requestId,
      message,
      history: history.filter(
        (m) => m.status !== "failed" && m.status !== "cancelled",
      ),
      hasPlan,
      workflowContext: workflowContext || null,
    },
    (payload) => {
      const event = record(payload);
      if (event.type === "delta" && typeof event.delta === "string") {
        content += event.delta;
        onDelta(content);
        if (onMeta && (event.model || event.source)) {
          onMeta({
            model: typeof event.model === "string" ? event.model : undefined,
            source: typeof event.source === "string" ? event.source : undefined,
          });
        }
      }
      if (event.type === "done" && typeof event.reply === "string") {
        content = event.reply;
        onDelta(content);
        if (onMeta && (event.model || event.source)) {
          onMeta({
            model: typeof event.model === "string" ? event.model : undefined,
            source: typeof event.source === "string" ? event.source : undefined,
          });
        }
      }
    },
  );

  const abortLocalAndRemote = () => {
    stream.cancel();
    getElectronApi().aiAgentChatCancel({ requestId }).catch(() => {});
  };

  activeRequests.set(requestId, abortLocalAndRemote);
  if (onCancelReady) {
    onCancelReady(abortLocalAndRemote);
  }
  try {
    const result = record(await stream.promise);
    const reply =
      typeof result.reply === "string" ? result.reply.trim() : content.trim();
    if (!reply) throw new Error("AI Agent không trả về nội dung.");
    return {
      reply,
      model: typeof result.model === "string" ? result.model : undefined,
      source: typeof result.source === "string" ? result.source : undefined,
    };
  } finally {
    activeRequests.delete(requestId);
  }
};

const genericPrompt = (instruction: string, context: unknown) =>
  `${instruction}\n\nReturn concise JSON when structured output is requested. Context:\n${JSON.stringify(context)}`;

export const agentApi = {
  async chat(
    message: string,
    history: AgentMessage[],
    hasPlan = false,
    workflowContext?: WorkflowContextPayload,
  ): Promise<string> {
    const response = record(
      await getElectronApi().aiAgentChat({
        message,
        history,
        hasPlan,
        workflowContext: workflowContext || null,
      }),
    );
    if (typeof response.reply !== "string" || !response.reply.trim())
      throw new Error("AI Agent không trả về nội dung.");
    return response.reply.trim();
  },

  async chatStream(
    message: string,
    history: AgentMessage[],
    onDelta: (content: string) => void,
    onCancelReady?: (cancel: () => void) => void,
    hasPlan = false,
    workflowContext?: WorkflowContextPayload,
    onMeta?: (meta: { model?: string | undefined; source?: string | undefined }) => void,
  ): Promise<{ reply: string; model?: string | undefined; source?: string | undefined }> {
    return streamChat(
      message,
      history,
      `agent-${Date.now()}-${crypto.randomUUID()}`,
      onDelta,
      onCancelReady,
      hasPlan,
      workflowContext,
      onMeta,
    );
  },

  cancelChat(requestId?: string) {
    if (requestId && activeRequests.has(requestId)) {
      activeRequests.get(requestId)?.();
      activeRequests.delete(requestId);
      getElectronApi().aiAgentChatCancel({ requestId }).catch(() => {});
    } else {
      for (const [id, cancel] of activeRequests.entries()) {
        try {
          cancel();
        } catch {
          // ignore
        }
        activeRequests.delete(id);
        getElectronApi().aiAgentChatCancel({ requestId: id }).catch(() => {});
      }
    }
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

  async runScriptStage(
    stage: ScriptStage,
    input: { project?: unknown; script?: string; shots?: unknown[] },
    progressId: string,
    onProgress: (payload: unknown) => void,
  ) {
    const { reply } = await streamChat(
      genericPrompt(
        `Perform the ${stage} stage for a video script. Preserve existing fields and return a JSON object with the updated project.`,
        {
          project: input.project,
          script: input.script || "",
          shots: input.shots || [],
        },
      ),
      [],
      progressId,
      (content) =>
        onProgress({
          progressId,
          shots: input.shots?.length || 0,
          chars: content.length,
        }),
    );
    onProgress({
      progressId,
      shots: input.shots?.length || 0,
      chars: reply.length,
    });
    return { data: parseJson(reply), text: reply };
  },

  cancelScriptStage: async (progressId: string) => {
    const stream = activeRequests.get(progressId);
    if (!stream) return { cancelled: false };
    stream();
    activeRequests.delete(progressId);
    return { cancelled: true };
  },

  analyzeVideoStory: async (_source: string) => {
    throw new Error(
      "Video Story cần pipeline media riêng và chưa được hỗ trợ bởi provider text generic.",
    );
  },

  async generateNote(instruction: string): Promise<string> {
    return (
      await this.chat(
        genericPrompt("Write a concise note.", { instruction }),
        [],
      )
    ).trim();
  },

  async generateAudio(text: string): Promise<{ jobId: string; src: string }> {
    const jobId = `local-piper-${Date.now()}-${crypto.randomUUID()}`;
    const ttsProvider = await aiProviderApi.active("text-to-speech");
    const response = record(
      await getElectronApi().textToSpeech({
        text,
        provider: ttsProvider ? "custom-provider" : "local-piper",
        language: "vi",
        progressTag: jobId,
      }),
    );
    const src =
      typeof response.audio_url === "string" ? response.audio_url : "";
    if (!src) throw new Error("Local Piper không trả về file audio.");
    return { jobId, src };
  },
};
