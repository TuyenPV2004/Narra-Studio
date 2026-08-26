import { BookOpen, FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  skillsApi,
  type ImportedSkill,
  type SkillGroup,
} from "@/services/electron-api/skills";

export function SkillsPanel() {
  const [skill, setSkill] = useState<ImportedSkill>();
  const [selected, setSelected] = useState<SkillGroup>();
  const [content, setContent] = useState<unknown>();
  const [error, setError] = useState<string>();
  const importSkill = async () => {
    const value = await skillsApi.import();
    if (value) {
      setSkill(value);
      setSelected(value.groups[0]);
      setContent(undefined);
    }
  };
  const read = async (group: SkillGroup) => {
    if (!skill) return;
    setSelected(group);
    setContent(await skillsApi.read(skill.rootPath, group));
  };
  return (
    <section className="source-agent-skills">
      <header className="source-agent-skills__header">
        <div>
          <small className="source-agent-hero__tag">LOCAL SKILLS</small>
          <h2>
            <BookOpen size={18} />
            Thư viện Skill
          </h2>
          <p>Tập hợp các kỹ năng và quy trình AI agent được lưu cục bộ.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void importSkill().catch((value) => setError(String(value)))
          }
        >
          <FolderOpen size={15} />
          Import skill
        </Button>
      </header>
      {error && (
        <p role="alert" className="source-generation-error">
          {error}
        </p>
      )}
      {skill ? (
        <div className="source-agent-skills__content">
          <aside className="narra-card">
            <div className="source-agent-skills__meta">
              <h3>{skill.name}</h3>
              <p>{skill.description}</p>
            </div>
            <div className="source-agent-skills__group-list">
              {skill.groups.map((group) => (
                <button
                  type="button"
                  className="source-agent-skills__group-item"
                  data-active={selected?.id === group.id}
                  key={group.id}
                  onClick={() =>
                    void read(group).catch((value) => setError(String(value)))
                  }
                >
                  <strong>{group.name}</strong>
                  <small>
                    {group.description || `${group.children.length} tài liệu`}
                  </small>
                </button>
              ))}
            </div>
          </aside>
          <main className="narra-card source-agent-skills__main">
            {content ? (
              <div className="source-agent-skills__code-container">
                <header className="source-agent-skills__code-header">
                  <span>{selected?.name || "Skill Content"}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        JSON.stringify(content, null, 2),
                      );
                    }}
                  >
                    Sao chép
                  </Button>
                </header>
                <pre>{JSON.stringify(content, null, 2)}</pre>
              </div>
            ) : (
              <div className="source-generation-empty">
                <BookOpen size={28} />
                <p>Chọn một nhóm skill ở cột bên trái để xem nội dung.</p>
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className="source-generation-empty">
          <BookOpen size={30} />
          <p>Import SKILL.md hoặc thư mục skill để bắt đầu.</p>
        </div>
      )}
    </section>
  );
}
