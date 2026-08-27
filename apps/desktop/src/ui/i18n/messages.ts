export type Locale = "en" | "vi";

export const messages = {
  en: {
    shell: {
      sidebarLabel: "Primary workspace sidebar",
      navigationLabel: "Workspace navigation",
      headerLabel: "Workspace status and account",
      expandSidebar: "Expand sidebar",
      collapseSidebar: "Collapse sidebar",
      providerAccount: "Provider",
      captchaConnected: "Connected",
      captchaSetupNeeded: "Setup needed",
    },
    sections: {
      create: "Create",
      edit: "Edit",
      assets: "Assets",
      system: "System",
    },
    pages: {
      providerHub: "Provider",
      dashboard: "Dashboard",
      imageGenerator: "Image",
      imageEditor: "Image Editor",
      videoGenerator: "Video",
      voice: "Voice",
      quickCut: "Quick Cut",
      videoEditor: "Video Editor",
      sceneMerge: "Scene Merge",
      library: "Library",
      providerAccount: "Provider",
      veo3Login: "Google Flow",
      captchaSetup: "CAPTCHA setup",
      settings: "Settings",
      guide: "Guide",
      aiAgent: "AI Agent",
    },
    migration: {
      title: "Source recovery in progress",
      description:
        "This active page has not been migrated into maintainable source yet.",
    },
  },
  vi: {
    shell: {
      sidebarLabel: "Thanh bên không gian làm việc",
      navigationLabel: "Điều hướng không gian làm việc",
      headerLabel: "Trạng thái không gian làm việc và tài khoản",
      expandSidebar: "Mở rộng thanh bên",
      collapseSidebar: "Thu gọn thanh bên",
      providerAccount: "Provider",
      captchaConnected: "Đã kết nối",
      captchaSetupNeeded: "Cần thiết lập",
    },
    sections: {
      create: "Sáng tạo",
      edit: "Chỉnh sửa",
      assets: "Tài nguyên",
      system: "Hệ thống",
    },
    pages: {
      providerHub: "Provider",
      dashboard: "Tổng quan",
      imageGenerator: "Hình ảnh",
      imageEditor: "Chỉnh sửa ảnh",
      videoGenerator: "Video",
      voice: "Giọng nói",
      quickCut: "Cắt nhanh",
      sceneMerge: "Ghép cảnh",
      library: "Thư viện",
      videoEditor: "Dựng video",
      providerAccount: "Provider",
      veo3Login: "Google Flow",
      captchaSetup: "Thiết lập CAPTCHA",
      settings: "Cài đặt",
      guide: "Hướng dẫn",
      aiAgent: "AI Agent",
    },
    migration: {
      title: "Đang khôi phục source frontend",
      description:
        "Trang đang hoạt động này chưa được chuyển sang source maintainable.",
    },
  },
} as const;

export type AppMessages = (typeof messages)[Locale];
