# Narra Studio light theme và UI cleanup

## Mục tiêu

Chuyển giao diện desktop sang light theme thống nhất, giữ màu tím Narra làm màu nhấn, loại bỏ nội dung trang trí không cần thiết và sửa lỗi icon chồng chữ ở nhóm nút đường dẫn đầu ra.

## Phạm vi đã chọn

Áp dụng light theme cho toàn bộ renderer Electron hiện hành trong `apps/desktop/src/renderer`. Không khôi phục source React cũ, không đổi kiến trúc, IPC, luồng Google Flow/CAPTCHA, dữ liệu người dùng hoặc chức năng provider.

## Các phương án đã cân nhắc

1. **Light theme toàn ứng dụng — đã chọn.** Đồng bộ token màu và các lớp đang hardcode màu tối; trải nghiệm nhất quán nhưng cần kiểm tra hồi quy nhiều màn hình.
2. **Chỉ đổi trang tạo ảnh/video.** Ít thay đổi hơn nhưng sidebar, modal và các trang quản lý sẽ lệch theme.
3. **Giữ cả light/dark và thêm bộ chuyển theme.** Linh hoạt hơn nhưng thêm trạng thái, cấu hình và phạm vi kiểm thử không cần thiết cho yêu cầu hiện tại.

## Thiết kế giao diện

- Nền chính dùng trắng/xám rất nhạt; sidebar và panel dùng sắc xám tím nhẹ để phân cấp mà không tạo tương phản gắt.
- Giữ tím Narra làm primary/accent, trạng thái focus và thành phần active; chữ chính dùng xám đậm đạt độ tương phản tối thiểu 4.5:1 trên nền sáng.
- Wordmark hiển thị `Narra Studio`, không ép viết hoa. Các nhãn giao diện thông thường dùng sentence case; chỉ giữ chữ hoa khi đó là mã kỹ thuật hoặc dữ liệu người dùng.
- Xóa pseudo-element `IMAGE STUDIO` và toàn bộ footer sidebar chứa `LOCAL ONLY` cùng phiên bản.
- Nhóm nút `Đổi`/`Mở` dùng flex layout ổn định, khoảng cách icon–text rõ ràng, không cho icon phủ chữ; giữ focus ring và vùng bấm phù hợp.
- Các nền, border, hover, input, modal và trạng thái disabled đang hardcode cho dark theme được ánh xạ sang token sáng. Không thay đổi cấu trúc điều hướng hoặc nội dung nghiệp vụ.

## Cách triển khai

Renderer là bundle đã biên dịch, vì vậy thay đổi phải nhỏ và có kiểm tra chuỗi/class chính xác:

- Cập nhật brand theme source of truth sang palette light.
- Điều chỉnh critical CSS trong `index.html` để tránh nháy nền tối khi khởi động hoặc khi có lỗi renderer.
- Chỉnh bundle renderer tại đúng component tạo wordmark/footer và CSS selector liên quan; không format hoặc viết lại toàn bộ bundle.
- Nếu cần script kiểm tra bundle, đặt assertion có mục tiêu vào hệ thống smoke test hiện có thay vì tạo framework UI mới.

## Hành vi và lỗi

Không có data flow mới. Nếu renderer lỗi, fallback vẫn hiển thị được trên nền sáng và nút mở Console vẫn truy cập được. Các hành động đổi/mở thư mục giữ nguyên handler; chỉ sửa trình bày.

## Kiểm thử

- Viết kiểm tra hồi quy thất bại trước thay đổi cho các chuỗi/phần tử cần xóa, sentence case và token light theme.
- Chạy `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Mở ứng dụng và kiểm tra trực quan desktop; ưu tiên trang tạo ảnh, tạo video, sidebar, popup tài khoản, cài đặt và modal phổ biến.
- Kiểm tra không còn icon/chữ chồng nhau, không có nền tối nổi bật ngoài ý muốn, focus vẫn thấy rõ và text đủ tương phản.

## Ngoài phạm vi

Không thêm theme switcher, không đổi logo, không thiết kế lại navigation, không sửa chức năng tạo media, không deploy/package/commit và không đụng dữ liệu hoặc secret.
