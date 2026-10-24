// Words in the user's caption/comment beat the model's guess (SPEC §5.3a). RU / CS / EN / VI.

export const VALUE_IN = ["info", "visual", "audio", "format", "meta"] as const;
export const STANCES = ["like", "dislike", "anti_example", "replicate", "format_idea", "seen_before", "example", "interesting"] as const;
// «Зачем мне» labels (SPEC §3): how the item can be used. "ofst" only for users who have an OFST area.
export const WHY_TAGS = ["asset", "strategy", "ofst", "content", "interesting"] as const;

const VALUE_WORDS: [RegExp, (typeof VALUE_IN)[number]][] = [
  [/инф[аоу]|ради инфы|полезн|informac|\binfo\b|thông tin/i, "info"],
  [/визуал|картинк|кадр|эстетик|красив|vizuál|obraz|visual|aesthetic|hình ảnh/i, "visual"],
  [/звук|за звук|музык|трек|аудио|zvuk|hudb|sound|music|audio|âm thanh|nhạc/i, "audio"],
  [/формат|зацеп|хук|hook|подача|монтаж|formát|format|định dạng/i, "format"],
  [/мета|про сам[уо]|про соцсет|про тренд|\bmeta\b/i, "meta"],
];

// Order matters: specific phrases before the words they contain ("антипример" before "пример", "dislike" before "like").
const STANCE_WORDS: [RegExp, (typeof STANCES)[number]][] = [
  [/анти\s*-?пример|как не надо|так не делать|antipříklad|anti-?example|ví dụ ngược/i, "anti_example"],
  [/хочу так же|хочу также|повторить|сделать так же|скопировать|chci taky|chci to samé|zopakovat|want the same|replicate|muốn làm theo/i, "replicate"],
  [/идея формата|формат для себя|идея для видео|nápad na formát|format idea|ý tưởng định dạng/i, "format_idea"],
  [/уже видел|видела раньше|было уже|už jsem viděl|seen (it )?before|đã thấy/i, "seen_before"],
  [/не нрав|бесит|кринж|отстой|nelíbí|dislike|không thích/i, "dislike"],
  [/пример|для примера|референс|příklad|example|ví dụ/i, "example"],
  [/интересн|zajímav|interesting|thú vị/i, "interesting"],
  [/нрав|люблю|топ\b|кайф|líbí|\blike\b|love it|thích/i, "like"],
];

export type Hints = { value_in: string[]; stance?: string; deepFormat: boolean; profile: boolean };

export function parseHints(text?: string | null): Hints {
  const t = (text ?? "").replace(/https?:\/\/\S+/g, " "); // words inside links are not hints
  const value_in = [...new Set(VALUE_WORDS.filter(([re]) => re.test(t)).map(([, v]) => v))];
  const stance = STANCE_WORDS.find(([re]) => re.test(t))?.[1];
  return {
    value_in, stance,
    deepFormat: /формат|зацеп|хук|formát|format|hook|định dạng/i.test(t),
    profile: /профил|profil|hồ sơ/i.test(t),
  };
}

export const needsFormatAnalysis = (valueIn: string[]) => valueIn.some((v) => ["format", "visual", "audio", "meta"].includes(v));
