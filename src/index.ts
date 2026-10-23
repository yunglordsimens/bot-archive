import { createBot, dbErrorHint } from "./bot.js";
import { db } from "./db.js";
import { startWorker } from "./worker.js";
import { archiveState } from "./archive.js";
import { config } from "./config.js";
import { DICTS, LANGS, tr } from "./i18n/index.js";
import { ensureOwner, listUsers } from "./users.js";
import { setCommands } from "./ui.js";
import { backfillPreviews } from "./preview.js";

const bot = createBot();
await bot.init();

// Fail loudly (in Telegram too) if the database key is wrong.
const { error: dbError } = await db.from("users").select("id").limit(1);
if (dbError) {
  const text = `❌ Supabase: ${dbErrorHint(dbError)}`;
  console.error(text, dbError);
  await bot.api.sendMessage(config.ownerId, text).catch(() => {});
  process.exit(2); // config error: start-mac.sh stops instead of restarting
}

const owner = await ensureOwner();
// The Mini App's Edge Function checks initData signatures against this bot's id (not secret; the token stays here).
await db.from("settings").upsert({ key: "bot_id", value: String(bot.botInfo.id) });

// Command menus: by Telegram app language for everyone, and by the chosen /lang for each user.
const commandsOf = (l: keyof typeof DICTS) => Object.entries(DICTS[l].commands).map(([command, description]) => ({ command, description }));
await bot.api.setMyCommands(commandsOf("en"));
for (const l of LANGS) await bot.api.setMyCommands(commandsOf(l), { language_code: l }).catch(() => {});
for (const u of await listUsers()) await setCommands(bot.api, u);
if (config.miniappUrl) {
  await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: tr("en").menuButton, web_app: { url: config.miniappUrl } } }).catch(() => {});
}

// Remind the owner if their archive channel isn't connected (other users see it in /start and /status).
const a = await archiveState(bot.api, bot.botInfo.id, owner).catch(() => undefined);
if (a?.ok) console.log(`archive channel ok: ${a.title}`);
else if (a) {
  console.warn(`archive channel ${a.problem}`);
  await bot.api.sendMessage(owner.telegram_user_id, tr(owner.lang).ui.channelBad(a.problem ?? "")).catch(() => {});
}

// Preview frames for items saved before the Mini App (one by one, in the background).
backfillPreviews(bot.api).catch((e) => console.warn("preview backfill stopped:", e?.message ?? e));

startWorker(bot.api).catch((e) => {
  console.error("worker crashed", e);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => bot.stop());

await bot.start({
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  onStart: (me) => console.log(`@${me.username} started`),
});
