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
  formatImageError,
  imageApi,
  type ImageGenerationRequest,
  type ReferenceImageSnapshot,
} from "@/services/electron-api/image";

const MAX_ACTIVE_IMAGE_TASKS = 20;

export type ImageTaskStatus = "error" | "processing" | "queued" | "success";
export type ImageSaveStatus = "failed" | "not_saved" | "saved" | "saving";

export interface ImageQueueTask {
  aspect: string;
  error?: string | undefined;
  id: string;
  mediaId?: string | null | undefined;
  model: string;
  prompt: string;
  providerId: "veo3";
  referenceImages?: ReferenceImageSnapshot[] | undefined;
  request: ImageGenerationRequest & { slotId: number };
  savedFileUrl?: string | undefined;
  saveError?: string | undefined;
  saveStatus: ImageSaveStatus;
  slotId: number;
  src?: string | undefined;
  status: ImageTaskStatus;
}

export interface ImageEnqueueResult {
  accepted: number;
  rejected: number;
}

function useImageQueueState() {
  const [tasks, setTasks] = useState<ImageQueueTask[]>([]);
  const [epoch, setEpoch] = useState(0);
  const processing = useRef(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const replaceTasks = useCallback((next: ImageQueueTask[]) => {
    tasksRef.current = next;
    setTasks(next);
  }, []);

  useEffect(() => {
    if (processing.current) return;
    const next = tasks.find(
      (task) => task.status === "queued" && Boolean(task.request),
    );
    if (!next) return;

    processing.current = true;
    setTasks((current) =>
      current.map((task) =>
        task.id === next.id ? { ...task, status: "processing" } : task,
      ),
    );

    void imageApi
      .generate(next.request)
      .then(async (result) => {
        setTasks((current) =>
          current.map((task) =>
            task.id === next.id
              ? {
                  ...task,
                  mediaId: result.mediaId,
                  saveError: undefined,
                  saveStatus: "saving",
                  slotId: result.slotId,
                  src: result.src,
                  status: "success",
                }
              : task,
          ),
        );

        const saveResult = await imageApi.save(result.src, result.slotId);
        setTasks((current) =>
          current.map((task) =>
            task.id !== next.id
              ? task
              : saveResult.saved
                ? {
                    ...task,
                    savedFileUrl: saveResult.path,
                    saveError: undefined,
                    saveStatus: "saved",
                  }
                : {
                    ...task,
                    saveError: saveResult.error,
                    saveStatus: "failed",
                  },
          ),
        );
      })
      .catch((error) => {
        setTasks((current) =>
          current.map((task) =>
            task.id === next.id
              ? {
                  ...task,
                  error: formatImageError(error),
                  saveStatus: "not_saved",
                  status: "error",
                }
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
    (
      requests: Array<ImageGenerationRequest & { slotId: number }>,
    ): ImageEnqueueResult => {
      const current = tasksRef.current;
      const activeCount = current.filter(
        (task) => task.status === "queued" || task.status === "processing",
      ).length;
      const acceptedRequests = requests.slice(
        0,
        Math.max(0, MAX_ACTIVE_IMAGE_TASKS - activeCount),
      );
      if (acceptedRequests.length > 0) {
        replaceTasks([
          ...acceptedRequests.map((request): ImageQueueTask => ({
            aspect: request.aspect,
            id: crypto.randomUUID(),
            model: request.model,
            prompt: request.prompt,
            providerId: request.providerId,
            referenceImages: request.referenceImageSnapshots,
            request,
            saveStatus: "not_saved",
            slotId: request.slotId,
            status: "queued",
          })),
          ...current,
        ]);
      }
      return {
        accepted: acceptedRequests.length,
        rejected: Math.max(0, requests.length - acceptedRequests.length),
      };
    },
    [replaceTasks],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const current = tasksRef.current;
      const target = current.find((task) => task.id === id);
      if (!target || target.status !== "error") return false;
      const activeCount = current.filter(
        (task) => task.status === "queued" || task.status === "processing",
      ).length;
      if (activeCount >= MAX_ACTIVE_IMAGE_TASKS) return false;
      replaceTasks(
        current.map((task) =>
          task.id === id
            ? {
                ...task,
                error: undefined,
                saveError: undefined,
                saveStatus: "not_saved",
                status: "queued",
              }
            : task,
        ),
      );
      return true;
    },
    [replaceTasks],
  );

  const removeTask = useCallback(
    (id: string) => {
      replaceTasks(tasksRef.current.filter((task) => task.id !== id));
    },
    [replaceTasks],
  );

  const retrySave = useCallback(async (id: string) => {
    const target = tasksRef.current.find((task) => task.id === id);
    if (!target?.src) return;
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, saveError: undefined, saveStatus: "saving" }
          : task,
      ),
    );
    const result = await imageApi.save(target.src, target.slotId);
    setTasks((current) =>
      current.map((task) =>
        task.id !== id
          ? task
          : result.saved
            ? {
                ...task,
                savedFileUrl: result.path,
                saveError: undefined,
                saveStatus: "saved",
              }
            : {
                ...task,
                saveError: result.error,
                saveStatus: "failed",
              },
      ),
    );
  }, []);

  return { enqueue, removeTask, retry, retrySave, tasks };
}

type ImageQueueContextValue = ReturnType<typeof useImageQueueState>;
const ImageQueueContext = createContext<ImageQueueContextValue | null>(null);

export function ImageQueueProvider({ children }: { children: ReactNode }) {
  const queue = useImageQueueState();
  return createElement(ImageQueueContext.Provider, { value: queue }, children);
}

export function useImageQueue(): ImageQueueContextValue {
  const queue = useContext(ImageQueueContext);
  if (!queue)
    throw new Error("useImageQueue must be used within ImageQueueProvider");
  return queue;
}
