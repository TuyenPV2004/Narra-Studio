import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type XttsVoiceRequest, voiceApi } from "@/services/electron-api/voice";
import { readStorageJson, writeStorageValue } from "@/storage/safe-storage";
import { storageKeys } from "@/storage/keys";

export interface VoiceQueueTask {
  error?: string;
  fileUrl?: string;
  filename?: string;
  id: string;
  localPath?: string;
  progress?: {
    completedSegments: number;
    resumedSegments: number;
    totalSegments: number;
  };
  request?: XttsVoiceRequest;
  snapshot: Omit<XttsVoiceRequest, "requestId">;
  status: "error" | "processing" | "queued" | "success";
}

const restore = (): VoiceQueueTask[] => {
  localStorage.removeItem("narra-source-voice-queue-history-v1");
  return readStorageJson<VoiceQueueTask[]>(storageKeys.voiceQueueHistory, [])
    .filter(
      (task) =>
        task &&
        typeof task.id === "string" &&
        task.snapshot &&
        ["success", "error", "processing", "queued"].includes(task.status),
    )
    .map((task) => {
      const legacyReference = task.snapshot.referencePath;
      const referencePaths = Array.isArray(task.snapshot.referencePaths)
        ? task.snapshot.referencePaths
        : legacyReference
          ? [legacyReference]
          : [];
      const interrupted =
        task.status === "processing" || task.status === "queued";
      return {
        ...task,
        snapshot: { ...task.snapshot, referencePaths },
        ...(interrupted
          ? {
              status: "error" as const,
              error:
                "Tác vụ bị gián đoạn. Bấm Thử lại để tiếp tục từ đoạn đã hoàn thành.",
            }
          : {}),
      };
    })
    .slice(0, 40);
};

function useVoiceQueueState() {
  const [tasks, setTasks] = useState<VoiceQueueTask[]>(restore);
  const [epoch, setEpoch] = useState(0);
  const processing = useRef(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(
    () =>
      voiceApi.onProgress((progress) => {
        setTasks((current) =>
          current.map((task) =>
            task.id === progress.requestId
              ? {
                  ...task,
                  progress: {
                    completedSegments: progress.completedSegments,
                    resumedSegments: progress.resumedSegments,
                    totalSegments: progress.totalSegments,
                  },
                }
              : task,
          ),
        );
      }),
    [],
  );

  useEffect(() => {
    const history = tasks
      .slice(0, 40)
      .map(({ request: _request, ...task }) => task);
    writeStorageValue(storageKeys.voiceQueueHistory, JSON.stringify(history));
  }, [tasks]);

  useEffect(() => {
    if (processing.current) return;
    const next = tasks.find((task) => task.status === "queued" && task.request);
    if (!next?.request) return;
    processing.current = true;
    setTasks((current) =>
      current.map((task) =>
        task.id === next.id ? { ...task, status: "processing" } : task,
      ),
    );
    void voiceApi
      .generate(next.request)
      .then((result) => {
        setTasks((current) =>
          current.map((task) =>
            task.id === next.id
              ? (() => {
                  const {
                    progress: _progress,
                    request: _request,
                    ...rest
                  } = task;
                  return {
                    ...rest,
                    status: "success",
                    fileUrl: result.fileUrl,
                    filename: result.filename,
                    localPath: result.localPath,
                  };
                })()
              : task,
          ),
        );
      })
      .catch((error) => {
        setTasks((current) =>
          current.map((task) =>
            task.id === next.id
              ? (() => {
                  const { request: _request, ...rest } = task;
                  return {
                    ...rest,
                    status: "error",
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                })()
              : task,
          ),
        );
      })
      .finally(() => {
        processing.current = false;
        setEpoch((value) => value + 1);
      });
  }, [epoch, tasks]);

  const enqueue = useCallback(
    (snapshot: Omit<XttsVoiceRequest, "requestId">) => {
      const active = tasksRef.current.filter(
        (task) => task.status === "queued" || task.status === "processing",
      ).length;
      if (active >= 20) return false;
      const id = crypto.randomUUID();
      const request = { ...snapshot, requestId: id };
      const next: VoiceQueueTask[] = [
        { id, request, snapshot, status: "queued" },
        ...tasksRef.current,
      ];
      tasksRef.current = next;
      setTasks(next);
      return true;
    },
    [],
  );

  const retry = useCallback((id: string) => {
    const active = tasksRef.current.filter(
      (task) => task.status === "queued" || task.status === "processing",
    ).length;
    if (active >= 20) return false;
    const next = tasksRef.current.map((task): VoiceQueueTask =>
      task.id === id
        ? {
            id: task.id,
            snapshot: task.snapshot,
            request: { ...task.snapshot, requestId: task.id },
            status: "queued",
          }
        : task,
    );
    tasksRef.current = next;
    setTasks(next);
    return true;
  }, []);

  const remove = useCallback(async (task: VoiceQueueTask) => {
    if (task.status !== "success") await voiceApi.cancel(task.id);
    setTasks((current) =>
      current.filter((candidate) => candidate.id !== task.id),
    );
  }, []);

  const clearFinished = useCallback(() => {
    const failedIds = tasksRef.current
      .filter((task) => task.status === "error")
      .map((task) => task.id);
    void Promise.allSettled(failedIds.map((id) => voiceApi.cancel(id)));
    setTasks((current) =>
      current.filter(
        (task) => task.status === "queued" || task.status === "processing",
      ),
    );
  }, []);

  return { clearFinished, enqueue, remove, retry, tasks };
}

type VoiceQueueContextValue = ReturnType<typeof useVoiceQueueState>;
const VoiceQueueContext = createContext<VoiceQueueContextValue | null>(null);

export function VoiceQueueProvider({ children }: { children: ReactNode }) {
  const value = useVoiceQueueState();
  return createElement(VoiceQueueContext.Provider, { value }, children);
}

export function useVoiceQueue() {
  const value = useContext(VoiceQueueContext);
  if (!value)
    throw new Error("useVoiceQueue must be used within VoiceQueueProvider");
  return value;
}
