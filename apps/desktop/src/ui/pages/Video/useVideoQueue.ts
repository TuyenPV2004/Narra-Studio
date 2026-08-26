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
import {
  type VideoGenerationRequest,
  type VideoGenerationResult,
  type VideoMode,
  videoApi,
} from "@/services/electron-api/video";
import type { ProviderId } from "@/types/electron-api";
import { readStorageJson, writeStorageValue } from "@/storage/safe-storage";
import { storageKeys } from "@/storage/keys";

export interface EnqueueResult {
  accepted: number;
  rejected: number;
}

export interface VideoQueueTask {
  aspect?: "landscape" | "portrait";
  downloadStatus?: "downloading" | "downloaded" | "failed";
  downloadMediaName?: string;
  duration?: number;
  error?: string;
  id: string;
  localPath?: string;
  mediaId?: string;
  mode?: VideoMode;
  model?: string;
  postError?: string | undefined;
  prompt: string;
  providerId?: ProviderId;
  request?: VideoGenerationRequest;
  resolution?: string;
  slotId?: number;
  src?: string;
  status: "error" | "processing" | "queued" | "success";
  thumbnailDataUrl?: string;
}

type VideoDownloadedPayload = {
  itemId: string;
  localPath: string;
  thumbnailDataUrl?: string | null;
};

const restoredTasks = (): VideoQueueTask[] =>
  readStorageJson<VideoQueueTask[]>(storageKeys.videoQueueHistory, [])
    .filter(
      (task) =>
        task &&
        typeof task.id === "string" &&
        typeof task.prompt === "string" &&
        (task.status === "success" || task.status === "error"),
    )
    .map((task): VideoQueueTask => {
      const pId = task.providerId || task.request?.providerId;
      const base: VideoQueueTask = {
        ...task,
        aspect: task.aspect || task.request?.aspect || "landscape",
        duration: task.duration || task.request?.duration || 8,
        resolution: task.resolution || task.request?.resolution || "720p",
        mode: (task.mode || task.request?.mode || "text") as VideoMode,
        model: task.model || task.request?.model || "abra_t2v",
      };
      if (pId) {
        base.providerId = pId;
      }
      if (task.localPath) {
        base.localPath = task.localPath;
        base.src = task.localPath;
      }
      if (task.downloadStatus) {
        base.downloadStatus = task.downloadStatus;
      }
      if (task.downloadMediaName) {
        base.downloadMediaName = task.downloadMediaName;
      } else if (typeof task.src === "string") {
        try {
          const mediaName = new URL(task.src).searchParams.get("name");
          if (mediaName) base.downloadMediaName = mediaName;
        } catch {
          // Legacy non-URL source cannot be used to repair a background download.
        }
      }
      if (task.thumbnailDataUrl) {
        base.thumbnailDataUrl = task.thumbnailDataUrl;
      }
      return base;
    })
    .slice(0, 40);

function useVideoQueueState(
  execute: (request: VideoGenerationRequest) => Promise<VideoGenerationResult>,
) {
  const [tasks, setTasks] = useState<VideoQueueTask[]>(restoredTasks);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const processing = useRef(false);
  const tasksRef = useRef(tasks);
  const pendingDownloads = useRef(new Map<string, VideoDownloadedPayload>());
  const pendingDownloadFailures = useRef(new Map<string, number>());
  tasksRef.current = tasks;

  useEffect(() => {
    const unsubSuccess = videoApi.onVideoDownloaded((data) => {
      pendingDownloads.current.set(data.itemId, data);
      while (pendingDownloads.current.size > 100) {
        const oldest = pendingDownloads.current.keys().next().value;
        if (typeof oldest !== "string") break;
        pendingDownloads.current.delete(oldest);
      }
      pendingDownloadFailures.current.delete(data.itemId);
      setTasks((current) =>
        current.map((task) => {
          if (task.mediaId === data.itemId || task.id === data.itemId) {
            pendingDownloads.current.delete(data.itemId);
            const base: VideoQueueTask = {
              ...task,
              localPath: data.localPath,
              src: data.localPath,
              downloadStatus: "downloaded",
            };
            if (data.thumbnailDataUrl) {
              base.thumbnailDataUrl = data.thumbnailDataUrl;
            }
            return base;
          }
          return task;
        }),
      );
    });

    const unsubFail = videoApi.onVideoDownloadFailed((data) => {
      pendingDownloadFailures.current.set(data.itemId, Date.now());
      while (pendingDownloadFailures.current.size > 100) {
        const oldest = pendingDownloadFailures.current.keys().next().value;
        if (typeof oldest !== "string") break;
        pendingDownloadFailures.current.delete(oldest);
      }
      setTasks((current) =>
        current.map((task) => {
          if (task.mediaId === data.itemId || task.id === data.itemId) {
            pendingDownloadFailures.current.delete(data.itemId);
            return {
              ...task,
              downloadStatus: "failed",
            };
          }
          return task;
        }),
      );
    });

    return () => {
      unsubSuccess?.();
      unsubFail?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unfinished = tasksRef.current.filter(
      (task) =>
        task.status === "success" &&
        task.downloadStatus === "downloading" &&
        Boolean(task.downloadMediaName && task.mediaId),
    );
    for (const task of unfinished) {
      const downloadMediaName = task.downloadMediaName;
      const itemId = task.mediaId;
      if (!downloadMediaName || !itemId) continue;
      void videoApi
        .resolveDownloadedVideo(downloadMediaName)
        .then(async (localPath) => {
          if (cancelled) return;
          if (localPath) {
            setTasks((current) =>
              current.map((candidate) =>
                candidate.id === task.id
                  ? {
                      ...candidate,
                      localPath,
                      src: localPath,
                      downloadStatus: "downloaded",
                    }
                  : candidate,
              ),
            );
            return;
          }
          await videoApi.retryDownload(
            downloadMediaName,
            itemId,
            task.slotId ?? 0,
          );
        })
        .catch(() => {
          if (cancelled) return;
          setTasks((current) =>
            current.map((candidate) =>
              candidate.id === task.id
                ? { ...candidate, downloadStatus: "failed" }
                : candidate,
            ),
          );
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const history = tasks
      .filter((task) => task.status === "success" || task.status === "error")
      .slice(0, 40)
      .map(({ request: _request, ...task }) => task);
    writeStorageValue(storageKeys.videoQueueHistory, JSON.stringify(history));
  }, [tasks]);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKeys.videoQueueHistory) return;
      setTasks((current) => {
        const hasActiveTask = current.some(
          (task) => task.status === "processing" || task.status === "queued",
        );
        return hasActiveTask ? current : restoredTasks();
      });
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
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
        const downloaded = pendingDownloads.current.get(result.jobId);
        const downloadFailed = pendingDownloadFailures.current.has(
          result.jobId,
        );
        pendingDownloads.current.delete(result.jobId);
        pendingDownloadFailures.current.delete(result.jobId);
        setTasks((current) =>
          current.map((task) => {
            if (task.id !== next.id) return task;
            const { request: _request, error: _error, ...rest } = task;
            return {
              ...rest,
              mediaId: result.jobId,
              downloadMediaName: result.downloadMediaName,
              slotId: result.slotId,
              src: downloaded ? downloaded.localPath : result.src,
              status: "success",
              downloadStatus: downloaded
                ? "downloaded"
                : downloadFailed
                  ? "failed"
                  : "downloading",
              ...(downloaded
                ? {
                    localPath: downloaded.localPath,
                    ...(downloaded.thumbnailDataUrl
                      ? { thumbnailDataUrl: downloaded.thumbnailDataUrl }
                      : {}),
                  }
                : {}),
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

  const enqueue = useCallback(
    (requests: VideoGenerationRequest[]): EnqueueResult => {
      const currentTasks = tasksRef.current;
      const activeCount = currentTasks.filter(
        (task) => task.status === "processing" || task.status === "queued",
      ).length;
      const available = Math.max(0, 20 - activeCount);
      const toAdd = requests.slice(0, available);
      if (toAdd.length > 0) {
        const nextTasks: VideoQueueTask[] = [
          ...toAdd.map((request) => ({
            id: crypto.randomUUID(),
            prompt: request.prompt,
            aspect: request.aspect,
            duration: request.duration,
            resolution: request.resolution,
            model: request.model,
            mode: request.mode,
            providerId: request.providerId,
            ...(typeof request.slotId === "number"
              ? { slotId: request.slotId }
              : {}),
            request,
            status: "queued" as const,
          })),
          ...currentTasks,
        ];
        // Update the synchronous snapshot before React commits so rapid
        // consecutive enqueue calls cannot both consume the same free slots.
        tasksRef.current = nextTasks;
        setTasks(nextTasks);
      }
      return {
        accepted: toAdd.length,
        rejected: Math.max(0, requests.length - toAdd.length),
      };
    },
    [],
  );
  const retry = useCallback(
    (id: string, request: VideoGenerationRequest): boolean => {
      const currentTasks = tasksRef.current;
      const target = currentTasks.find((task) => task.id === id);
      if (!target) return false;
      const activeCount = currentTasks.filter(
        (task) => task.status === "processing" || task.status === "queued",
      ).length;
      const targetAlreadyActive =
        target.status === "processing" || target.status === "queued";
      if (!targetAlreadyActive && activeCount >= 20) return false;

      const nextTasks: VideoQueueTask[] = currentTasks.map((task) => {
        if (task.id !== id) return task;
        const { error: _error, ...rest } = task;
        return {
          ...rest,
          aspect: request.aspect,
          duration: request.duration,
          resolution: request.resolution,
          model: request.model,
          mode: request.mode,
          providerId: request.providerId,
          ...(typeof request.slotId === "number"
            ? { slotId: request.slotId }
            : {}),
          request,
          status: "queued",
        };
      });
      tasksRef.current = nextTasks;
      setTasks(nextTasks);
      return true;
    },
    [],
  );
  const deleteTask = useCallback((id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id));
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
    deleteTask,
    enqueue,
    paused,
    retry,
    setPaused,
    tasks,
    updateTask,
  };
}

type VideoQueueContextValue = ReturnType<typeof useVideoQueueState>;

const VideoQueueContext = createContext<VideoQueueContextValue | null>(null);

export function VideoQueueProvider({ children }: { children: ReactNode }) {
  const queue = useVideoQueueState(videoApi.generate);
  return createElement(VideoQueueContext.Provider, { value: queue }, children);
}

export function useVideoQueue(): VideoQueueContextValue {
  const queue = useContext(VideoQueueContext);
  if (!queue) {
    throw new Error("useVideoQueue must be used within VideoQueueProvider");
  }
  return queue;
}
