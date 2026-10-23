function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    console.error(`❌ В .env не заполнено: ${name}`);
    process.exit(2); // config error: start-mac.sh stops instead of restarting
  }
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
  // "похоже на: …" is shown when cosine similarity to an existing item is above this
  similarThreshold: Number(env("SIMILAR_THRESHOLD", "0.9")),
  workerConcurrency: Number(env("WORKER_CONCURRENCY", "2")),
  tmpDir: env("TMP_DIR", "/tmp/bot-archive"),
};

// Life directions (SPEC §5.0): an item can belong to several. Hints help the model choose — edit freely.
export const PROJECTS: Record<string, string> = {
  "Lock in / деньги": "заработок, продуктивность, дисциплина, финансы",
  "OFST": "",
  "обмен": "",
  "дропшиппинг": "товары, поставщики, магазины, реклама товаров",
  "сайты на продажу": "сделать сайт и продать его, веб-студия, клиенты на сайты",
  "UMPRUM": "учёба в UMPRUM (Прага): задания, курсы, преподаватели",
  "личный бренд": "свой контент, соцсети, как себя показывать",
  "арт и портфолио": "собственные работы, портфолио, выставки",
  "другой бизнес": "бизнес-идеи вне перечисленных направлений",
  "здоровье и быт": "здоровье, спорт, еда, дом",
  "státnice": "государственные экзамены (státnice): подготовка, вопросы",
  "разное": "ничего из перечисленного",
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
