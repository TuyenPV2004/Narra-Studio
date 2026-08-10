# Narra Studio — Local voice runtime and licenses

Tài liệu này ghi nhận dependency/model được U5 sử dụng. Đây không phải tư vấn pháp lý; trước khi phân phối binary hoặc model, cần kiểm tra lại license ở đúng version được đóng gói.

## Runtime mặc định

| Thành phần | Vai trò | Trạng thái trong Narra | License upstream |
|---|---|---|---|
| `kokoro-onnx` 0.5.0 | ONNX inference adapter | Cài trong `.runtime/voice/.venv`, không commit vào repository | MIT |
| Kokoro-82M v1.0 | Model TTS | Tải từ release chính thức của `kokoro-onnx`, không commit vào repository | Apache-2.0 theo model card |
| `voices-v1.0.bin` | Voice pack Kokoro | Tải cùng model, dùng các preset English đã chọn | Xem model card và `VOICES.md`; giữ attribution upstream |
| `soundfile` 0.13.1 | Ghi WAV tạm | Cài trong voice venv | BSD-3-Clause |
| Remotion FFmpeg CLI | Chuẩn hóa WAV 48 kHz stereo, PCM 16-bit, target −16 LUFS | Dùng dependency local hiện có của repository | Xem license của FFmpeg/binary Remotion đi kèm |

Narra không commit hoặc phân phối model/venv trong source tree. `.runtime/` nằm trong `.gitignore`. Setup mặc định tải model từ GitHub release chính thức và không gọi API TTS.

Preset U5 chỉ dùng English voices được liệt kê trong model card: `af_heart`, `af_bella`, `am_michael` và `bf_emma`. Chất lượng voice là đánh giá chủ quan; creator phải nghe và duyệt từng segment trước khi dùng trong final render.

## Adapter được đánh giá nhưng không bật mặc định

### Chatterbox

- Code upstream dùng MIT.
- Model lớn hơn và có thêm luồng voice cloning/expressive generation, làm tăng runtime, dependency và yêu cầu consent.
- U5 không bundle hoặc tự tải Chatterbox. Chỉ nên thêm adapter sau khi có nhu cầu voice cloning cụ thể, consent rõ và benchmark trên máy mục tiêu.

### Piper

- Repository hiện hành `OHF-Voice/piper1-gpl` dùng GPL-3.0.
- Mỗi voice có model card/license riêng; upstream yêu cầu kiểm tra từng voice trước khi sử dụng hoặc phân phối.
- U5 không bundle Piper để tránh đưa copyleft/runtime và voice chưa được duyệt license vào Narra. Có thể dùng làm CPU fallback qua provider riêng sau khi chọn voice hợp lệ.

### faster-whisper

- Code upstream dùng MIT.
- Đây là adapter STT tùy chọn cho transcript QA/word timestamps, không phải dependency của generation path.
- U5 hiện hỗ trợ import SRT, WebVTT và word timestamp JSON rồi so khớp transcript. Narra không tự tải model Whisper lớn; chỉ bật local transcriber khi creator cấu hình model riêng trong một giai đoạn sau.

## Nguồn upstream

- [kokoro-onnx repository](https://github.com/thewh1teagle/kokoro-onnx)
- [Kokoro-82M model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [Kokoro voice catalog](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- [Chatterbox repository](https://github.com/resemble-ai/chatterbox)
- [Piper repository](https://github.com/OHF-Voice/piper1-gpl)
- [Piper voice license guidance](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md)
- [faster-whisper repository](https://github.com/SYSTRAN/faster-whisper)
