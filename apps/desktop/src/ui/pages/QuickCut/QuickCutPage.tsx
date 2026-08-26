import { Scissors, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { mediaApi } from "@/services/electron-api/media";

export function QuickCutPage() {
  const [file, setFile] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(10);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const select = async () => {
    const selected = await mediaApi.selectVideos();
    const first = Array.isArray(selected) ? selected[0] : selected;
    if (first) {
      setFile(String(first));
      setOutput("");
    }
  };
  const cut = async () => {
    if (!file || end <= start) return;
    setRunning(true);
    setError(undefined);
    try {
      setOutput(String((await mediaApi.trim(file, start, end)) || ""));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="source-tool-page" aria-labelledby="cut-title">
      <header>
        <div>
          <small>CHỈNH SỬA</small>
          <h1 id="cut-title">
            <Scissors size={22} />
            Cắt nhanh
          </h1>
          <p>Cắt một đoạn video cục bộ mà không thay đổi file gốc.</p>
        </div>
        <Button onClick={() => void select()}>
          <Upload size={16} />
          Chọn video
        </Button>
      </header>
      {error && (
        <p className="source-generation-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-tool-layout">
        <section className="source-tool-preview">
          {file ? (
            <video controls src={file} />
          ) : (
            <div className="source-generation-empty">
              <Scissors size={30} />
              <p>Chưa chọn video.</p>
            </div>
          )}
        </section>
        <section className="source-control-card">
          <h2>Khoảng cắt</h2>
          <label>
            Bắt đầu (giây)
            <input
              type="number"
              min="0"
              step="0.1"
              value={start}
              onChange={(event) => setStart(Number(event.target.value))}
            />
          </label>
          <label>
            Kết thúc (giây)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={end}
              onChange={(event) => setEnd(Number(event.target.value))}
            />
          </label>
          <Button
            disabled={!file || end <= start || running}
            onClick={() => void cut()}
          >
            {running ? "Đang xuất..." : "Xuất đoạn video"}
          </Button>
          {output && <p role="status">Đã lưu: {output}</p>}
        </section>
      </div>
    </section>
  );
}
