import { getElectronApi } from "@/services/electron-api/client";

const transitionTypes = new Set([
  "fade",
  "fadeblack",
  "fadewhite",
  "dissolve",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "smoothleft",
  "smoothright",
  "rectcrop",
  "circleopen",
  "circleclose",
  "pixelize",
  "hblur",
  "vblur",
  "radial",
  "fadegrays",
  "distance",
  "zoomin",
  "squeezeh",
  "squeezev",
  "diagtl",
  "diagtr",
  "diagbl",
  "diagbr",
  "vertopen",
  "horzopen",
]);
const effectTypes = new Set([
  "blur",
  "zoom",
  "open",
  "fade",
  "color",
  "glow",
  "distortion",
  "motion",
  "particle",
  "scanlines",
  "threed",
]);
const transitionCategories = new Set([
  "favorites",
  "user",
  "advanced",
  "basic",
  "wipe",
  "slide",
  "mask",
  "blur",
]);
const effectCategories = new Set([
  "favorites",
  "user",
  "trending",
  "classic",
  "new",
  "pet",
  "hits",
  "introOutro",
  "wildPics",
  "party",
  "motion",
  "3d",
  "light",
  "retro",
  "glitch",
  "distortion",
  "decor",
  "screen",
  "sparkle",
  "bodyClassic",
  "bodyShape",
]);
const controlledSliders = [
  "size",
  "amount",
  "strength",
  "speed",
  "filters",
] as const;
const kebabCase = /^[a-z0-9][a-z0-9-]*$/;

export interface UserTransitionPreset extends Record<string, unknown> {
  id: string;
  name: string;
  category: string;
  type: string;
  defaultDuration: number;
}
export interface UserEffectPreset extends Record<string, unknown> {
  id: string;
  name: string;
  category: string;
  parent: "bodyEffects" | "videoEffects";
  type: string;
  defaults: Record<string, number>;
}
export interface UserPresetLibrary extends Record<string, unknown> {
  version: 1;
  transitions: UserTransitionPreset[];
  effects: UserEffectPreset[];
}
export interface UserPresetParseResult extends UserPresetLibrary {
  errors: string[];
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
const unique = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];
const validId = (value: unknown): value is string =>
  typeof value === "string" && kebabCase.test(value);

const transition = (
  value: unknown,
  location: string,
): { error?: string; value?: UserTransitionPreset } => {
  const item = object(value);
  if (!validId(item.id) || typeof item.name !== "string" || !item.name.trim())
    return { error: `${location}: id/name không hợp lệ.` };
  if (
    typeof item.category !== "string" ||
    !transitionCategories.has(item.category)
  )
    return { error: `${location}: category không được hỗ trợ.` };
  if (typeof item.type !== "string" || !transitionTypes.has(item.type))
    return { error: `${location}: FFmpeg transition type không được hỗ trợ.` };
  const duration =
    item.defaultDuration === undefined ? 0.6 : item.defaultDuration;
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0.1 ||
    duration > 3
  )
    return { error: `${location}: defaultDuration phải từ 0.1 đến 3 giây.` };
  return {
    value: {
      ...item,
      id: item.id,
      name: item.name,
      category: item.category,
      type: item.type,
      defaultDuration: duration,
    },
  };
};
const effect = (
  value: unknown,
  location: string,
): { error?: string; value?: UserEffectPreset } => {
  const item = object(value);
  if (!validId(item.id) || typeof item.name !== "string" || !item.name.trim())
    return { error: `${location}: id/name không hợp lệ.` };
  if (typeof item.category !== "string" || !effectCategories.has(item.category))
    return { error: `${location}: category không được hỗ trợ.` };
  if (item.parent !== "videoEffects" && item.parent !== "bodyEffects")
    return { error: `${location}: parent không hợp lệ.` };
  if (typeof item.type !== "string" || !effectTypes.has(item.type))
    return { error: `${location}: effect type không được hỗ trợ.` };
  const rawDefaults = object(item.defaults);
  const defaults: Record<string, number> = {};
  for (const key of controlledSliders)
    if (rawDefaults[key] !== undefined) {
      const slider = rawDefaults[key];
      if (
        typeof slider !== "number" ||
        !Number.isFinite(slider) ||
        slider < 0 ||
        slider > 100
      )
        return { error: `${location}: defaults.${key} phải từ 0 đến 100.` };
      defaults[key] = slider;
    }
  return {
    value: {
      ...item,
      id: item.id,
      name: item.name,
      category: item.category,
      parent: item.parent,
      type: item.type,
      defaults,
    },
  };
};

export const parseUserPresets = (input: unknown): UserPresetParseResult => {
  const root = object(input);
  const errors: string[] = [];
  if (root.version !== undefined && root.version !== 1)
    return {
      version: 1,
      transitions: [],
      effects: [],
      errors: ["Chỉ hỗ trợ user preset version 1."],
    };
  const transitionInputs =
    root.kind === "transition" && root.preset
      ? [root.preset]
      : Array.isArray(root.transitions)
        ? root.transitions
        : [];
  const effectInputs =
    root.kind === "effect" && root.preset
      ? [root.preset]
      : Array.isArray(root.effects)
        ? root.effects
        : [];
  if (
    !transitionInputs.length &&
    !effectInputs.length &&
    !("transitions" in root) &&
    !("effects" in root) &&
    !root.kind
  )
    errors.push("File phải chứa transitions/effects hoặc kind + preset.");
  const transitions = transitionInputs.flatMap((item, index) => {
    const result = transition(item, `transitions[${index}]`);
    if (result.error) errors.push(result.error);
    return result.value ? [result.value] : [];
  });
  const effects = effectInputs.flatMap((item, index) => {
    const result = effect(item, `effects[${index}]`);
    if (result.error) errors.push(result.error);
    return result.value ? [result.value] : [];
  });
  return {
    version: 1,
    transitions: unique(transitions),
    effects: unique(effects),
    errors,
  };
};

const transitionTemplate = {
  version: 1,
  kind: "transition",
  preset: {
    id: "user-my-soft-fade",
    name: "My Soft Fade",
    category: "user",
    type: "fade",
    defaultDuration: 0.8,
  },
};
const effectTemplate = {
  version: 1,
  kind: "effect",
  preset: {
    id: "user-my-soft-glow",
    name: "My Soft Glow",
    category: "user",
    parent: "videoEffects",
    type: "glow",
    defaults: { size: 70, strength: 70, amount: 60 },
  },
};

export const userPresetApi = {
  async load(): Promise<UserPresetParseResult> {
    return parseUserPresets(await getElectronApi().loadUserPresets());
  },
  async save(library: UserPresetLibrary): Promise<void> {
    if ((await getElectronApi().saveUserPresets(library)) !== true)
      throw new Error("Không lưu được user preset.");
  },
  async import(): Promise<UserPresetParseResult | undefined> {
    const selected = object(await getElectronApi().importUserPresetFile());
    if (typeof selected.raw !== "string") return undefined;
    try {
      return parseUserPresets(JSON.parse(selected.raw));
    } catch (value) {
      throw new Error(
        `File preset không phải JSON hợp lệ: ${value instanceof Error ? value.message : String(value)}`,
      );
    }
  },
  exportTemplate: (kind: "effect" | "transition") =>
    getElectronApi().exportUserPresetTemplate({
      kind,
      template: kind === "transition" ? transitionTemplate : effectTemplate,
      suggestedName:
        kind === "transition"
          ? "transition.template.json"
          : "effect.template.json",
    }),
  merge(
    current: UserPresetLibrary,
    imported: UserPresetLibrary,
  ): UserPresetLibrary {
    return {
      version: 1,
      transitions: unique([...current.transitions, ...imported.transitions]),
      effects: unique([...current.effects, ...imported.effects]),
    };
  },
};
