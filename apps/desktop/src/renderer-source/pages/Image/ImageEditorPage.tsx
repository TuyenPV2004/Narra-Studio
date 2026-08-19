import {
  Crop,
  Download,
  FileCheck,
  Images,
  Info,
  Layers,
  Pencil,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { formatImageError, imageApi } from "@/services/electron-api/image";
import type { ProviderId } from "@/types/electron-api";
import {
  ImageAnnotationCanvas,
  type AnnotationTool,
} from "@/pages/Image/ImageAnnotationCanvas";

export function ImageEditorPage({ providerId }: { providerId: ProviderId }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [result, setResult] = useState<{
    createdAt?: string;
    mediaId: string | null;
    promptUsed?: string;
    slotId?: number;
    src: string;
  }>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [annotationCount, setAnnotationCount] = useState(0);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("pen");
  const [annotationColor, setAnnotationColor] = useState("#ef4444");
  const [annotationWidth, setAnnotationWidth] = useState(18);
  const [crop, setCrop] = useState({
    top: 0,
    left: 0,
    right: 100,
    bottom: 100,
  });
  const updateAnnotationCount = useCallback(
    (count: number) => setAnnotationCount(count),
    [],
  );
  void providerId;
  useEffect(() => {
    if (!file) {
      setPreview("");
      setImageReady(false);
      return;
    }
    setImageReady(false);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(selected.type)) {
      setError(
        "Định dạng ảnh không được hỗ trợ. Vui lòng chọn PNG, JPEG, WebP hoặc GIF.",
      );
      return;
    }
    if (selected.size > 25 * 1024 * 1024) {
      setError("Dung lượng ảnh tối đa cho phép là 25MB.");
      return;
    }
    setError(undefined);
    setFile(selected);
  };

  const edit = async () => {
    if (!file || !imageReady || !prompt.trim() || !canvasRef.current) return;
    setRunning(true);
    setError(undefined);
    try {
      const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.92);
      const output = await imageApi.editVeoImage({
        dataUrl,
        prompt: prompt.trim(),
      });
      setResult({
        ...output,
        promptUsed: prompt.trim(),
        createdAt: new Date().toLocaleTimeString(),
      });
      await imageApi.save(output.src, output.slotId).catch((saveErr) => {
        console.warn("Không thể lưu ảnh local:", saveErr);
      });
    } catch (value) {
      setError(formatImageError(value));
    } finally {
      setRunning(false);
    }
  };
  const upscale = async (resolution: "2K" | "4K") => {
    if (!result?.mediaId) return;
    setRunning(true);
    setError(undefined);
    try {
      const upscaledSrc = await imageApi.upscale(
        result.mediaId,
        resolution,
        result.slotId ?? 0,
      );
      setResult({
        ...result,
        src: upscaledSrc,
      });
    } catch (value) {
      setError(formatImageError(value));
    } finally {
      setRunning(false);
    }
  };
  const applyCrop = async () => {
    if (!result?.mediaId) return;
    const coordinates = {
      top: crop.top / 100,
      left: crop.left / 100,
      right: crop.right / 100,
      bottom: crop.bottom / 100,
    };
    if (
      coordinates.left >= coordinates.right ||
      coordinates.top >= coordinates.bottom
    ) {
      setError(
        "Vùng crop không hợp lệ (Tọa độ bắt đầu phải nhỏ hơn tọa độ kết thúc).",
      );
      return;
    }
    setRunning(true);
    setError(undefined);
    try {
      const cropped = await imageApi.crop(
        result.mediaId,
        coordinates,
        result.slotId ?? 0,
      );
      setResult({
        ...result,
        mediaId: cropped.mediaId,
        src: cropped.src,
      });
    } catch (value) {
      setError(formatImageError(value));
    } finally {
      setRunning(false);
    }
  };
  return (
    <section
      className="source-tool-page source-image-editor"
      aria-labelledby="image-editor-title"
    >
      <header>
        <div>
          <small>CHỈNH SỬA</small>
          <h1 id="image-editor-title">
            <Images size={22} aria-hidden="true" />
            Chỉnh sửa ảnh
          </h1>
          <p>
            Tạo phiên bản mới từ ảnh tham chiếu; file gốc luôn được giữ nguyên.
          </p>
        </div>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-tool-layout">
        <section className="source-tool-preview">
          {preview ? (
            <div className="source-canvas-wrapper">
              <div className="source-image-guide-banner">
                <Info size={14} aria-hidden="true" />
                <span>
                  Dùng chuột hoặc bút cảm ứng vẽ trực tiếp lên ảnh để đánh dấu
                  vùng cần AI chỉnh sửa.
                </span>
              </div>
              <ImageAnnotationCanvas
                key={preview}
                canvasRef={canvasRef}
                color={annotationColor}
                fileUrl={preview}
                onCountChange={updateAnnotationCount}
                onImageLoaded={() => setImageReady(true)}
                tool={annotationTool}
                width={annotationWidth}
              />
            </div>
          ) : (
            <label className="source-drop-input">
              <Upload size={28} aria-hidden="true" />
              <strong>Chọn ảnh gốc</strong>
              <span>Hỗ trợ PNG, JPG, WebP, GIF (tối đa 25MB)</span>
              <input type="file" accept="image/*" onChange={handleFileChange} />
            </label>
          )}
        </section>
        <section className="source-control-card">
          <h2>Yêu cầu chỉnh sửa</h2>
          {file && (
            <Button variant="secondary" onClick={() => setFile(undefined)}>
              <Upload size={15} aria-hidden="true" />
              Đổi ảnh khác
            </Button>
          )}
          {file && (
            <fieldset className="source-annotation-controls">
              <legend>Đánh dấu vùng cần sửa ({annotationCount})</legend>
              <div>
                <Button
                  type="button"
                  variant={annotationTool === "pen" ? "primary" : "secondary"}
                  onClick={() => setAnnotationTool("pen")}
                >
                  <Pencil size={15} aria-hidden="true" />
                  Bút
                </Button>
                <Button
                  type="button"
                  variant={
                    annotationTool === "rectangle" ? "primary" : "secondary"
                  }
                  onClick={() => setAnnotationTool("rectangle")}
                >
                  <Square size={15} aria-hidden="true" />
                  Khung
                </Button>
              </div>
              <label>
                Màu nét
                <input
                  aria-label="Màu nét vẽ"
                  type="color"
                  value={annotationColor}
                  onChange={(event) => setAnnotationColor(event.target.value)}
                />
              </label>
              <label>
                Độ dày <output>{annotationWidth}px</output>
                <input
                  aria-label="Độ dày nét vẽ"
                  type="range"
                  min={2}
                  max={80}
                  value={annotationWidth}
                  onChange={(event) =>
                    setAnnotationWidth(Number(event.target.value))
                  }
                />
              </label>
            </fieldset>
          )}
          <label>
            Prompt chỉnh sửa
            <textarea
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Mô tả thay đổi cần thực hiện (ví dụ: thay đổi bầu trời thành hoàng hôn, xóa đối tượng trong vùng chọn...)"
            />
          </label>
          <Button
            disabled={!file || !imageReady || !prompt.trim() || running}
            onClick={() => void edit()}
          >
            <Sparkles size={16} aria-hidden="true" />
            {running
              ? "Đang xử lý..."
              : !imageReady && file
                ? "Đang tải ảnh..."
                : "Tạo ảnh đã chỉnh sửa"}
          </Button>
        </section>
      </div>
      {result && (
        <section className="source-edit-result">
          <h2>Kết quả chỉnh sửa</h2>
          <div className="source-edit-result-grid">
            <img
              src={result.src}
              alt="Ảnh đã chỉnh sửa"
              className="source-edit-result-image"
            />
            <div className="source-edit-result-meta-card">
              <div className="source-meta-item">
                <span className="source-meta-label">Prompt:</span>
                <span className="source-meta-value">
                  {result.promptUsed || prompt}
                </span>
              </div>
              <div className="source-meta-item">
                <span className="source-meta-label">Tài khoản:</span>
                <span className="source-meta-value">
                  Slot {result.slotId ?? 0}
                </span>
              </div>
              {result.mediaId && (
                <div className="source-meta-item">
                  <span className="source-meta-label">Media ID:</span>
                  <code className="source-meta-code">{result.mediaId}</code>
                </div>
              )}
              {result.createdAt && (
                <div className="source-meta-item">
                  <span className="source-meta-label">Thời gian:</span>
                  <span className="source-meta-value">{result.createdAt}</span>
                </div>
              )}
            </div>
          </div>
          <div className="source-edit-result-actions">
            <a
              href={result.src}
              download={`edited-img-${Date.now()}.png`}
              className="source-task-action-link"
            >
              <Download
                size={15}
                className="source-action-icon--download"
                aria-hidden="true"
              />
              Tải ảnh về máy
            </a>
            {providerId === "veo3" && result.mediaId && (
              <>
                <fieldset className="source-image-crop-controls">
                  <legend>
                    <Crop size={14} aria-hidden="true" />
                    Crop theo tỷ lệ (0% - 100% kích thước ảnh gốc)
                  </legend>
                  {(["top", "left", "right", "bottom"] as const).map((edge) => (
                    <label key={edge}>
                      {edge === "top"
                        ? "Trên (%)"
                        : edge === "left"
                          ? "Trái (%)"
                          : edge === "right"
                            ? "Phải (%)"
                            : "Dưới (%)"}
                      <input
                        aria-label={`Crop ${edge}`}
                        type="number"
                        min={0}
                        max={100}
                        value={crop[edge]}
                        onChange={(event) =>
                          setCrop((current) => ({
                            ...current,
                            [edge]: Math.max(
                              0,
                              Math.min(100, Number(event.target.value)),
                            ),
                          }))
                        }
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={running}
                    onClick={() => void applyCrop()}
                  >
                    Crop ảnh
                  </Button>
                </fieldset>
                <div className="source-upscale-group">
                  <Button
                    variant="secondary"
                    disabled={running}
                    onClick={() => void upscale("2K")}
                  >
                    Upscale 2K
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={running}
                    onClick={() => void upscale("4K")}
                  >
                    Upscale 4K
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
