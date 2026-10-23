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
  // Owner only: fallback archive channel if the bot wasn't made admin of one yet.
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
  // Mini App «Архив» (SPEC §6.0); empty = no Menu button
  miniappUrl: env("MINIAPP_URL", "https://bot-archive-miniapp.vercel.app"),
};

// Content types: keys are stored in the DB, labels come from the translation files.
export const TYPE_EMOJI: Record<string, string> = { tip: "💡", recipe: "🍳", idea: "✨", funny: "😂", reference: "🎨", other: "📌" };

export const TG_FILE_LIMIT = 20 * 1024 * 1024;
