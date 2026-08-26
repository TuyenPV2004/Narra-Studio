import { Camera, Clapperboard, FolderPlus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  directorApi,
  type DirectorSceneMeta,
} from "@/services/electron-api/director";

const drawCapture = (
  name: string,
  description: string,
  camera: string,
  lighting: string,
): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas capture không khả dụng.");
  const gradient = context.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, "#17131f");
  gradient.addColorStop(1, "#4a2784");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1280, 720);
  context.fillStyle = "#b794f6";
  context.fillRect(70, 70, 8, 580);
  context.fillStyle = "#ffffff";
  context.font = "700 48px system-ui";
  context.fillText(name || "Director Scene", 120, 160);
  context.font = "500 26px system-ui";
  context.fillStyle = "#e8ddf8";
  [description, `Camera: ${camera}`, `Lighting: ${lighting}`].forEach(
    (line, index) => context.fillText(line.slice(0, 80), 120, 250 + index * 62),
  );
  return canvas.toDataURL("image/png");
};

export function DirectorPanel() {
  const [scenes, setScenes] = useState<DirectorSceneMeta[]>([]);
  const [sceneId, setSceneId] = useState<string>();
  const [name, setName] = useState("Scene 1");
  const [description, setDescription] = useState("");
  const [camera, setCamera] = useState("Wide cinematic shot");
  const [lighting, setLighting] = useState("Soft key light");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const refresh = async () => setScenes(await directorApi.listScenes());
  useEffect(() => {
    void refresh().catch((value) => setError(String(value)));
  }, []);
  const save = async () => {
    const result = await directorApi.saveScene(sceneId, name, {
      description,
      camera,
      lighting,
    });
    const item = result as { id?: unknown };
    if (typeof item.id === "string") setSceneId(item.id);
    await refresh();
    setStatus("Đã lưu scene vào Director Desk.");
  };
  const load = async (id: string) => {
    const value = (await directorApi.loadScene(id)) as {
      id?: unknown;
      name?: unknown;
      scene?: unknown;
    };
    const scene =
      typeof value?.scene === "object" && value.scene !== null
        ? (value.scene as Record<string, unknown>)
        : {};
    setSceneId(typeof value.id === "string" ? value.id : id);
    setName(typeof value.name === "string" ? value.name : "Scene");
    setDescription(
      typeof scene.description === "string" ? scene.description : "",
    );
    setCamera(typeof scene.camera === "string" ? scene.camera : "");
    setLighting(typeof scene.lighting === "string" ? scene.lighting : "");
  };
  const capture = async () => {
    await directorApi.saveCapture(
      sceneId,
      name,
      drawCapture(name, description, camera, lighting),
    );
    setStatus("Đã lưu director capture PNG.");
  };
  const createProject = async () => {
    const result = (await directorApi.createStoryProject(
      name,
      description,
      `${camera}; ${lighting}`,
    )) as { projectDir?: unknown };
    setStatus(
      typeof result.projectDir === "string"
        ? `Đã tạo story project: ${result.projectDir}`
        : "Đã tạo story project.",
    );
  };
  return (
    <section className="source-director-panel">
      <aside className="narra-card">
        <header className="source-director-aside-header">
          <h2>Danh sách Scene</h2>
          <Button
            type="button"
            variant="secondary"
            aria-label="Scene mới"
            onClick={() => {
              setSceneId(undefined);
              setName(`Scene ${scenes.length + 1}`);
              setDescription("");
            }}
          >
            <Clapperboard size={15} />
            Scene mới
          </Button>
        </header>
        <div className="source-director-scene-list">
          {scenes.map((scene) => (
            <button
              type="button"
              key={scene.id}
              className="source-director-scene-item"
              data-active={scene.id === sceneId}
              onClick={() =>
                void load(scene.id).catch((value) => setError(String(value)))
              }
            >
              <strong>{scene.name}</strong>
              <small>{new Date(scene.updatedAt).toLocaleString("vi-VN")}</small>
            </button>
          ))}
          {!scenes.length && (
            <p className="source-director-empty-text">
              Chưa có scene được lưu.
            </p>
          )}
        </div>
      </aside>
      <main className="narra-card">
        <header className="source-director-main-header">
          <div>
            <small className="source-agent-hero__tag">DIRECTOR DESK</small>
            <h2>
              <Camera size={18} />
              {name}
            </h2>
          </div>
          <div className="source-director-main-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void capture().catch((value) => setError(String(value)))
              }
            >
              <Camera size={15} />
              Chụp frame
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                void save().catch((value) => setError(String(value)))
              }
            >
              <Save size={15} />
              Lưu scene
            </Button>
          </div>
        </header>
        <div className="source-control-field">
          <span className="source-control-label-text">
            Tên scene <span className="source-required-mark">*</span>
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ví dụ: Scene 1"
          />
        </div>
        <div className="source-control-field">
          <span className="source-control-label-text">Mô tả phân cảnh</span>
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Mô tả hành động, góc máy, ánh sáng, diễn viên..."
          />
        </div>
        <div className="source-director-camera-lighting-grid">
          <div className="source-control-field">
            <span className="source-control-label-text">Góc máy (Camera)</span>
            <Input
              value={camera}
              onChange={(event) => setCamera(event.target.value)}
              placeholder="Ví dụ: Wide cinematic shot, close-up..."
            />
          </div>
          <div className="source-control-field">
            <span className="source-control-label-text">
              Ánh sáng (Lighting)
            </span>
            <Input
              value={lighting}
              onChange={(event) => setLighting(event.target.value)}
              placeholder="Ví dụ: Soft key light, golden hour..."
            />
          </div>
        </div>
        <section className="source-director-preview">
          <span>DIRECTOR PREVIEW</span>
          <h3>{name}</h3>
          <p>{description || "Mô tả phân cảnh sẽ hiển thị tại đây."}</p>
          <small>
            {camera} · {lighting}
          </small>
        </section>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void createProject().catch((value) => setError(String(value)))
          }
        >
          <FolderPlus size={15} />
          Tạo story project folder
        </Button>
        {status && <p role="status">{status}</p>}
        {error && (
          <p role="alert" className="source-generation-error">
            {error}
          </p>
        )}
      </main>
    </section>
  );
}
