function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  botToken: env("BOT_TOKEN"),
  ownerId: Number(env("OWNER_ID")),
  archiveChannelId: process.env.ARCHIVE_CHANNEL_ID ? Number(process.env.ARCHIVE_CHANNEL_ID) : undefined,
  supabaseUrl: env("SUPABASE_URL"),
  supabaseKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  geminiKey: env("GEMINI_API_KEY"),
  geminiModel: env("GEMINI_MODEL", "gemini-flash-latest"),
  geminiFallbackModels: env("GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash").split(",").map((s) => s.trim()),
  embedModel: env("GEMINI_EMBED_MODEL", "gemini-embedding-2"),
  embedDims: 1536,
  workerConcurrency: Number(env("WORKER_CONCURRENCY", "2")),
  tmpDir: env("TMP_DIR", "/tmp/bot-archive"),
};

// Fixed theme list — edit here.
export const THEMES = [
  "типографика и шрифты",
  "дизайн-референсы",
  "зацепы и маркетинг",
  "деньги и бизнес-идеи",
  "код и инструменты",
  "учёба",
  "рецепты",
  "смешное",
  "разное",
];

export const TYPES: Record<string, { ru: string; emoji: string }> = {
  tip: { ru: "совет", emoji: "💡" },
  recipe: { ru: "рецепт", emoji: "🍳" },
  idea: { ru: "идея", emoji: "✨" },
  funny: { ru: "смешное", emoji: "😂" },
  reference: { ru: "референс", emoji: "🎨" },
  other: { ru: "другое", emoji: "📌" },
};

export const SOURCE_LABEL: Record<string, string> = {
  tiktok: "🎵 тикток",
  youtube: "▶️ youtube",
  instagram: "📸 reels",
  link: "🔗 ссылка",
  text: "📝 текст",
  forwarded: "↪️ пересланное",
  screenshot: "🖼 скрин",
  voice: "🎙 голосовое",
  audio: "🎧 аудио",
  video: "🎬 видео",
  video_note: "⭕️ кружочек",
  document: "📄 файл",
};

export const TG_FILE_LIMIT = 20 * 1024 * 1024;
