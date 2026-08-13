# Narra Studio light-theme contrast audit

## Mục tiêu

Hoàn thiện light theme trên toàn bộ giao diện Narra Studio: chữ và icon phải rõ trên nền sáng, hover/active/focus nhất quán, sidebar liền mạch với nội dung, đồng thời giữ nền tối chỉ trong vùng preview/canvas media nơi cần tương phản với ảnh hoặc video.

## Nguyên nhân đã xác nhận

Renderer là bundle dark-theme đã biên dịch, chứa nhiều selector cụ thể với màu trắng, trắng có alpha thấp, nền đen và hover đổi chữ/icon về trắng. `light-theme.css` hiện chỉ đổi token và các surface lớn nên chưa bao phủ các selector cụ thể ở sidebar, header, menu, popup, card, form, badge, empty state và các trang chuyên biệt. Vì stylesheet light được nạp cuối, một compatibility layer có selector đúng phạm vi có thể sửa lỗi mà không viết lại bundle.

## Các phương án

1. **Semantic light-theme compatibility layer — đã chọn.** Mở rộng `light-theme.css` theo nhóm component, trạng thái và semantic token. Thay đổi tập trung, có thể kiểm thử và giữ dark media surfaces có chủ đích.
2. **Global wildcard override.** Ép mọi chữ tối và mọi nền sáng bằng selector rộng. Ít code nhưng phá màu trạng thái, nút primary, overlay trên ảnh và vùng preview.
3. **Sửa trực tiếp mọi màu trong CSS bundle gốc.** Loại bỏ dark theme tận gốc nhưng phải chỉnh hàng trăm rule minified, khó review và dễ gây regression ngoài phạm vi.

## Thiết kế màu

- Các token text gồm `text`, `text-2`, `text-3`, `text-4` đều đạt tối thiểu 4.5:1 trên surface tương ứng.
- Màu trắng chỉ được dùng trên nền primary/danger đủ đậm hoặc overlay nằm trực tiếp trên media tối.
- Text phụ, placeholder, metadata, empty state và disabled không dùng alpha trắng; dùng token xám tím đậm. Disabled có thể giảm opacity nhưng vẫn phải đọc được.
- Hover trên nền sáng dùng nền tím/xám rất nhạt và chữ/icon tím đậm; không chuyển icon hoặc chữ sang trắng.
- Active dùng `brand-primary-soft` + `brand-primary-hover`; focus-visible giữ ring tím rõ và không phụ thuộc hover.
- Success, warning, danger dùng màu semantic đậm phù hợp nền sáng; badge trạng thái có nền pastel và text đậm.

## Sidebar

- Xóa ba node caption `Sáng tạo`, `Hoàn thiện`, `Quản lý` khỏi JSX bundle; không chỉ ẩn bằng CSS để tránh khoảng trống và accessibility noise.
- Sidebar và main content dùng cùng base surface; bỏ đường biên/shadow mang cảm giác hai khối tách rời. Phân vùng bằng khoảng cách và active highlight, không dùng divider dọc mạnh.
- Logo, nav label và icon dùng text token. Hover/active áp màu đồng bộ cho cả `.nav-icon` và `.nav-label`.
- Nút collapse, tooltip collapsed, account/provider menu và các trạng thái CAPTCHA/project được ánh xạ sang palette light.

## Phạm vi component

Compatibility layer bao phủ:

- application chrome: sidebar, top header, navigation, footer/status controls;
- typography: heading, paragraph, label, helper, metadata, placeholder, code/path;
- controls: button, tab, chip, icon button, input, textarea, select, checkbox và focus;
- containers: card, panel, menu, popover, modal, toast, tooltip, table/list và empty state;
- các trang tạo ảnh/video, thư viện, nối video, tài khoản/provider, cài đặt, CAPTCHA, workspace và AI Agent;
- trạng thái success/warning/error/disabled/loading.

## Dark surfaces được phép

Chỉ các phần tử được xác định rõ là media surface mới giữ nền tối: video/image preview, canvas editor, timeline/track editor cần màu kỹ thuật, thumbnail overlay và overlay control trực tiếp trên media. Text trắng bên trong các surface này được giữ nếu contrast đạt yêu cầu. Menu, form hoặc modal đặt cạnh canvas vẫn dùng light theme.

## Cách triển khai

- Giữ source-of-truth token light hiện tại và bổ sung semantic aliases nếu cần.
- Xóa caption sidebar trong `index-JlIFz2Wa.js` bằng thay đổi JSX bundle nhỏ, có assertion chính xác.
- Mở rộng `light-theme.css` theo section và component family; tránh wildcard làm đổi nút primary hoặc media overlay.
- Nâng `scripts/test-light-theme-ui.cjs` thành regression contract cho caption, sidebar integration, nav hover/icon, các màu trắng bị cấm và danh sách dark-surface allowlist.
- Không thay đổi handler, navigation, IPC, dữ liệu, provider hoặc logic tạo media.

## Kiểm thử

- TDD: thêm assertion thất bại cho caption/sidebar/hover và các contract light theme trước khi sửa.
- Chạy `pnpm typecheck`, `pnpm test`, `pnpm build` hoặc các script tương đương nếu pnpm gặp khóa Windows.
- Visual QA trong Electron/package ở các màn hình chính và trạng thái hover/active/focus; kiểm tra sidebar expanded/collapsed.
- Audit computed styles/contrast cho representative text và icon; xác nhận dark chỉ xuất hiện trong media/canvas allowlist.
- Kiểm tra `app.asar` nếu tạo lại package Windows.

## Ngoài phạm vi

Không thêm theme switcher, không thiết kế lại navigation, không đổi logo, không thay đổi editor behavior, không gọi provider trả phí, không commit/push/package Windows nếu chưa cần cho validation.
