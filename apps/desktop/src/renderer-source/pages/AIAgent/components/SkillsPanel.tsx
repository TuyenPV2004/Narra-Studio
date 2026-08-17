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
      <header>
        <div>
          <small>LOCAL SKILLS</small>
          <h2>
            <BookOpen size={19} />
            Skill library
          </h2>
          <p>Đọc skill Markdown từ thư mục local qua IPC hiện có.</p>
        </div>
        <Button
          onClick={() =>
            void importSkill().catch((value) => setError(String(value)))
          }
        >
          <FolderOpen size={16} />
          Import skill
        </Button>
      </header>
      {error && (
        <p role="alert" className="source-generation-error">
          {error}
        </p>
      )}
      {skill ? (
        <div>
          <aside className="narra-card">
            <h3>{skill.name}</h3>
            <p>{skill.description}</p>
            {skill.groups.map((group) => (
              <button
                type="button"
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
          </aside>
          <main className="narra-card">
            {content ? (
              <pre>{JSON.stringify(content, null, 2)}</pre>
            ) : (
              <div className="source-generation-empty">
                <BookOpen size={28} />
                <p>Chọn nhóm skill để đọc nội dung.</p>
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
