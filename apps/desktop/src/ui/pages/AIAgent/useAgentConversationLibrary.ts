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

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePersist = useCallback(
    (
      libraryList: AgentConversation[],
      currentMessages: AgentMessage[],
      immediate = false,
    ) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const doPersist = () => {
        const library = libraryList.slice(0, MAX_CONVERSATIONS);
        const sourceSnapshot = {
          messages: currentMessages.slice(-200),
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
      };

      if (immediate) {
        doPersist();
      } else {
        debounceTimerRef.current = setTimeout(doPersist, 600);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;
    schedulePersist(conversations, messages, false);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [conversations, messages, hydrated, schedulePersist]);

  const setMessages = useCallback(
    (
      value: AgentMessage[] | ((current: AgentMessage[]) => AgentMessage[]),
      immediatePersist = false,
    ) => {
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
      if (immediatePersist) {
        setTimeout(() => {
          setConversations((items) => {
            const currentItem = items.find((it) => it.id === activeId);
            schedulePersist(items, currentItem?.messages || [], true);
            return items;
          });
        }, 0);
      }
    },
    [activeId, schedulePersist],
  );

  const clearConversation = useCallback(async () => {
    setMessages([welcomeMessage], true);
    setPersistenceError(undefined);
  }, [setMessages, welcomeMessage]);

  const newConversation = useCallback(() => {
    const next = createConversation(welcomeMessage);
    const updated = [next, ...conversations];
    setConversations(updated);
    setActiveId(next.id);
    schedulePersist(updated, next.messages, true);
  }, [conversations, welcomeMessage, schedulePersist]);

  const selectConversation = useCallback((id: string) => setActiveId(id), []);

  const renameConversation = useCallback(
    (title: string) =>
      setConversations((items) =>
        items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                title,
                updatedAt: Date.now(),
              }
            : item,
        ),
      ),
    [activeId],
  );

  const normalizeActiveTitle = useCallback(() => {
    setConversations((items) =>
      items.map((item) =>
        item.id === activeId
          ? {
              ...item,
              title: item.title.trim() || "Cuộc trò chuyện",
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  }, [activeId]);

  const deleteConversation = useCallback(() => {
    const remaining = conversations.filter((item) => item.id !== activeId);
    const next = remaining.length
      ? remaining
      : [createConversation(welcomeMessage)];
    setConversations(next);
    setActiveId(next[0]!.id);
    schedulePersist(next, next[0]!.messages, true);
  }, [conversations, activeId, welcomeMessage, schedulePersist]);

  const importConversation = useCallback(
    async (file: File) => {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("File JSON vượt quá dung lượng 5MB.");
      }
      const imported = parseConversationPackage(await file.text());
      const updated = [imported, ...conversations].slice(0, MAX_CONVERSATIONS);
      setConversations(updated);
      setActiveId(imported.id);
      schedulePersist(updated, imported.messages, true);
    },
    [conversations, schedulePersist],
  );

  const latestStateRef = useRef({ conversations, messages, hydrated });
  useEffect(() => {
    latestStateRef.current = { conversations, messages, hydrated };
  }, [conversations, messages, hydrated]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        if (latestStateRef.current.hydrated) {
          schedulePersist(
            latestStateRef.current.conversations,
            latestStateRef.current.messages,
            true,
          );
        }
      }
    };
  }, [schedulePersist]);

  const updateActiveConversationWorkflow = useCallback(
    (patch: Partial<AgentConversation>) => {
      setConversations((items) => {
        const next = items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                ...patch,
                updatedAt: Date.now(),
              }
            : item,
        );
        const currentItem = next.find((it) => it.id === activeId);
        schedulePersist(next, currentItem?.messages || [], false);
        return next;
      });
    },
    [activeId, schedulePersist],
  );

  const updateActiveConversationPlan = useCallback(
    (plan: unknown, runItems?: unknown[]) => {
      setConversations((items) => {
        const next = items.map((item) =>
          item.id === activeId
            ? {
                ...item,
                plan,
                ...(Array.isArray(runItems) ? { runItems } : {}),
                updatedAt: Date.now(),
              }
            : item,
        );
        const currentItem = next.find((it) => it.id === activeId);
        schedulePersist(next, currentItem?.messages || [], true);
        return next;
      });
    },
    [activeId, schedulePersist],
  );

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
    normalizeActiveTitle,
    persistenceError,
    renameConversation,
    selectConversation,
    setMessages,
    updateActiveConversationPlan,
    updateActiveConversationWorkflow,
  };
}
