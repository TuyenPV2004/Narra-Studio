# Narra Studio Workspace Rules

## Ngôn ngữ

- Khi người dùng viết tiếng Việt, trả lời bằng tiếng Việt.
- Xưng “em” và gọi người dùng là “anh”, trừ khi người dùng yêu cầu khác.
- Nêu rõ điều chưa được xác minh; không suy đoán về hành vi runtime.

## Xác minh dữ liệu và chống suy đoán (Bắt buộc)

- **Không suy đoán số liệu hoặc danh sách**: Mọi thông số kỹ thuật, số lượng mục (ví dụ: danh sách giọng, model, tham số, token, cấu hình) phải được kiểm chứng trực tiếp từ source code, file checkpoint/dữ liệu hoặc tài liệu chính thức trước khi đưa ra câu trả lời.
- **Không tự tạo hoặc bịa thuộc tính metadata**: Nếu một trường dữ liệu (ví dụ: giới tính, âm sắc, nhãn phân loại) không tồn tại trong metadata chính thức của file/model, tuyệt đối không được tự suy diễn rồi trình bày như thể đó là thông tin có sẵn trong metadata.
- **Bắt buộc phân định trạng thái xác minh**:
  - Chỉ khẳng định chắc chắn khi đã có bằng chứng cụ thể từ source code, lệnh kiểm tra hoặc file thực tế.
  - Khi chưa thể kiểm chứng trực tiếp, bắt buộc phải nói rõ: *“Thông tin này chưa được xác minh từ nguồn chính thức / Cần đối chiếu thêm”*.
- **Trách nhiệm giải trình**: Bất kỳ khi nào người dùng chất vấn về một con số hoặc khẳng định kỹ thuật, phải trích dẫn ngay đường dẫn file, dòng code hoặc tài liệu gốc làm bằng chứng xác thực.

## Source of truth

1. Yêu cầu mới nhất của người dùng.
2. `docs/Kien_truc_Runtime_Narra_Local.md`.
3. `README.md`.
4. Source thực tế trong `apps/desktop/src`.

Thiết kế documentary/Remotion/SQLite/Codex pipeline cũ không còn là kiến trúc hiện hành.

## Nguồn đối chiếu bắt buộc

- Khi review, audit hoặc đề xuất hướng triển khai cho Google Flow, CAPTCHA, extension, session,
  tạo ảnh/video hay kiến trúc liên quan, luôn đối chiếu với phiên bản hiện tại của repository
  [flowkit](https://github.com/crisng95/flowkit), trước hết là
  [flowkit/PLAN.md](https://github.com/crisng95/flowkit/blob/main/PLAN.md), rồi đến source và tài liệu
  liên quan trong repository đó.
- Mục đích đối chiếu là tìm bằng chứng, phương án thay thế, khoảng trống và trade-off để đưa ra nhận xét
  cùng đề xuất tốt nhất cho Narra Studio. Khi báo cáo, nêu rõ điểm tương đồng, khác biệt, phần có thể áp dụng,
  phần không nên áp dụng và lý do.
- Flowkit là nguồn tham khảo bắt buộc, không phải source of truth của Narra Studio. Không sao chép hoặc áp dụng
  nguyên trạng code, endpoint, payload, header, model identifier, quy trình xác thực hay CAPTCHA nếu chưa kiểm tra
  với yêu cầu mới nhất, tài liệu kiến trúc, source hiện tại và hành vi runtime đã xác minh của Narra Studio.
- Nếu không thể truy cập flowkit, phải nói rõ giới hạn đối chiếu, dùng bằng chứng local tốt nhất hiện có và không
  tuyên bố một đề xuất là “tốt nhất” khi chưa hoàn tất phần đối chiếu bắt buộc.

## Superpowers

- Khi plugin Superpowers khả dụng, kiểm tra và dùng skill phù hợp trước khi thực hiện tác vụ:
  - `brainstorming` cho tính năng hoặc thay đổi hành vi mới.
  - `systematic-debugging` cho bug, lỗi test hoặc hành vi bất ngờ.
  - `writing-plans` cho tác vụ nhiều bước hoặc ảnh hưởng nhiều file.
  - `test-driven-development` khi có test surface phù hợp cho thay đổi code.
  - `requesting-code-review` và `verification-before-completion` trước khi bàn giao.
- Dùng `using-git-worktrees`, `subagent-driven-development`, `dispatching-parallel-agents` hoặc
  `finishing-a-development-branch` chỉ khi phù hợp với phạm vi và quyền đã được người dùng cho phép;
  không tự tạo branch, worktree, commit, merge hoặc push.
- Skill Superpowers bổ sung quy trình, không thay thế chỉ thị người dùng, rule workspace, giới hạn an toàn,
  source of truth hoặc lệnh kiểm tra của dự án. Nếu skill không khả dụng, tiếp tục theo các rule này và
  nêu rõ giới hạn trong báo cáo.

## Front-End Checklist MCP

- Khi review, audit, debug hoặc thay đổi frontend trong `apps/desktop/src/ui`, nếu MCP
  `frontendchecklist` khả dụng thì dùng nó như một quality gate bổ sung cho accessibility, performance,
  HTML/CSS/JavaScript, security, images và testing.
- Với code đã dán hoặc đã đọc, gọi `review_code` trước; sau đó dùng `search_rules`, `get_rule`, `check_rule`,
  `explain_rule` hoặc `fix_rule` để đối chiếu sâu các phát hiện liên quan. Kết quả không có issue chỉ có nghĩa
  là chưa phát hiện được lỗi bằng heuristic tĩnh, không phải bằng chứng frontend hoàn toàn đạt chuẩn.
- Với audit rộng, lấy `get_workflow` hoặc `get_checklist_rules` trước khi kiểm tra từng rule. Chỉ dùng
  `audit_url` cho URL công khai mà công cụ có thể truy cập; với renderer Electron/local, phải kiểm tra bằng
  source, test và trình duyệt/runtime phù hợp.
- Khuyến nghị từ MCP phải được đối chiếu với source of truth, kiến trúc Electron, convention hiện có và hành vi
  runtime của Narra Studio. Không gửi secret, token, cookie, dữ liệu người dùng hoặc nội dung `.env` vào MCP.
- Front-End Checklist MCP không thay thế `pnpm typecheck`, `pnpm test`, `pnpm build`, kiểm thử trình duyệt hoặc
  xác minh runtime. Khi bàn giao, nêu rõ thao tác MCP đã dùng, phát hiện đã xử lý và phần chưa thể xác minh.

## Phạm vi sản phẩm

- Narra Studio là ứng dụng Electron local, single-user, dựa trên runtime đã khôi phục và local hóa.
- Google Flow automation, multi-account session, CAPTCHA bridge, anti-detect, AI Agent dùng custom provider profile và xử lý media là các luồng cốt lõi phải được bảo toàn.
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
- Renderer production được build từ React/TypeScript source trong `apps/desktop/src/ui` bằng Vite.
- Thay đổi renderer phải thực hiện trong source React/TypeScript hiện hành; không khôi phục hoặc sửa lại recovered/compiled renderer cũ làm source runtime.
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
