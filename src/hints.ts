// Words in the user's caption/comment beat the model's guess (SPEC §5.3a).

export const VALUE_IN = ["info", "visual", "audio", "format", "meta"] as const;
export const STANCES = ["like", "dislike", "anti_example", "replicate", "format_idea", "seen_before", "example", "interesting"] as const;

const VALUE_WORDS: [RegExp, (typeof VALUE_IN)[number]][] = [
  [/инф[аоу]|ради инфы|полезн/i, "info"],
  [/визуал|картинк|кадр|эстетик|красив/i, "visual"],
  [/звук|за звук|музык|трек|аудио/i, "audio"],
  [/формат|зацеп|хук|hook|подача|монтаж/i, "format"],
  [/мета|про сам[уо]|про соцсет|про тренд/i, "meta"],
];

const STANCE_WORDS: [RegExp, (typeof STANCES)[number]][] = [
  [/анти\s*-?пример|как не надо|так не делать/i, "anti_example"],
  [/хочу так же|хочу также|повторить|сделать так же|скопировать/i, "replicate"],
  [/идея формата|формат для себя|идея для видео/i, "format_idea"],
  [/уже видел|видела раньше|было уже/i, "seen_before"],
  [/не нрав|бесит|кринж|отстой/i, "dislike"],
  [/пример\b|для примера|референс/i, "example"],
  [/интересн/i, "interesting"],
  [/нрав|люблю|топ\b|кайф/i, "like"],
];

export type Hints = { value_in: string[]; stance?: string; deepFormat: boolean; profile: boolean };

export function parseHints(text?: string | null): Hints {
  const t = text ?? "";
  const value_in = [...new Set(VALUE_WORDS.filter(([re]) => re.test(t)).map(([, v]) => v))];
  const stance = STANCE_WORDS.find(([re]) => re.test(t))?.[1];
  return { value_in, stance, deepFormat: /формат|зацеп|хук/i.test(t), profile: /профил/i.test(t) };
}

export const needsFormatAnalysis = (valueIn: string[]) => valueIn.some((v) => ["format", "visual", "audio", "meta"].includes(v));
