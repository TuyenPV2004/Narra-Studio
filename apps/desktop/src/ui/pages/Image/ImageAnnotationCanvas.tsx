import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

export type AnnotationTool = "pen" | "rectangle";
interface Point {
  x: number;
  y: number;
}
interface Annotation {
  color: string;
  kind: AnnotationTool;
  points: Point[];
  width: number;
}

const draw = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  annotations: Annotation[],
  draft?: Annotation,
) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const annotation of draft ? [...annotations, draft] : annotations) {
    if (annotation.points.length < 2) continue;
    context.strokeStyle = annotation.color;
    context.lineWidth = annotation.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    const first = annotation.points[0]!;
    context.moveTo(first.x, first.y);
    if (annotation.kind === "rectangle") {
      const last = annotation.points.at(-1)!;
      context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else {
      for (const point of annotation.points.slice(1))
        context.lineTo(point.x, point.y);
      context.stroke();
    }
  }
};

const MAX_CANVAS_DIMENSION = 4096;

export function ImageAnnotationCanvas({
  canvasRef,
  color,
  fileUrl,
  onCountChange,
  onImageLoaded,
  tool,
  width,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  color: string;
  fileUrl: string;
  onCountChange: (count: number) => void;
  onImageLoaded?: () => void;
  tool: AnnotationTool;
  width: number;
}) {
  const imageRef = useRef<HTMLImageElement | undefined>(undefined);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation>();
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let targetWidth = image.naturalWidth || 800;
      let targetHeight = image.naturalHeight || 600;
      if (
        targetWidth > MAX_CANVAS_DIMENSION ||
        targetHeight > MAX_CANVAS_DIMENSION
      ) {
        if (targetWidth >= targetHeight) {
          targetHeight = Math.round(
            (targetHeight * MAX_CANVAS_DIMENSION) / targetWidth,
          );
          targetWidth = MAX_CANVAS_DIMENSION;
        } else {
          targetWidth = Math.round(
            (targetWidth * MAX_CANVAS_DIMENSION) / targetHeight,
          );
          targetHeight = MAX_CANVAS_DIMENSION;
        }
      }
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      imageRef.current = image;
      draw(canvas, image, []);
      onImageLoaded?.();
    };
    image.src = fileUrl;
    return () => {
      image.onload = null;
    };
  }, [canvasRef, fileUrl, onImageLoaded]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && imageRef.current)
      draw(canvas, imageRef.current, annotations, draft);
    onCountChange(annotations.length);
  }, [annotations, canvasRef, draft, onCountChange]);
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * event.currentTarget.width) / rect.width,
      y:
        ((event.clientY - rect.top) * event.currentTarget.height) / rect.height,
    };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ color, kind: tool, points: [point(event)], width });
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) =>
    setDraft((current) =>
      current
        ? { ...current, points: [...current.points, point(event)] }
        : current,
    );
  const finish = () => {
    setDraft((current) => {
      if (current && current.points.length > 1)
        setAnnotations((items) => [...items, current]);
      return undefined;
    });
  };
  return (
    <div className="source-image-annotation">
      <canvas
        ref={canvasRef}
        aria-label="Vùng vẽ chỉnh sửa ảnh"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div>
        <button
          type="button"
          disabled={!annotations.length}
          onClick={() => setAnnotations((items) => items.slice(0, -1))}
        >
          Hoàn tác
        </button>
        <button
          type="button"
          disabled={!annotations.length}
          onClick={() => setAnnotations([])}
        >
          Xóa nét vẽ
        </button>
      </div>
    </div>
  );
}
