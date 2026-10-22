import { createBot } from "./bot.js";
import { startWorker } from "./worker.js";

const bot = createBot();

await bot.api.setMyCommands([
  { command: "recent", description: "последние 10 записей" },
  { command: "theme", description: "записи темы" },
  { command: "type", description: "записи типа (tip, recipe…)" },
  { command: "probe", description: "проверить скачивание тиктоков" },
]);

startWorker(bot.api).catch((e) => {
  console.error("worker crashed", e);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => bot.stop());

await bot.start({
  allowed_updates: ["message", "my_chat_member"],
  onStart: (me) => console.log(`@${me.username} started`),
});
