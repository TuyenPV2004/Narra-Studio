# Narra Studio

## Trạng thái triển khai hiện tại

Desktop app hiện dùng trực tiếp runtime đã truy hồi tĩnh từ Fibus Studio làm nền: Electron Main/Preload, IPC media, Google Flow WebView automation, multi-account slot, CAPTCHA bridge, Avis, CapCut và renderer bundle. Source TypeScript/React của giao diện Narra thử nghiệm trước đây đã được loại khỏi `apps/desktop/src`; lệnh build chỉ sao chép và kiểm tra runtime mới, không dựng lại UI cũ bằng Vite.

Các dịch vụ riêng của phần mềm mẫu đã được tách khỏi đường chạy: kích hoạt/gói thuê bao, telemetry, auto-update, community/marketplace và WebSocket cộng tác. API workspace/canvas mang tên tương thích `team-*` vẫn tồn tại vì renderer Agent gọi các tên này, nhưng implementation mới chỉ ghi JSON/media vào Electron `userData`; không kết nối team server. Cấu hình provider nhạy cảm được đọc từ `.env` cạnh executable hoặc thư mục chạy.

Các lệnh chính:

```powershell
pnpm --filter @narra/desktop typecheck
pnpm --filter @narra/desktop build
node scripts/smoke-local-workspace.cjs
pnpm package:win
```

Kiến trúc và ranh giới local/remote hiện hành được ghi tại [Kiến trúc runtime Fibus → Narra local](docs/Kien_truc_Runtime_Fibus_Narra_Local.md).

**From question to documentary.**

Narra Studio là công cụ desktop chạy local hỗ trợ quy trình sản xuất video YouTube dạng cinematic explainer và mini-documentary. Công cụ giúp creator tổ chức research, xây dựng luận đề, viết kịch bản, lập storyboard, quản lý media, tạo voice/caption và dựng rough cut có thể tiếp tục hoàn thiện trong phần mềm biên tập video.

Narra kết hợp khả năng hỗ trợ nội dung của Codex với hệ thống artifact có cấu trúc, Remotion và FFmpeg. Những quyết định sáng tạo quan trọng vẫn do người dùng kiểm soát thông qua các bước phê duyệt rõ ràng.

Mục tiêu của Narra Studio là giảm công việc lặp lại, giữ được nguồn gốc thông tin từ research đến hình ảnh và cho phép chỉnh sửa từng phần của video mà không phải chạy lại toàn bộ quy trình.

Narra Provider Hub hỗ trợ Google Flow qua các phiên tài khoản local tách biệt và Avis qua API tùy chọn. Khóa Avis chỉ được đọc từ `.env`; Narra không lưu mật khẩu Google, không chia sẻ cookie giữa tài khoản, không vượt CAPTCHA/2FA, không tự duyệt QA và không chứa license, telemetry, auto-update hay cloud workflow từ phần mềm mẫu.
