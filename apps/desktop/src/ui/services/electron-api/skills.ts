import { getElectronApi } from "@/services/electron-api/client";

export interface ImportedSkill {
  rootPath: string;
  name: string;
  description: string;
  groups: SkillGroup[];
}
export interface SkillGroup {
  id: string;
  name: string;
  description: string;
  children: { id: string; name: string }[];
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const group = (value: unknown): SkillGroup | undefined => {
  const item = object(value);
  const id =
    typeof item.id === "string"
      ? item.id
      : typeof item.slug === "string"
        ? item.slug
        : typeof item.name === "string"
          ? item.name
          : "";
  if (!id) return;
  const children = (Array.isArray(item.children) ? item.children : [])
    .map(object)
    .flatMap((child) =>
      typeof child.id === "string"
        ? [
            {
              id: child.id,
              name: typeof child.name === "string" ? child.name : child.id,
            },
          ]
        : [],
    );
  return {
    id,
    name: typeof item.name === "string" ? item.name : id,
    description: typeof item.description === "string" ? item.description : "",
    children,
  };
};
export const skillsApi = {
  async import(): Promise<ImportedSkill | undefined> {
    const result = object(await getElectronApi().importSkillFolder());
    if (result.ok !== true || typeof result.rootPath !== "string") return;
    return {
      rootPath: result.rootPath,
      name: typeof result.name === "string" ? result.name : "Skill",
      description:
        typeof result.description === "string" ? result.description : "",
      groups: (Array.isArray(result.groups) ? result.groups : [])
        .map(group)
        .filter((item): item is SkillGroup => Boolean(item)),
    };
  },
  read: (rootPath: string, selectedGroup: SkillGroup) =>
    getElectronApi().readSkillFiles({
      rootPath,
      group: selectedGroup.id,
      childIds: selectedGroup.children.map((item) => item.id),
    }),
};
