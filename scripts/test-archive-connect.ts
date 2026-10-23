// Offline check: each user's archive channel is detected from who made the bot admin there.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

const OWNER = 585800070, CZ = 777, STRANGER = 42;
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });
tables.users.push(
  { id: 1, telegram_user_id: OWNER, lang: "ru", is_admin: true, archive_channel_id: null },
  { id: 2, telegram_user_id: CZ, lang: "cs", is_admin: false, archive_channel_id: null },
);

const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const sent: { chat_id: number; text: string }[] = [];
let dmBlocked = false;
bot.api.config.use(async (_prev, method, payload: any) => {
  if (method === "sendMessage") {
    if (dmBlocked && payload.chat_id > 0) throw new Error("403: bot can't initiate conversation with a user");
    sent.push({ chat_id: payload.chat_id, text: payload.text });
  }
  return { ok: true, result: { message_id: 1 } } as any;
});

let uid = 1;
const update = (fromId: number, chatId: number, chatType: string, status: string, title = "Archiv") => ({
  update_id: uid++,
  my_chat_member: {
    chat: { id: chatId, type: chatType, title }, from: { id: fromId, is_bot: false, first_name: "u" },
    date: 0, old_chat_member: { status: "left", user: bot.botInfo }, new_chat_member: { status, user: bot.botInfo },
  },
} as any);
// The bot keeps users in a short cache — read the table directly.
const user = (tg: number) => tables.users.find((u) => u.telegram_user_id === tg)!;

await bot.handleUpdate(update(OWNER, -1001, "channel", "administrator", "Архив"));
assert.equal(user(OWNER).archive_channel_id, -1001);
assert.deepEqual(sent.at(-1), { chat_id: OWNER, text: "🗄 канал-архив подключён: Архив (-1001)" });
console.log("✓ owner makes bot admin → owner's channel, DM in Russian:", sent.at(-1)!.text);

await bot.handleUpdate(update(CZ, -1002, "channel", "administrator", "Můj archiv"));
assert.equal(user(CZ).archive_channel_id, -1002);
assert.equal(user(OWNER).archive_channel_id, -1001);
assert.equal(sent.at(-1)!.chat_id, CZ); assert.match(sent.at(-1)!.text, /archivní kanál připojen: Můj archiv/);
console.log("✓ second user → their own channel, DM in Czech:", sent.at(-1)!.text);

dmBlocked = true; sent.length = 0;
await bot.handleUpdate(update(CZ, -1002, "channel", "administrator", "Můj archiv"));
assert.equal(sent.at(-1)!.chat_id, -1002); assert.match(sent.at(-1)!.text, /\/start/);
dmBlocked = false;
console.log("✓ user never pressed /start → message posted in their channel instead");

sent.length = 0;
await bot.handleUpdate(update(STRANGER, -1003, "channel", "administrator"));
await bot.handleUpdate(update(OWNER, -1004, "supergroup", "administrator"));
assert.equal(sent.length, 0); assert.ok(!tables.users.some((u) => u.archive_channel_id === -1003 || u.archive_channel_id === -1004));
console.log("✓ stranger / group → ignored");

await bot.handleUpdate(update(OWNER, -1001, "channel", "kicked", "Архив"));
assert.equal(user(OWNER).archive_channel_id, null); assert.equal(user(CZ).archive_channel_id, -1002);
assert.match(sent.at(-1)!.text, /отключён/);
console.log("✓ bot removed from the owner's channel → only the owner's channel cleared");
process.exit(0);
