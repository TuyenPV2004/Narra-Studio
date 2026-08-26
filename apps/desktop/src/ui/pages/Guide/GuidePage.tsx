import { BookOpen, CheckCircle2 } from "lucide-react";
const sections = [
  [
    "Bắt đầu",
    "Chọn provider, hoàn tất kết nối và kiểm tra trạng thái trước khi tạo nội dung.",
  ],
  [
    "Tạo hình ảnh",
    "Nhập prompt, chọn model/tỷ lệ và theo dõi kết quả trong hàng đợi.",
  ],
  [
    "Tạo video",
    "Chọn chế độ văn bản hoặc ảnh tham chiếu; không đóng ứng dụng khi tác vụ đang xử lý.",
  ],
  [
    "Google Flow",
    "Mỗi slot dùng session riêng. CAPTCHA Extension phải kết nối trước tác vụ VEO3.",
  ],
];
export function GuidePage() {
  return (
    <section
      className="source-tool-page source-guide"
      aria-labelledby="guide-title"
    >
      <header>
        <div>
          <small>TRỢ GIÚP</small>
          <h1 id="guide-title">
            <BookOpen size={22} />
            Hướng dẫn sử dụng
          </h1>
          <p>Quy trình cơ bản cho runtime Narra Studio chạy cục bộ.</p>
        </div>
      </header>
      <div>
        {sections.map(([title, description]) => (
          <article key={title}>
            <CheckCircle2 size={20} />
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
