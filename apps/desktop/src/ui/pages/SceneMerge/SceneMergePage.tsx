import {
  ArrowDown,
  ArrowUp,
  Clock3,
  FolderOpen,
  Layers3,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { mediaApi } from "@/services/electron-api/media";
import { historyApi } from "@/services/electron-api/history";

const HISTORY_KEY = "concat-history";
interface MergeHistoryItem {
  id: string;
  src: string;
  sourceCount: number;
  time: string;
}
const parseHistory = (value: unknown): MergeHistoryItem[] =>
  (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.src !== "string")
      return [];
    return [
      {
        id: entry.id,
        src: entry.src,
        sourceCount:
          typeof entry.sourceCount === "number" ? entry.sourceCount : 0,
        time:
          typeof entry.time === "string"
            ? entry.time
            : new Date().toISOString(),
      },
    ];
  });

export function SceneMergePage() {
  const [files, setFiles] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [history, setHistory] = useState<MergeHistoryItem[]>([]);
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void historyApi
      .load(HISTORY_KEY)
      .then((value) => {
        if (!cancelled) setHistory(parseHistory(value));
      })
      .catch((value: unknown) => {
        if (!cancelled)
          setError(value instanceof Error ? value.message : String(value));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const select = async () => {
    const selected = await mediaApi.selectVideos();
    const values = Array.isArray(selected)
      ? selected.map(String)
      : selected
        ? [String(selected)]
        : [];
    setFiles((current) => [
      ...current,
      ...values.filter((value) => !current.includes(value)),
    ]);
  };
  const merge = async () => {
    if (files.length < 2) return;
    setRunning(true);
    setError(undefined);
    try {
      const output = String((await mediaApi.concat(files)) || "");
      setResult(output);
      if (output) {
        const item = {
          id: crypto.randomUUID(),
          src: output,
          sourceCount: files.length,
          time: new Date().toISOString(),
        };
        const next = [item, ...history].slice(0, 50);
        setHistory(next);
        await historyApi.save(HISTORY_KEY, next);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setRunning(false);
    }
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    setFiles((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const removeHistory = async (id: string) => {
    const next = history.filter((item) => item.id !== id);
    setHistory(next);
    await historyApi.save(HISTORY_KEY, next);
  };
  return (
    <section className="source-tool-page" aria-labelledby="merge-title">
      <header>
        <div>
          <small>CHỈNH SỬA</small>
          <h1 id="merge-title">
            <Layers3 size={22} />
            Ghép cảnh
          </h1>
          <p>Ghép các video cục bộ theo đúng thứ tự bên dưới.</p>
        </div>
        <Button onClick={() => void select()}>
          <Plus size={16} />
          Thêm video
        </Button>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-tool-layout">
        <section className="source-file-queue">
          <h2>
            Thứ tự cảnh <span>{files.length}</span>
          </h2>
          {files.length === 0 ? (
            <div className="source-generation-empty">
              <FolderOpen size={30} />
              <p>Chọn ít nhất hai video.</p>
            </div>
          ) : (
            files.map((file, index) => (
              <article key={`${file}-${index}`}>
                <span>{index + 1}</span>
                <strong title={file}>{file.split(/[\\/]/).pop()}</strong>
                <button
                  type="button"
                  aria-label={`Di chuyển cảnh ${index + 1} lên`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Di chuyển cảnh ${index + 1} xuống`}
                  disabled={index === files.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Xóa khỏi danh sách"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </article>
            ))
          )}
          <Button
            disabled={files.length < 2 || running}
            onClick={() => void merge()}
          >
            {running ? "Đang ghép..." : `Ghép ${files.length} video`}
          </Button>
        </section>
        <section className="source-tool-preview">
          <h2>Kết quả</h2>
          {result ? (
            <video controls src={result} />
          ) : (
            <div className="source-generation-empty">
              <Layers3 size={30} />
              <p>Video sau khi ghép sẽ xuất hiện ở đây.</p>
            </div>
          )}
          {history.length > 0 && (
            <section
              className="source-merge-history"
              aria-label="Lịch sử ghép cảnh"
            >
              <h3>
                <Clock3 size={16} />
                Lịch sử ({history.length})
              </h3>
              {history.map((item) => (
                <article key={item.id}>
                  <button type="button" onClick={() => setResult(item.src)}>
                    <strong>{item.sourceCount} cảnh</strong>
                    <small>{new Date(item.time).toLocaleString("vi-VN")}</small>
                  </button>
                  <Button
                    variant="ghost"
                    aria-label="Xóa kết quả khỏi lịch sử"
                    onClick={() =>
                      void removeHistory(item.id).catch((value) =>
                        setError(String(value)),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </article>
              ))}
            </section>
          )}
        </section>
      </div>
    </section>
  );
}
