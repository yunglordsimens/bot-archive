import { createBot, dbErrorHint } from "./bot.js";
import { db } from "./db.js";
import { startWorker } from "./worker.js";
import { archiveState } from "./archive.js";
import { config } from "./config.js";

const bot = createBot();

await bot.api.setMyCommands([
  { command: "start", description: "показать кнопки" },
  { command: "status", description: "состояние бота, канала и очереди" },
  { command: "recent", description: "последние 10 записей" },
  { command: "project", description: "записи по направлению" },
  { command: "theme", description: "записи по теме" },
  { command: "type", description: "записи по типу" },
  { command: "retry", description: "повторить ошибки и записи без видео" },
  { command: "reprocess", description: "перепройти старые записи в новый формат" },
  { command: "help", description: "как пользоваться" },
  { command: "probe", description: "проверить скачивание тиктоков" },
]);

// Remind the owner if the archive channel isn't connected (or the bot lost admin rights).
async function checkArchive() {
  const a = await archiveState(bot.api, bot.botInfo.id);
  if (a.ok) return console.log(`archive channel ok: ${a.title}`);
  console.warn(`archive channel ${a.problem}`);
  await bot.api.sendMessage(config.ownerId, `🗄 канал-архив ${a.problem}`).catch(() => {});
}

await bot.init();

// Fail loudly (in Telegram too) if the database key is wrong.
const { error: dbError } = await db.from("settings").select("key").limit(1);
if (dbError) {
  const text = `❌ Supabase не отвечает: ${dbErrorHint(dbError)}. Исправь .env и перезапусти бота.`;
  console.error(text, dbError);
  await bot.api.sendMessage(config.ownerId, text).catch(() => {});
  process.exit(2); // config error: start-mac.sh stops instead of restarting
}

await checkArchive().catch((e) => console.error("archive check", e));

startWorker(bot.api).catch((e) => {
  console.error("worker crashed", e);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => bot.stop());

await bot.start({
  allowed_updates: ["message", "my_chat_member"],
  onStart: (me) => console.log(`@${me.username} started`),
});
