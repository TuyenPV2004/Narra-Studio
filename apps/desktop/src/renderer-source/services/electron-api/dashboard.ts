import { getElectronApi } from "@/services/electron-api/client";
import type { ProviderId } from "@/types/electron-api";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
export interface DashboardSummary {
  balance?: number;
  imageStorage: number;
  recentActivity: number;
  totalImages: number;
  totalVideos: number;
  videoStorage: number;
}
export const dashboardApi = {
  async load(providerId: ProviderId): Promise<DashboardSummary> {
    void providerId;
    const local = record(await getElectronApi().getDashboardStats());
    return {
      totalImages: Number(local.totalImages) || 0,
      totalVideos: Number(local.totalVideos) || 0,
      imageStorage: Number(local.imageStorage) || 0,
      videoStorage: Number(local.videoStorage) || 0,
      recentActivity: 0,
    };
  },
};
