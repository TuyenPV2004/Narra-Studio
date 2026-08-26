import {
  Crop,
  Gauge,
  ImagePlus,
  Move,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  editorApi,
  editorClipDuration,
  type EditorClip,
  type EditorEffect,
  type EditorTransition,
} from "@/services/electron-api/editor";
import { CapcutToolsPanel } from "@/pages/CapcutEditor/CapcutToolsPanel";

export const builtInTransitions: EditorTransition[] = [
  { libraryId: "basic-fade", name: "Fade", type: "fade", duration: 0.5 },
  {
    libraryId: "basic-dissolve",
    name: "Dissolve",
    type: "dissolve",
    duration: 0.7,
  },
  {
    libraryId: "wipe-left",
    name: "Wipe Left",
    type: "wipeleft",
    duration: 0.5,
  },
  {
    libraryId: "slide-left",
    name: "Slide Left",
    type: "slideleft",
    duration: 0.5,
  },
];
export const builtInEffects: EditorEffect[] = [
  {
    libraryId: "soft-focus",
    name: "Soft Focus",
    type: "blur",
    params: { size: 60, amount: 30, strength: 50 },
    startTime: 0,
    endTime: 0,
  },
  {
    libraryId: "vhs",
    name: "VHS",
    type: "color",
    params: { amount: 80, strength: 60, filters: 50 },
    startTime: 0,
    endTime: 0,
  },
  {
    libraryId: "film-grain",
    name: "Film Grain",
    type: "color",
    params: { amount: 50, strength: 70, filters: 40 },
    startTime: 0,
    endTime: 0,
  },
  {
    libraryId: "quick-pan",
    name: "Quick Pan",
    type: "motion",
    params: { amount: 50, speed: 80 },
    startTime: 0,
    endTime: 0,
  },
];

interface ClipInspectorProps {
  clip: EditorClip;
  hasNextClip: boolean;
  transitions?: EditorTransition[];
  effects?: EditorEffect[];
  onChange: (patch: Partial<EditorClip>) => void;
  onTransitionChange: (transition?: EditorTransition) => void;
}

export function ClipInspector({
  clip,
  effects = builtInEffects,
  hasNextClip,
  onChange,
  onTransitionChange,
  transitions = builtInTransitions,
}: ClipInspectorProps) {
  const start = clip.sourceStart ?? 0;
  const end = clip.sourceEnd ?? clip.duration;
  const textOverlay = clip.textOverlays?.[0];
  const stickerOverlay = clip.stickerOverlays?.[0];
  const activeEffect = clip.effects?.[0];
  const updateTextOverlay = (
    patch: Partial<NonNullable<EditorClip["textOverlays"]>[number]>,
  ) => {
    const next = {
      ...(textOverlay ?? {
        text: "",
        fontSize: 32,
        color: "#ffffff",
        position: "center" as const,
        startTime: 0,
        endTime: editorClipDuration(clip),
      }),
      ...patch,
    };
    onChange({ textOverlays: next.text.trim() ? [next] : [] });
  };
  const updateStickerOverlay = (emoji: string) =>
    onChange({
      stickerOverlays: emoji
        ? [
            {
              format: "emoji",
              emoji,
              scale: stickerOverlay?.scale ?? 1,
              posX: stickerOverlay?.posX ?? 0,
              posY: stickerOverlay?.posY ?? 0,
              rotation: stickerOverlay?.rotation ?? 0,
              opacity: stickerOverlay?.opacity ?? 1,
              startTime: 0,
              endTime: editorClipDuration(clip),
            },
          ]
        : [],
    });
  const pickSticker = async () => {
    const path = await editorApi.selectSticker();
    if (!path) return;
    const format = /\.gif$/i.test(path) ? ("gif" as const) : ("image" as const);
    onChange({
      stickerOverlays: [
        {
          format,
          filePath: path,
          scale: 1,
          posX: 0,
          posY: 0,
          rotation: 0,
          opacity: 1,
          startTime: 0,
          endTime: editorClipDuration(clip),
        },
      ],
    });
  };
  const updateEffect = (libraryId: string) => {
    const effect = effects.find((item) => item.libraryId === libraryId);
    onChange({
      effects: effect ? [{ ...effect, endTime: editorClipDuration(clip) }] : [],
    });
  };
  const speedKeyframes = clip.speedCurveKeyframes ?? [
    { t: 0.15, s: 1 },
    { t: 0.5, s: 1 },
    { t: 0.85, s: 1 },
  ];
  const updateSpeedKeyframe = (index: number, speed: number) =>
    onChange({
      speedCurve: "custom",
      speedCurveKeyframes: speedKeyframes.map((item, itemIndex) =>
        itemIndex === index ? { ...item, s: speed } : item,
      ),
    });
  const crop = clip.crop ?? {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
  };
  const updateCrop = (patch: Partial<typeof crop>) =>
    onChange({ crop: { ...crop, ...patch } });
  return (
    <section
      className="source-clip-inspector"
      aria-labelledby="clip-inspector-title"
    >
      <header>
        <SlidersHorizontal size={17} />
        <h3 id="clip-inspector-title">Điều chỉnh clip</h3>
      </header>
      <label>
        Bắt đầu (giây)
        <input
          type="number"
          min={0}
          max={end}
          step={0.1}
          value={start}
          onChange={(event) =>
            onChange({
              sourceStart: Math.min(
                end,
                Math.max(0, Number(event.target.value)),
              ),
            })
          }
        />
      </label>
      <label>
        Kết thúc (giây)
        <input
          type="number"
          min={start}
          max={clip.duration}
          step={0.1}
          value={end}
          onChange={(event) =>
            onChange({
              sourceEnd: Math.max(
                start,
                Math.min(clip.duration, Number(event.target.value)),
              ),
            })
          }
        />
      </label>
      <label>
        <span>
          <Gauge size={14} />
          Tốc độ <output>{(clip.speed ?? 1).toFixed(2)}×</output>
        </span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.25}
          value={clip.speed ?? 1}
          onChange={(event) => onChange({ speed: Number(event.target.value) })}
        />
      </label>
      <details>
        <summary>Đường cong tốc độ</summary>
        <label>
          Chế độ
          <select
            aria-label="Chế độ đường cong tốc độ"
            value={clip.speedCurve ?? "none"}
            onChange={(event) =>
              onChange(
                event.target.value === "none"
                  ? { speedCurve: "none" }
                  : {
                      speedCurve: event.target.value,
                      speedCurveKeyframes: speedKeyframes,
                    },
              )
            }
          >
            <option value="none">Tắt</option>
            <option value="custom">Tùỳ chỉnh</option>
          </select>
        </label>
        {clip.speedCurve &&
          clip.speedCurve !== "none" &&
          speedKeyframes.map((item, index) => (
            <label key={item.t}>
              <span>
                Điểm {index + 1} · {Math.round(item.t * 100)}%{" "}
                <output>{item.s.toFixed(2)}×</output>
              </span>
              <input
                aria-label={`Tốc độ keyframe ${index + 1}`}
                type="range"
                min={0.0625}
                max={8}
                step={0.0625}
                value={item.s}
                onChange={(event) =>
                  updateSpeedKeyframe(index, Number(event.target.value))
                }
              />
            </label>
          ))}
        <label>
          <input
            type="checkbox"
            checked={clip.changeAudioPitch ?? false}
            onChange={(event) =>
              onChange({ changeAudioPitch: event.target.checked })
            }
          />
          Đổi cao độ âm thanh theo tốc độ
        </label>
      </details>
      <label>
        <span>
          Độ sáng <output>{Math.round((clip.brightness ?? 0) * 100)}</output>
        </span>
        <input
          type="range"
          min={-0.6}
          max={0.6}
          step={0.05}
          value={clip.brightness ?? 0}
          onChange={(event) =>
            onChange({ brightness: Number(event.target.value) })
          }
        />
      </label>
      <label>
        <span>
          Tương phản <output>{Math.round((clip.contrast ?? 1) * 100)}%</output>
        </span>
        <input
          type="range"
          min={0.4}
          max={1.8}
          step={0.05}
          value={clip.contrast ?? 1}
          onChange={(event) =>
            onChange({ contrast: Number(event.target.value) })
          }
        />
      </label>
      <label>
        <span>
          Bão hòa <output>{Math.round((clip.saturation ?? 1) * 100)}%</output>
        </span>
        <input
          type="range"
          min={0}
          max={2.5}
          step={0.05}
          value={clip.saturation ?? 1}
          onChange={(event) =>
            onChange({ saturation: Number(event.target.value) })
          }
        />
      </label>
      <details>
        <summary>
          <Move size={14} />
          Biến đổi
        </summary>
        <label>
          <span>
            Tỷ lệ <output>{clip.scale ?? 100}%</output>
          </span>
          <input
            aria-label="Tỷ lệ clip"
            type="range"
            min={10}
            max={300}
            value={clip.scale ?? 100}
            onChange={(event) =>
              onChange({ scale: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>
            Vị trí X <output>{clip.posX ?? 0}px</output>
          </span>
          <input
            aria-label="Vị trí X"
            type="range"
            min={-960}
            max={960}
            value={clip.posX ?? 0}
            onChange={(event) => onChange({ posX: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>
            Vị trí Y <output>{clip.posY ?? 0}px</output>
          </span>
          <input
            aria-label="Vị trí Y"
            type="range"
            min={-540}
            max={540}
            value={clip.posY ?? 0}
            onChange={(event) => onChange({ posY: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>
            Xoay <output>{clip.rotation ?? 0}°</output>
          </span>
          <input
            aria-label="Xoay clip"
            type="range"
            min={-180}
            max={180}
            value={clip.rotation ?? 0}
            onChange={(event) =>
              onChange({ rotation: Number(event.target.value) })
            }
          />
        </label>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ flipH: !clip.flipH })}
          >
            Lật ngang
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ flipV: !clip.flipV })}
          >
            Lật dọc
          </Button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={clip.blendEnabled ?? false}
            onChange={(event) =>
              onChange({ blendEnabled: event.target.checked })
            }
          />
          Bật hòa trộn
        </label>
        {clip.blendEnabled && (
          <>
            <label>
              Chế độ hòa trộn
              <select
                value={clip.blendMode ?? "normal"}
                onChange={(event) =>
                  onChange({ blendMode: event.target.value })
                }
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="overlay">Overlay</option>
                <option value="softlight">Soft light</option>
              </select>
            </label>
            <label>
              <span>
                Độ mờ <output>{clip.opacity ?? 100}%</output>
              </span>
              <input
                aria-label="Độ mờ clip"
                type="range"
                min={0}
                max={100}
                value={clip.opacity ?? 100}
                onChange={(event) =>
                  onChange({ opacity: Number(event.target.value) })
                }
              />
            </label>
          </>
        )}
      </details>
      <details>
        <summary>
          <Crop size={14} />
          Cắt khung
        </summary>
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key}>
            <span>
              {key.toUpperCase()} <output>{crop[key]}%</output>
            </span>
            <input
              aria-label={`Crop ${key}`}
              type="range"
              min={0}
              max={key === "width" || key === "height" ? 100 : 95}
              value={crop[key]}
              onChange={(event) =>
                updateCrop({ [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChange({
              crop: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
            })
          }
        >
          Đặt lại crop
        </Button>
      </details>
      <label>
        Chuyển cảnh
        <select
          aria-label="Chuyển cảnh sau clip"
          disabled={!hasNextClip}
          value={clip.transitionOut?.libraryId || ""}
          onChange={(event) =>
            onTransitionChange(
              transitions.find((item) => item.libraryId === event.target.value),
            )
          }
        >
          <option value="">Không dùng</option>
          {transitions.map((item) => (
            <option key={item.libraryId} value={item.libraryId}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {clip.transitionOut && hasNextClip && (
        <label>
          <span>
            Thời lượng chuyển cảnh{" "}
            <output>{clip.transitionOut.duration.toFixed(1)}s</output>
          </span>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={clip.transitionOut.duration}
            onChange={(event) =>
              onTransitionChange({
                ...clip.transitionOut!,
                duration: Number(event.target.value),
              })
            }
          />
        </label>
      )}
      <label>
        Chữ trên clip
        <input
          aria-label="Nội dung chữ trên clip"
          value={textOverlay?.text || ""}
          placeholder="Nhập tiêu đề hoặc chú thích"
          onChange={(event) => updateTextOverlay({ text: event.target.value })}
        />
      </label>
      {textOverlay && (
        <>
          <label>
            <span>
              Cỡ chữ <output>{textOverlay.fontSize}px</output>
            </span>
            <input
              type="range"
              min={16}
              max={96}
              step={2}
              value={textOverlay.fontSize}
              onChange={(event) =>
                updateTextOverlay({ fontSize: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Màu chữ
            <input
              type="color"
              value={textOverlay.color}
              onChange={(event) =>
                updateTextOverlay({ color: event.target.value })
              }
            />
          </label>
          <label>
            Vị trí
            <select
              value={textOverlay.position}
              onChange={(event) =>
                updateTextOverlay({
                  position: event.target.value as "bottom" | "center" | "top",
                })
              }
            >
              <option value="top">Trên</option>
              <option value="center">Giữa</option>
              <option value="bottom">Dưới</option>
            </select>
          </label>
        </>
      )}
      <label>
        <span>
          Âm thanh vào <output>{(clip.fadeIn ?? 0).toFixed(1)}s</output>
        </span>
        <input
          aria-label="Fade in âm thanh"
          type="range"
          min={0}
          max={Math.max(0, editorClipDuration(clip) / 2)}
          step={0.1}
          value={clip.fadeIn ?? 0}
          onChange={(event) => onChange({ fadeIn: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>
          Âm thanh ra <output>{(clip.fadeOut ?? 0).toFixed(1)}s</output>
        </span>
        <input
          aria-label="Fade out âm thanh"
          type="range"
          min={0}
          max={Math.max(0, editorClipDuration(clip) / 2)}
          step={0.1}
          value={clip.fadeOut ?? 0}
          onChange={(event) =>
            onChange({ fadeOut: Number(event.target.value) })
          }
        />
      </label>
      <details>
        <summary>
          <Volume2 size={14} />
          Âm lượng
        </summary>
        <label>
          <span>
            Âm lượng clip <output>{clip.volume ?? 100}%</output>
          </span>
          <input
            aria-label="Âm lượng clip"
            type="range"
            min={0}
            max={200}
            value={clip.volume ?? 100}
            onChange={(event) =>
              onChange({ volume: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={clip.muted ?? false}
            onChange={(event) => onChange({ muted: event.target.checked })}
          />
          Tắt tiếng clip
        </label>
      </details>
      <label>
        Sticker emoji
        <select
          aria-label="Sticker emoji"
          value={
            stickerOverlay?.format === "emoji" ? stickerOverlay.emoji || "" : ""
          }
          onChange={(event) => updateStickerOverlay(event.target.value)}
        >
          <option value="">Không dùng</option>
          <option value="🔥">Fire</option>
          <option value="✨">Sparkles</option>
          <option value="🚀">Rocket</option>
          <option value="👑">Crown</option>
        </select>
      </label>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void pickSticker()}
      >
        <ImagePlus size={15} />
        Chọn ảnh/GIF sticker
      </Button>
      {stickerOverlay && stickerOverlay.format !== "emoji" && (
        <p>
          Sticker file:{" "}
          <strong>
            {String(stickerOverlay.filePath || stickerOverlay.src || "Ảnh")}
          </strong>
        </p>
      )}
      {stickerOverlay && (
        <label>
          <span>
            Kích thước sticker{" "}
            <output>{Math.round(stickerOverlay.scale * 100)}%</output>
          </span>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={stickerOverlay.scale}
            onChange={(event) =>
              onChange({
                stickerOverlays: [
                  { ...stickerOverlay, scale: Number(event.target.value) },
                ],
              })
            }
          />
        </label>
      )}
      <label>
        Hiệu ứng
        <select
          aria-label="Hiệu ứng clip"
          value={activeEffect?.libraryId || ""}
          onChange={(event) => updateEffect(event.target.value)}
        >
          <option value="">Không dùng</option>
          {effects.map((item) => (
            <option key={item.libraryId} value={item.libraryId}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        Thời lượng output:{" "}
        <strong>{editorClipDuration(clip).toFixed(1)} giây</strong>
      </p>
      <CapcutToolsPanel
        clip={clip}
        onDeflicker={(suggestion) =>
          onChange({ removeFlickers: true, removeFlickersCfg: suggestion })
        }
        onLipSyncChange={(config) =>
          onChange({
            lipSync: true,
            lipSyncCfg: { ...clip.lipSyncCfg, ...config },
          })
        }
      />
    </section>
  );
}
