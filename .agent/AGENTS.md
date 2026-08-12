# Narra Studio Custom Workspace Rules

## Ngôn ngữ và giao tiếp

- Khi developer viết bằng tiếng Việt, phản hồi bằng tiếng Việt.
- Xưng là “em” và gọi developer là “anh”, trừ khi anh yêu cầu cách xưng hô khác.
- Giải thích rõ ràng, ngắn gọn và tập trung vào hành động thực tế.
- Nếu chưa chắc chắn, nêu rõ giả định hoặc phần chưa được xác minh.

## Source of truth

Đọc nguồn liên quan theo thứ tự:

1. Quyết định mới nhất được developer nêu trực tiếp.
2. `docs/Tong_quan.md` cho phạm vi và kiến trúc V1 hiện hành.
3. `docs/Ke_Hoach_V1.md` cho thứ tự triển khai và quality gate.
4. `docs/SKILL.md` cho danh mục workflow Codex/Narra.
5. Contract/schema máy đọc được khi chúng được tạo.
6. `.agent/SKILL.md` và rule module cụ thể.
7. `docs/archive/Narra_Studio_Blueprint_V1.md` chỉ làm tài liệu khám phá/lịch sử ở những điểm đã được tài liệu mới sửa đổi.
8. Pattern implementation hiện có.

Nếu có xung đột, không âm thầm hòa trộn hai quyết định; nêu xung đột và ưu tiên nguồn mới hơn theo thứ tự trên.

## Phạm vi sản phẩm

- Xem Narra Studio V1 là công cụ desktop local, single-user; không mặc định là website, SaaS hoặc production cloud system.
- Không đưa auth, multi-tenant, Supabase, backend server, cloud storage hoặc hạ tầng deployment vào V1 nếu không có quyết định mới.
- Không dùng n8n trong V1. Dùng Codex skill cho AI workflow và local job runner cho media job.
- Không tích hợp OpenAI API trong V1. Các bước cần model chạy trong Codex, mặc định GPT-5.6 Sol Medium theo lựa chọn của developer.
- Remotion plugin là hướng dẫn cho Codex; Remotion runtime và FFmpeg vẫn là dependency của repository/local machine.
- Bảo toàn human approval tại topic, thesis, script, storyboard, assets, rough cut và final.
- Không tự động publish hoặc thiết kế content farm.

## Cách làm việc

- Trước thay đổi, đọc cấu trúc repository, rule liên quan và file cần thiết.
- Với tác vụ nhiều bước hoặc ảnh hưởng kiến trúc, lập kế hoạch ngắn gồm mục tiêu, khu vực, bước thực hiện, validation và rủi ro.
- Nếu ngữ cảnh đủ, nói rõ không cần câu hỏi bổ sung và tiếp tục. Chỉ dừng khi thiếu quyết định có thể làm kết quả sai đáng kể hoặc tạo rủi ro.
- Ưu tiên thay đổi nhỏ, tập trung; không refactor lớn, format toàn repository hoặc đổi contract ngoài phạm vi được yêu cầu.
- Trước khi sửa code khi chưa có lệnh triển khai rõ ràng, nêu vấn đề, lý do, file dự kiến, cách sửa và validation rồi chờ phê duyệt. Yêu cầu tạo/sửa tài liệu rõ ràng được phép thực hiện trực tiếp.
- Không commit, push, tạo/switch branch hoặc Pull Request nếu chưa có chỉ thị rõ ràng riêng cho thao tác Git.

## Kiến trúc và coding

- Ưu tiên Electron + React + TypeScript, SQLite/filesystem, Remotion và FFmpeg theo `docs/Tong_quan.md`; đánh giá phương án thay thế trước mọi thay đổi công nghệ lớn.
- Không thêm framework, database, service hoặc dependency nếu không có lý do cấp dự án.
- Dùng schema/version cho artifact JSON; giữ ID và provenance xuyên suốt `source → fact → claim → scene → shot → asset`.
- Không suy luận trạng thái nghiệp vụ chỉ từ tên file. SQLite giữ index/state; artifact giữ nội dung trao đổi có thể review.
- Khi upstream đổi sau approval, tạo version mới hoặc đánh dấu downstream stale; không âm thầm ghi đè artifact đã duyệt.
- Đọc convention trước khi viết code; giữ code dễ đọc, dễ test và ít dependency.
- Không sửa generated file, lockfile, migration hoặc snapshot trừ khi thật sự cần.
- Giá trị có thể thay đổi theo preset, provider, channel hoặc project phải nằm trong typed configuration/artifact, không rải hardcode trong logic.

## Skill usage

- Khi tác vụ thuộc workflow Narra, đọc `.agent/SKILL.md` đầy đủ trước khi hành động.
- Khi một specialized Codex skill phù hợp, đọc và dùng bộ skill nhỏ nhất cần thiết.
- Với Remotion, dùng skill chuyên biệt tương ứng cho create, markup, captions, multimedia, studio hoặc render.
- Không tuyên bố đã dùng skill nếu chưa đọc skill đó trong task hiện tại.
- Nếu skill thiếu hoặc không đọc được, báo rõ và tiếp tục theo source of truth của repository.

## Nguồn và nội dung

- Khi research hoặc đưa ra quyết định kỹ thuật có thể thay đổi theo thời gian, ưu tiên nguồn official/primary và cung cấp link trực tiếp.
- Không bịa citation, URL, quote, số liệu hoặc kết quả test.
- Phân biệt confirmed fact, inference, assumption và creative preference.
- Không tạo script dựa trên một nguồn duy nhất; claim quan trọng phải truy ngược được.
- Không tải, sao chép hoặc sử dụng media không rõ quyền.

## An toàn và quyền hạn

- Không đọc, in, sao chép, sửa hoặc commit secret, token, cookie, private key, `.env`, `auth.json` hay dữ liệu nhạy cảm nếu developer chưa yêu cầu rõ ràng.
- Không chạy thao tác phá hủy dữ liệu, reset lịch sử Git, force-push, format ổ đĩa, xóa thư mục lớn hoặc đổi quyền hệ thống.
- Không cài dependency hoặc dùng API/credit bên ngoài nếu chưa có lý do và quyền phù hợp.
- Nếu phát hiện secret, chỉ báo vị trí và cách xử lý; không in giá trị đầy đủ.

## Validation

- Sau thay đổi code, chạy test, lint, typecheck, build hoặc smoke test phù hợp mà repository cung cấp.
- Với artifact/schema, kiểm tra cả fixture hợp lệ và fixture sai có chủ đích khi có test surface.
- Với render, kiểm tra composition, chạy smoke render phù hợp và dùng ffprobe xác nhận output.
- Với tài liệu, kiểm tra UTF-8, heading, code fence, local link, stale placeholder và tham chiếu dự án cũ còn sót.
- Không xóa, skip hoặc làm yếu test cũ chỉ để thay đổi mới pass.
- Nếu không thể chạy validation, nêu lệnh chưa chạy, nguyên nhân và rủi ro còn lại.

## Review mode

Khi developer yêu cầu review/check/audit:

- Dòng đầu dùng tiêu đề `BÁO CÁO ĐÁNH GIÁ: <TÊN BÁO CÁO>`.
- Không chỉnh sửa nếu developer chỉ yêu cầu đánh giá.
- Sắp xếp finding theo mức độ nghiêm trọng; nêu file/vị trí, tác động, cách sửa, trade-off và bước tiếp theo.
- Tách lỗi xác nhận được khỏi giả định và lựa chọn thiết kế.

## Lập kế hoạch và trạng thái roadmap

- Đọc phase và exit criterion liên quan trong `docs/Ke_Hoach_V1.md` trước khi triển khai.
- Không bắt đầu phase phụ thuộc khi quality gate đầu vào chưa đạt, trừ khi developer đổi ưu tiên và chấp nhận rủi ro.
- Chỉ đánh dấu hạng mục hoàn thành khi có artifact/implementation và bằng chứng validation.
- Nếu thay đổi làm dịch chuyển scope, dependency hoặc thứ tự phase, cập nhật kế hoạch trong cùng yêu cầu.

## Báo cáo cuối

Khi có file thay đổi, nêu:

- File đã thay đổi và mục đích.
- Lệnh/kiểm tra đã chạy cùng kết quả.
- Rủi ro hoặc phần chưa xác minh.
- Đề nghị developer review diff trước khi commit.
