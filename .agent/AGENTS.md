# Narra Studio Workspace Rules

## Ngôn ngữ

- Khi người dùng viết tiếng Việt, trả lời bằng tiếng Việt.
- Xưng “em” và gọi người dùng là “anh”, trừ khi người dùng yêu cầu khác.
- Nêu rõ điều chưa được xác minh; không suy đoán về hành vi runtime.

## Source of truth

1. Yêu cầu mới nhất của người dùng.
2. `docs/Kien_truc_Runtime_Narra_Local.md`.
3. `README.md`.
4. Source thực tế trong `apps/desktop/src`.

Thiết kế documentary/Remotion/SQLite/Codex pipeline cũ không còn là kiến trúc hiện hành.

## Phạm vi sản phẩm

- Narra Studio là ứng dụng Electron local, single-user, dựa trên runtime đã khôi phục và local hóa.
- Google Flow automation, multi-account session, CAPTCHA bridge, anti-detect, AI Agent, Avis và xử lý media là các luồng cốt lõi phải được bảo toàn.
- Không khôi phục license, subscription, billing, telemetry, auto-update, community, marketplace, team server hoặc collaboration cloud.
- Workspace/canvas dùng lưu trữ local. Không thêm backend cloud nếu người dùng chưa yêu cầu rõ ràng.

## An toàn tài khoản và dữ liệu

- Không đọc hoặc in `.env`, token, cookie, mật khẩu, private key hoặc mã 2FA nếu người dùng chưa yêu cầu rõ ràng.
- Không chia sẻ cookie giữa các account slot.
- Không tự vượt 2FA, không tự giải CAPTCHA bằng dịch vụ ngoài và không giả mạo danh tính.
- Không gọi provider trả phí hoặc tiêu credit khi chỉ đang kiểm tra source/build.
- `projects` và `database` được coi là dữ liệu người dùng; không xóa nếu chưa có yêu cầu cụ thể.

## Quy tắc code

- Source desktop hiện hành nằm trong `apps/desktop/src`.
- Renderer là bundle JavaScript đã biên dịch; thay đổi phải nhỏ, có mục tiêu và kiểm tra chính xác chuỗi/function liên quan.
- Không xây lại giao diện Narra cũ hoặc đưa Vite/React source thử nghiệm trở lại.
- Cấu hình nhạy cảm đặt trong `.env`; `.env.example` chỉ chứa tên biến và giá trị mẫu không bí mật.
- Giữ IPC Main/Preload đồng bộ và không làm mất các API Google Flow đang được renderer gọi.

## Build và kiểm tra

Sau thay đổi liên quan desktop, chạy:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Trước khi bàn giao package Windows, kiểm tra Electron main, nội dung `app.asar`, module Flow/CAPTCHA/anti-detect và xác nhận không còn license, telemetry, collaboration cloud hoặc updater cũ. Không tuyên bố Google login/generation hoạt động nếu chưa thử bằng tài khoản người dùng.

## Git và báo cáo

- Không commit, push, tạo branch hoặc sửa lịch sử Git nếu người dùng chưa yêu cầu.
- Báo cáo file đã đổi, lệnh kiểm tra, kết quả và rủi ro chưa xác minh.
- Đề nghị người dùng xem `git diff` trước khi commit.
