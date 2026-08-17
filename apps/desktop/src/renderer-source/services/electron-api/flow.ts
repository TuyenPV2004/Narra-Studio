import { getElectronApi } from "@/services/electron-api/client";

export interface FlowSlot {
  displayName?: string;
  email?: string;
  hasBearerToken: boolean;
  id: number;
  projectId?: string;
  status: string;
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
export const flowApi = {
  createProject() {
    return getElectronApi().createFlowProject();
  },
  async listSlots(): Promise<FlowSlot[]> {
    const response = await getElectronApi().getAllSlots();
    return (Array.isArray(response) ? response : [])
      .map(record)
      .flatMap((slot) =>
        typeof slot.id === "number"
          ? [
              {
                id: slot.id,
                status: typeof slot.status === "string" ? slot.status : "empty",
                hasBearerToken: slot.hasBearerToken === true,
                ...(typeof slot.email === "string"
                  ? { email: slot.email }
                  : {}),
                ...(typeof slot.displayName === "string"
                  ? { displayName: slot.displayName }
                  : {}),
                ...(typeof slot.projectId === "string"
                  ? { projectId: slot.projectId }
                  : {}),
              },
            ]
          : [],
      );
  },
  login(slotId: number) {
    return getElectronApi().openIncognitoLogin({ slotId });
  },
  logout(slotId: number) {
    return getElectronApi().logoutSlot({ slotId });
  },
  sync(slotId: number) {
    return getElectronApi().syncSlotSession({ slotId });
  },
  switchSlot(slotId: number) {
    return getElectronApi().switchWebviewSlot({ slotId });
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
