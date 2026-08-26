import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage } from "@/services/electron-api/agent";
import {
  normalizeConversation,
  parseConversationPackage,
  type AgentConversation,
} from "@/services/electron-api/agent-conversations";
import { historyApi } from "@/services/electron-api/history";

const LIBRARY_KEY = "ai-agent-conversations-v2";
const SOURCE_KEY = "ai-agent-source-chat-v1";
const SOURCE_VERSION = 1;
const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES = 80;

const createConversation = (
  welcome: AgentMessage,
  title = "New Dialogue",
): AgentConversation => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [welcome],
    savedAt: now,
    updatedAt: now,
    kind: "campaign",
    aspect: "landscape",
    plan: null,
    runItems: [],
    assets: [],
    canvasGroups: [],
  };
};

const readSourceSnapshot = (
  value: unknown,
  welcome: AgentMessage,
): AgentConversation | undefined => {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object")
    return undefined;
  const snapshot = value[0] as Record<string, unknown>;
  if (snapshot.version !== SOURCE_VERSION || !Array.isArray(snapshot.messages))
    return undefined;
  const candidate = createConversation(welcome, "Source recovery chat");
  return normalizeConversation({
    ...candidate,
    messages: snapshot.messages,
    updatedAt:
      typeof snapshot.updatedAt === "number" ? snapshot.updatedAt : Date.now(),
  });
};

export function useAgentConversationLibrary(welcomeMessage: AgentMessage) {
  const initial = useMemo(
    () => createConversation(welcomeMessage),
    [welcomeMessage],
  );
  const [conversations, setConversations] = useState<AgentConversation[]>([
    initial,
  ]);
  const [activeId, setActiveId] = useState(initial.id);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string>();
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const activeConversation =
    conversations.find((item) => item.id === activeId) ??
    conversations[0] ??
    initial;
  const messages = activeConversation.messages;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      historyApi.load(LIBRARY_KEY),
      historyApi.load(SOURCE_KEY),
    ])
      .then(([libraryValue, sourceValue]) => {
        if (cancelled) return;
        const library = (Array.isArray(libraryValue) ? libraryValue : [])
          .map(normalizeConversation)
          .filter((item): item is AgentConversation => Boolean(item));
        const fallback = readSourceSnapshot(sourceValue, welcomeMessage);
        const next = library.length
          ? library
          : fallback
            ? [fallback]
            : [createConversation(welcomeMessage)];
        setConversations(next);
        setActiveId(next[0]!.id);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPersistenceError(
            error instanceof Error ? error.message : String(error),
          );
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [welcomeMessage]);

  useEffect(() => {
    if (!hydrated) return;
    const library = conversations.slice(0, MAX_CONVERSATIONS);
    const sourceSnapshot = {
      messages: messages.slice(-200),
      updatedAt: Date.now(),
      version: SOURCE_VERSION,
    };
    persistenceQueue.current = persistenceQueue.current
      .catch(() => undefined)
      .then(async () => {
        await Promise.all([
          historyApi.save(LIBRARY_KEY, library),
          historyApi.save(SOURCE_KEY, [sourceSnapshot]),
        ]);
      });
    void persistenceQueue.current
      .then(() => setPersistenceError(undefined))
      .catch((error: unknown) =>
        setPersistenceError(
          error instanceof Error ? error.message : String(error),
        ),
      );
  }, [conversations, hydrated]);

  const setMessages = useCallback(
    (value: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[])) => {
      setConversations((items) =>
        items.map((item) => {
          if (item.id !== activeId) return item;
          const next =
            typeof value === "function" ? value(item.messages) : value;
          return {
            ...item,
            messages: next.slice(-MAX_MESSAGES),
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeId],
  );
  const clearConversation = useCallback(async () => {
    setMessages([welcomeMessage]);
    setPersistenceError(undefined);
  }, [setMessages, welcomeMessage]);
  const newConversation = useCallback(() => {
    const next = createConversation(welcomeMessage);
    setConversations((items) => [next, ...items]);
    setActiveId(next.id);
  }, [welcomeMessage]);
  const selectConversation = useCallback((id: string) => setActiveId(id), []);
  const renameConversation = useCallback(
    (title: string) =>
      setConversations((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                title: title.trim() || item.title,
                updatedAt: Date.now(),
              }
            : item,
        ),
      ),
    [activeId],
  );
  const deleteConversation = useCallback(() => {
    setConversations((items) => {
      const remaining = items.filter((item) => item.id !== activeId);
      const next = remaining.length
        ? remaining
        : [createConversation(welcomeMessage)];
      setActiveId(next[0]!.id);
      return next;
    });
  }, [activeId, welcomeMessage]);
  const importConversation = useCallback(async (file: File) => {
    const imported = parseConversationPackage(await file.text());
    setConversations((items) =>
      [imported, ...items].slice(0, MAX_CONVERSATIONS),
    );
    setActiveId(imported.id);
  }, []);

  return {
    activeConversation,
    activeId,
    clearConversation,
    conversations,
    deleteConversation,
    hydrated,
    importConversation,
    messages,
    newConversation,
    persistenceError,
    renameConversation,
    selectConversation,
    setMessages,
  };
}
