import { createBot } from "./bot.js";
import { startWorker } from "./worker.js";
import { archiveChannel } from "./archive.js";
import { config } from "./config.js";

const bot = createBot();

await bot.api.setMyCommands([
  { command: "recent", description: "последние 10 записей" },
  { command: "theme", description: "записи темы" },
  { command: "type", description: "записи типа (tip, recipe…)" },
  { command: "probe", description: "проверить скачивание тиктоков" },
]);

// Remind the owner if the archive channel isn't connected (or the bot lost admin rights).
async function checkArchive() {
  const ch = await archiveChannel();
  let problem = "не подключён: добавь бота админом в приватный канал-архив";
  if (ch) {
    try {
      const me = await bot.api.getChatMember(ch, bot.botInfo.id);
      if (me.status === "administrator" && me.can_post_messages) return console.log(`archive channel ${ch} ok`);
      problem = "бот там не админ или не может публиковать — проверь права";
    } catch {
      problem = "недоступен — добавь бота админом заново";
    }
  }
  console.warn(`archive channel: ${problem}`);
  await bot.api.sendMessage(config.ownerId, `🗄 канал-архив ${problem}`).catch(() => {});
}

await bot.init();
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
