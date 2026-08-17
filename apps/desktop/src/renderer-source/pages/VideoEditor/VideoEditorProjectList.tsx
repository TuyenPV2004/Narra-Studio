import { Film, FolderPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { VideoEditorProjectMeta } from "@/services/electron-api/video-editor";

interface VideoEditorProjectListProps {
  busy: boolean;
  projects: VideoEditorProjectMeta[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

export function VideoEditorProjectList({
  busy,
  onCreate,
  onDelete,
  onOpen,
  projects,
}: VideoEditorProjectListProps) {
  return (
    <section
      className="source-editor-projects source-video-editor-projects"
      aria-labelledby="video-editor-projects-title"
    >
      <header>
        <div>
          <small>VIDEO EDITOR</small>
          <h1 id="video-editor-projects-title">
            <Film size={22} />
            Project chỉnh sửa video
          </h1>
          <p>
            Project giữ trim, subtitle, nhạc nền, watermark và multi-clip
            timeline.
          </p>
        </div>
        <Button onClick={onCreate}>
          <FolderPlus size={16} />
          Project mới
        </Button>
      </header>
      <div className="source-project-grid">
        {projects.map((project) => (
          <article key={project.id} className="narra-card">
            <button
              type="button"
              onClick={() => onOpen(project.id)}
              disabled={busy}
            >
              <Film size={24} />
              <strong>{project.name}</strong>
              <span>{project.videoName || "Chưa có video"}</span>
            </button>
            <Button
              variant="ghost"
              aria-label={`Xóa ${project.name}`}
              onClick={() => onDelete(project.id)}
            >
              <Trash2 size={15} />
            </Button>
          </article>
        ))}
      </div>
      {!projects.length && (
        <div className="source-generation-empty">
          <Film size={30} />
          <p>Chưa có project video.</p>
        </div>
      )}
    </section>
  );
}
