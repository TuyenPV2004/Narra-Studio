import { getElectronApi } from "@/services/electron-api/client";
import type { AgentMessage } from "@/services/electron-api/agent";

export interface AgentConversation extends Record<string, unknown> {
  id: string;
  title: string;
  messages: AgentMessage[];
  savedAt: number;
  updatedAt: number;
  kind: "campaign" | "image" | "video";
  aspect: "landscape" | "portrait";
  plan: unknown;
  runItems: unknown[];
  assets: unknown[];
  canvasGroups: unknown[];
  pinned?: boolean;
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const isMessage = (value: unknown): value is AgentMessage => {
  const item = object(value);
  return (
    (item.role === "assistant" || item.role === "user") &&
    typeof item.content === "string"
  );
};
const kind = (value: unknown): AgentConversation["kind"] =>
  value === "image" || value === "video" ? value : "campaign";
const aspect = (value: unknown): AgentConversation["aspect"] =>
  value === "portrait" ? "portrait" : "landscape";

export const normalizeConversation = (
  value: unknown,
): AgentConversation | undefined => {
  const item = object(value);
  const messages = Array.isArray(item.messages)
    ? item.messages.filter(isMessage)
    : [];
  if (typeof item.id !== "string" || !messages.length) return undefined;
  const now = Date.now();
  return {
    ...item,
    id: item.id,
    title:
      typeof item.title === "string" && item.title.trim()
        ? item.title
        : "AI Agent chat",
    messages,
    savedAt: typeof item.savedAt === "number" ? item.savedAt : now,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
    kind: kind(item.kind),
    aspect: aspect(item.aspect),
    plan: item.plan ?? null,
    runItems: Array.isArray(item.runItems) ? item.runItems : [],
    assets: Array.isArray(item.assets) ? item.assets : [],
    canvasGroups: Array.isArray(item.canvasGroups) ? item.canvasGroups : [],
    ...(typeof item.pinned === "boolean" ? { pinned: item.pinned } : {}),
  };
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_IMPORT_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 50000;

export const parseConversationPackage = (text: string): AgentConversation => {
  if (text.length > MAX_IMPORT_BYTES) {
    throw new Error("Dữ liệu JSON vượt quá dung lượng cho phép (tối đa 5MB).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Định dạng file JSON không hợp lệ.");
  }
  const root = object(parsed);
  const conversation = object(root.conversation || root);
  const workflow = object(root.workflow);
  const rawMessages = Array.isArray(conversation.messages)
    ? conversation.messages
    : [];
  const messages: AgentMessage[] = [];
  for (const item of rawMessages) {
    if (messages.length >= MAX_IMPORT_MESSAGES) break;
    if (isMessage(item)) {
      const msgObj = item as Record<string, unknown>;
      messages.push({
        role: item.role,
        content: String(item.content).slice(0, MAX_MESSAGE_LENGTH),
        ...(typeof msgObj.createdAt === "number"
          ? { createdAt: msgObj.createdAt }
          : {}),
      });
    }
  }
  if (!messages.length) {
    throw new Error("File JSON không chứa tin nhắn (messages) hợp lệ.");
  }
  const now = Date.now();
  const rawTitle =
    typeof root.title === "string" && root.title.trim()
      ? root.title.trim().slice(0, 100)
      : typeof conversation.title === "string" && conversation.title.trim()
        ? conversation.title.trim().slice(0, 100)
        : "Conversation import";

  return {
    id: crypto.randomUUID(),
    title: rawTitle,
    messages,
    savedAt: now,
    updatedAt: now,
    kind: kind(conversation.kind),
    aspect: aspect(conversation.aspect),
    plan: workflow.plan ?? conversation.plan ?? null,
    runItems: Array.isArray(workflow.runItems)
      ? workflow.runItems.slice(0, 100)
      : Array.isArray(conversation.runItems)
        ? conversation.runItems.slice(0, 100)
        : [],
    assets: Array.isArray(workflow.assets)
      ? workflow.assets.slice(0, 100)
      : Array.isArray(conversation.assets)
        ? conversation.assets.slice(0, 100)
        : [],
    canvasGroups: Array.isArray(workflow.canvasGroups)
      ? workflow.canvasGroups.slice(0, 50)
      : Array.isArray(conversation.canvasGroups)
        ? conversation.canvasGroups.slice(0, 50)
        : [],
    ...(typeof conversation.pinned === "boolean"
      ? { pinned: conversation.pinned }
      : {}),
  };
};

const utf8Base64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const conversationPackageApi = {
  async export(conversation: AgentConversation) {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: "Narra Studio AI Agent",
      title: conversation.title,
      conversation: {
        id: conversation.id,
        kind: conversation.kind,
        aspect: conversation.aspect,
        messages: conversation.messages,
      },
      workflow: {
        plan: conversation.plan,
        runItems: conversation.runItems,
        assets: conversation.assets,
        canvasGroups: conversation.canvasGroups,
        concatOutput: null,
      },
      references: {
        selectedLibraryAssetIds: [],
        selectedGraphItemIds: [],
        selectedStartAssetId: null,
      },
      skill: { folders: [], selections: [] },
    };
    const safeName =
      conversation.title
        .replace(/[^a-z0-9\u00c0-\u1ef9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "ai-agent-chat";
    return getElectronApi().saveFileDialog({
      data: utf8Base64(JSON.stringify(payload, null, 2)),
      filename: `${safeName}-chat-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  },
};
