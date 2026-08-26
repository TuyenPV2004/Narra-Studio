import { getElectronApi } from "@/services/electron-api/client";

export const historyApi = {
  load: (key: string) => getElectronApi().loadHistory(key),
  save: async (key: string, items: unknown[]) => {
    const saved = await getElectronApi().saveHistory(key, items);
    if (!saved) throw new Error(`Không thể lưu dữ liệu lịch sử: ${key}`);
  },
};
