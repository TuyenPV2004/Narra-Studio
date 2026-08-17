import {
  Download,
  Images,
  Pencil,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { imageApi } from "@/services/electron-api/image";
import type { ProviderId } from "@/types/electron-api";
import {
  ImageAnnotationCanvas,
  type AnnotationTool,
} from "@/pages/Image/ImageAnnotationCanvas";

export function ImageEditorPage({ providerId }: { providerId: ProviderId }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<{
    mediaId: string | null;
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
  const [model, setModel] = useState(
    providerId === "avis" ? "seedream-4-5" : "NARWHAL",
  );
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    setModel(providerId === "avis" ? "seedream-4-5" : "NARWHAL");
    if (providerId === "avis")
      void imageApi
        .listAvisModels()
        .then((items) => setModel(items[0]?.value || "seedream-4-5"))
        .catch(() => undefined);
  }, [providerId]);
  const edit = async () => {
    if (!file || !prompt.trim() || !canvasRef.current) return;
    setRunning(true);
    setError(undefined);
    try {
      const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.92);
      const output =
        providerId === "veo3"
          ? await imageApi.editVeoImage({ dataUrl, prompt: prompt.trim() })
          : await (async () => {
              const blob = await (await fetch(dataUrl)).blob();
              const referenceImage = new File(
                [blob],
                `edit-${Date.now()}.jpg`,
                { type: "image/jpeg" },
              );
              return imageApi.generate({
                providerId,
                prompt: prompt.trim(),
                model,
                aspect: "16:9",
                seed: Math.floor(Math.random() * 9_999_999),
                referenceImage,
              });
            })();
      setResult(output);
      await imageApi.save(output.src);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setRunning(false);
    }
  };
  const upscale = async (resolution: "2K" | "4K") => {
    if (!result?.mediaId) return;
    setRunning(true);
    setError(undefined);
    try {
      setResult({
        ...result,
        src: await imageApi.upscale(result.mediaId, resolution),
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
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
      setError("Vùng crop không hợp lệ.");
      return;
    }
    setRunning(true);
    setError(undefined);
    try {
      setResult(await imageApi.crop(result.mediaId, coordinates));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
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
            <Images size={22} />
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
            <ImageAnnotationCanvas
              canvasRef={canvasRef}
              color={annotationColor}
              fileUrl={preview}
              onCountChange={updateAnnotationCount}
              tool={annotationTool}
              width={annotationWidth}
            />
          ) : (
            <label className="source-drop-input">
              <Upload size={28} />
              <strong>Chọn ảnh gốc</strong>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
          )}
        </section>
        <section className="source-control-card">
          <h2>Yêu cầu chỉnh sửa</h2>
          {file && (
            <Button variant="secondary" onClick={() => setFile(undefined)}>
              <Upload size={15} />
              Đổi ảnh
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
                  <Pencil size={15} />
                  Bút
                </Button>
                <Button
                  type="button"
                  variant={
                    annotationTool === "rectangle" ? "primary" : "secondary"
                  }
                  onClick={() => setAnnotationTool("rectangle")}
                >
                  <Square size={15} />
                  Khung
                </Button>
              </div>
              <label>
                Màu
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
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            Prompt
            <textarea
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Mô tả thay đổi cần thực hiện..."
            />
          </label>
          <Button
            disabled={!file || !prompt.trim() || running}
            onClick={() => void edit()}
          >
            <Sparkles size={16} />
            {running ? "Đang xử lý..." : "Tạo ảnh đã chỉnh sửa"}
          </Button>
        </section>
      </div>
      {result && (
        <section className="source-edit-result">
          <h2>Kết quả</h2>
          <img src={result.src} alt="Ảnh đã chỉnh sửa" />
          <div>
            <a href={result.src} download>
              <Download size={15} />
              Tải ảnh
            </a>
            {providerId === "veo3" && result.mediaId && (
              <>
                <fieldset className="source-image-crop-controls">
                  <legend>Crop theo phần trăm</legend>
                  {(["top", "left", "right", "bottom"] as const).map((edge) => (
                    <label key={edge}>
                      {edge === "top"
                        ? "Trên"
                        : edge === "left"
                          ? "Trái"
                          : edge === "right"
                            ? "Phải"
                            : "Dưới"}
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
              </>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
