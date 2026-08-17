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
    const local = record(await getElectronApi().getDashboardStats());
    let balance: number | undefined;
    let recentActivity = 0;
    if (providerId === "avis") {
      const [balanceResult, usageResult] = await Promise.allSettled([
        getElectronApi().avisGetBalance(),
        getElectronApi().avisGetUsage({ offset: 0, limit: 100 }),
      ]);
      if (balanceResult.status === "fulfilled") {
        const value = record(balanceResult.value).creditBalance;
        if (typeof value === "number") balance = value;
      }
      if (usageResult.status === "fulfilled") {
        const value = record(usageResult.value).total;
        if (typeof value === "number") recentActivity = value;
      }
    }
    return {
      totalImages: Number(local.totalImages) || 0,
      totalVideos: Number(local.totalVideos) || 0,
      imageStorage: Number(local.imageStorage) || 0,
      videoStorage: Number(local.videoStorage) || 0,
      recentActivity,
      ...(balance === undefined ? {} : { balance }),
    };
  },
};
