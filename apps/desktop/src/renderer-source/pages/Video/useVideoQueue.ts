import { useCallback, useEffect, useRef, useState } from "react";
import type {
  VideoGenerationRequest,
  VideoGenerationResult,
} from "@/services/electron-api/video";
import { readStorageJson, writeStorageValue } from "@/storage/safe-storage";
import { storageKeys } from "@/storage/keys";

export interface VideoQueueTask {
  error?: string;
  id: string;
  mediaId?: string;
  postError?: string | undefined;
  prompt: string;
  request?: VideoGenerationRequest;
  slotId?: number;
  src?: string;
  status: "error" | "processing" | "queued" | "success";
}

const restoredTasks = () =>
  readStorageJson<VideoQueueTask[]>(storageKeys.videoQueueHistory, [])
    .filter(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.prompt === "string" &&
        (task.status === "success" || task.status === "error"),
    )
    .slice(0, 40);

export function useVideoQueue(
  execute: (request: VideoGenerationRequest) => Promise<VideoGenerationResult>,
) {
  const [tasks, setTasks] = useState<VideoQueueTask[]>(restoredTasks);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const processing = useRef(false);

  useEffect(() => {
    const history = tasks
      .filter((task) => task.status === "success" || task.status === "error")
      .slice(0, 40)
      .map(({ request: _request, ...task }) => task);
    writeStorageValue(storageKeys.videoQueueHistory, JSON.stringify(history));
  }, [tasks]);
  useEffect(() => {
    if (paused || processing.current) return;
    const next = tasks.find((task) => task.status === "queued" && task.request);
    if (!next?.request) return;
    processing.current = true;
    setTasks((current) =>
      current.map((task) =>
        task.id === next.id ? { ...task, status: "processing" } : task,
      ),
    );
    void execute(next.request)
      .then((result) => {
        setTasks((current) =>
          current.map((task) => {
            if (task.id !== next.id) return task;
            const { request: _request, error: _error, ...rest } = task;
            return {
              ...rest,
              mediaId: result.jobId,
              slotId: result.slotId,
              src: result.src,
              status: "success",
            };
          }),
        );
      })
      .catch((error) => {
        setTasks((current) =>
          current.map((task) => {
            if (task.id !== next.id) return task;
            const { request: _request, ...rest } = task;
            return {
              ...rest,
              error: error instanceof Error ? error.message : String(error),
              status: "error",
            };
          }),
        );
      })
      .finally(() => {
        processing.current = false;
        setEpoch((value) => value + 1);
      });
  }, [epoch, execute, paused, tasks]);

  const enqueue = useCallback((requests: VideoGenerationRequest[]) => {
    setTasks((current) => {
      const activeCount = current.filter(
        (task) => task.status === "processing" || task.status === "queued",
      ).length;
      return [
        ...requests.slice(0, Math.max(0, 20 - activeCount)).map((request) => ({
          id: crypto.randomUUID(),
          prompt: request.prompt,
          request,
          status: "queued" as const,
        })),
        ...current,
      ];
    });
  }, []);
  const retry = useCallback((id: string, request: VideoGenerationRequest) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== id) return task;
        const { error: _error, ...rest } = task;
        return { ...rest, request, status: "queued" };
      }),
    );
  }, []);
  const clearFinished = useCallback(
    () =>
      setTasks((current) =>
        current.filter(
          (task) => task.status === "processing" || task.status === "queued",
        ),
      ),
    [],
  );
  const updateTask = useCallback(
    (id: string, patch: Partial<VideoQueueTask>) =>
      setTasks((current) =>
        current.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      ),
    [],
  );

  return {
    clearFinished,
    enqueue,
    paused,
    retry,
    setPaused,
    tasks,
    updateTask,
  };
}
