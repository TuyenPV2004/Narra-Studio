# Thiết kế lại trang thiết lập CAPTCHA

## Mục tiêu

Thiết kế lại trang thiết lập CAPTCHA Bridge theo light theme của Narra Studio, khắc phục độ tương phản kém, accordion không thể thu gọn và icon thông báo bị lệch. Luồng CAPTCHA, IPC và dữ liệu trạng thái hiện có phải được giữ nguyên.

## Phạm vi

- Trang `captcha-setup-page` và component `CaptchaSetupPage`.
- Trạng thái mở/đóng của bốn bước thiết lập.
- Toast dùng chung của renderer.
- Căn chỉnh icon mục “Thư viện” trong sidebar.
- Không thêm dependency UI hoặc icon mới; tiếp tục dùng Lucide và token CSS hiện có.

## Hướng thiết kế đã duyệt

### Bố cục

- Dùng một cột nội dung, rộng tối đa khoảng 960px và căn giữa.
- Canvas dùng `--bg-0`; card dùng nền trắng và viền `--border-subtle`.
- Header gồm icon bảo mật, tiêu đề chính, mô tả ngắn và pill trạng thái.
- Xóa hoàn toàn nhãn phụ “Narra Studio · VEO3”.
- Thanh tiến trình nằm dưới header, dùng card trắng, không dùng nền tối hoặc glow.
- Bốn bước được trình bày thành bốn card accordion xếp dọc.

### Màu sắc và chữ

- Chữ chính dùng `--text`, chữ phụ dùng `--text-2` hoặc `--text-3` và phải đọc rõ trên nền trắng.
- Hành động chính dùng `--brand-primary`; trạng thái thành công dùng `--success-text` và `--success-bg`.
- Không dùng nền tối hardcode, chữ trắng mờ, gradient tối hoặc shadow đen nặng trong phần giao diện CAPTCHA.
- Nhãn bước và trạng thái dùng sentence case, không ép in hoa.
- Focus ring phải hiển thị rõ khi điều hướng bằng bàn phím.

### Accordion

- Chỉ một bước được mở tại một thời điểm.
- Bấm vào bước đang mở sẽ thu gọn bước đó.
- Bấm bước khác sẽ đóng bước cũ và mở bước mới.
- Khi trạng thái kiểm tra chuyển sang bước kế tiếp, bước hiện tại mới có thể được tự động mở.
- Nút summary dùng `aria-expanded`; vùng panel có định danh để liên kết bằng `aria-controls`.
- Chevron chỉ xoay bằng transform trong 150–250ms và tôn trọng `prefers-reduced-motion`.

### Toast

- Toast là card nền trắng, chữ gần đen, viền sáng và shadow nhẹ.
- Nội dung dùng flex layout để icon luôn nằm bên trái, căn giữa theo chiều dọc và cách chữ 8px.
- Thành công: icon Lucide `CircleCheck` màu xanh.
- Lỗi: icon Lucide `CircleX` màu đỏ.
- Thông tin: icon Lucide `Info` màu tím hoặc xanh phù hợp với brand.
- Icon có kích thước cố định 18px, không co lại; nội dung được phép xuống dòng.
- Màu không phải tín hiệu duy nhất: mỗi toast luôn có cả icon và nội dung chữ.

### Icon sidebar “Thư viện”

- Wrapper icon dùng cùng kích thước, grid alignment và stroke width với các mục sidebar khác.
- SVG được căn giữa tuyệt đối, không bị ảnh hưởng bởi baseline của chữ.
- Hover và active dùng màu tím đậm của light theme, không chuyển trắng.

## Responsive và tương tác

- Ở cửa sổ hẹp, header chuyển thành một cột và pill trạng thái xuống dòng.
- Card accordion giữ vùng bấm tối thiểu 44px; mô tả được xuống dòng thay vì cắt mất nội dung.
- Nhóm nút trong panel được phép wrap; nút làm mới không bị đẩy khỏi card.
- Không tạo horizontal overflow ở kích thước 720px trở xuống.

## Thay đổi kỹ thuật dự kiến

- Sửa logic toggle trong bundle `CaptchaSetupPage-DbTYSglx.js`.
- Bổ sung lớp tương thích CAPTCHA, toast và nav icon vào `light-theme.css` để ghi đè CSS tối cũ một cách có chủ đích.
- Mở rộng `scripts/test-light-theme-ui.cjs` để kiểm tra nhãn phụ đã bị xóa, toggle có nhánh thu gọn, CAPTCHA không dùng surface media tối, toast có flex/gap và icon semantic.
- Không thay đổi API CAPTCHA, phiên bản extension, provider flow hoặc Electron IPC.

## Chiến lược kiểm thử

1. Viết kiểm thử hồi quy và xác nhận thất bại với code hiện tại.
2. Sửa logic accordion và markup accessibility tối thiểu để test đạt.
3. Áp dụng CSS light-theme theo token ngữ nghĩa và chạy lại test.
4. Chạy `pnpm typecheck`, `pnpm test`, `pnpm build`.
5. Mở ứng dụng Electron đã build để kiểm tra trực quan trang CAPTCHA, toast và sidebar ở kích thước desktop; không thực hiện CAPTCHA hay tiêu credit.

## Tiêu chí hoàn thành

- Không còn “Narra Studio · VEO3”.
- Không còn nền tối/chữ tối trong giao diện CAPTCHA.
- Bấm lại card đang mở sẽ thu gọn được.
- Toast nền trắng, chữ đen và icon trạng thái màu nằm bên trái, căn đúng.
- Icon “Thư viện” thẳng hàng với các icon sidebar khác.
- Các kiểm thử mục tiêu, typecheck, test và build đều đạt.
