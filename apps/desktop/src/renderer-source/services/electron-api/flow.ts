import { getElectronApi } from "@/services/electron-api/client";

export interface FlowSlot {
  avatar?: string;
  displayName?: string;
  email?: string;
  hasBearerToken: boolean;
  id: number;
  projectId?: string;
  status: string;
}
export interface FlowActionResult {
  success?: boolean;
  error?: string;
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const requireSuccessful = async <T>(operation: Promise<T>): Promise<T> => {
  const result = await operation;
  const value = record(result);
  if (value.success === false) {
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Thao tác Google Flow thất bại.",
    );
  }
  return result;
};
export const flowApi = {
  createProject() {
    return requireSuccessful(getElectronApi().createFlowProject());
  },
  async listSlots(): Promise<FlowSlot[]> {
    const response = await getElectronApi().getAllSlots();
    if (!Array.isArray(response))
      throw new Error("Phản hồi danh sách slot không hợp lệ.");
    return response.map(record).flatMap((slot) => {
      const id = typeof slot.id === "number" ? slot.id : NaN;
      return Number.isInteger(id) && id >= 0
        ? [
            {
              id,
              status: typeof slot.status === "string" ? slot.status : "empty",
              hasBearerToken: slot.hasBearerToken === true,
              ...(typeof slot.avatar === "string"
                ? { avatar: slot.avatar }
                : {}),
              ...(typeof slot.email === "string" ? { email: slot.email } : {}),
              ...(typeof slot.displayName === "string"
                ? { displayName: slot.displayName }
                : {}),
              ...(typeof slot.projectId === "string"
                ? { projectId: slot.projectId }
                : {}),
            },
          ]
        : [];
    });
  },
  login(slotId: number) {
    return requireSuccessful(getElectronApi().openIncognitoLogin({ slotId }));
  },
  logout(slotId: number) {
    return requireSuccessful(getElectronApi().logoutSlot({ slotId }));
  },
  sync(slotId: number) {
    return requireSuccessful(getElectronApi().syncSlotSession({ slotId }));
  },
  switchSlot(slotId: number) {
    return requireSuccessful(getElectronApi().switchWebviewSlot({ slotId }));
  },
  subscribeSlotsChanged(callback: () => void): () => void {
    const cleanups = [
      getElectronApi().onSlotLoginDone(callback),
      getElectronApi().onSlotEmailUpdated(callback),
      getElectronApi().onSlotSessionUpdated(callback),
      getElectronApi().onSlotLoggedOut(callback),
      getElectronApi().onAutoEnteredProject(callback),
      getElectronApi().onFlowProjectChanged(callback),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  },
};
