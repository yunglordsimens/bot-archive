// Offline test of the bot UI with two users: languages, buttons, and that nobody sees another user's items.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

const OWNER = 585800070, CZ = 777, STRANGER = 42;
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });

const now = new Date().toISOString();
tables.users.push(
  { id: 1, telegram_user_id: OWNER, lang: "ru", is_admin: true, archive_channel_id: -1001, projects: null, themes: null, name: "owner" },
  { id: 2, telegram_user_id: CZ, lang: "cs", is_admin: false, archive_channel_id: null, projects: null, themes: null, name: null },
);
const item = (id: number, user_id: number, title: string, extra: object = {}) => ({
  id, user_id, status: "ok", title, created_at: now, content_type: "recipe", theme: "рецепты", project: ["здоровье и быт"], tags: ["ужин"],
  summary: `${title} — суть`, raw_text: "x".repeat(4000), input_kind: "tiktok", origin: "tiktok", value_in: [], structured: { steps: ["сварить"] },
  input: {}, archive_file_ids: [], raw_meta: { en: { title: `${title} EN`, summary: "Quick.", structured: {} } }, ...extra,
});
tables.items.push(item(1, 1, "Паста"), item(2, 1, "Мем", { content_type: "funny", theme: "смешное" }), item(3, 2, "Polévka", { theme: "recepty", project: ["různé"] }));

const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const calls: { method: string; p: any }[] = [];
bot.api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  const result = method === "getChatMember" ? { status: "administrator", can_post_messages: true }
    : method === "getChat" ? { id: -1001, type: "channel", title: "Архив" } : method === "answerCallbackQuery" || method === "setMyCommands" ? true : { message_id: 9, chat: { id: p.chat_id } };
  return { ok: true, result } as any;
});
bot.catch((e) => { throw e.error; });

let uid = 1;
const msg = (from: number, text: string) => ({ update_id: uid++, message: { message_id: uid, date: 0, chat: { id: from, type: "private" }, from: { id: from, is_bot: false, first_name: "u" }, text,
  ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}) } } as any);
const cb = (from: number, data: string) => ({ update_id: uid++, callback_query: { id: String(uid), from: { id: from, is_bot: false, first_name: "u" }, chat_instance: "x", data,
  message: { message_id: 5, date: 0, chat: { id: from, type: "private" }, text: "x" } } } as any);
const sent = () => calls.filter((c) => !["answerCallbackQuery", "setMyCommands", "getChatMember", "getChat"].includes(c.method));
const last = () => sent().at(-1)!;
const answers = () => calls.filter((c) => c.method === "answerCallbackQuery");
const strip = (s: string) => s.replace(/<[^>]+>/g, "");

// Languages
await bot.handleUpdate(msg(OWNER, "/start"));
assert.ok(last().p.reply_markup.keyboard.flat().some((b: any) => (b.text ?? b) === "📊 Статус"));
await bot.handleUpdate(msg(CZ, "/start"));
assert.match(last().p.text, /Ahoj/);
assert.match(last().p.text, /soukromý kanál/); // no archive channel yet → hint
assert.ok(last().p.reply_markup.keyboard.flat().some((b: any) => (b.text ?? b) === "📊 Stav"));
console.log("✓ /start: Russian for the owner, Czech for the second user (+ channel hint)");

// Isolation
await bot.handleUpdate(msg(CZ, "🕘 Poslední"));
assert.match(last().p.text, /Polévka/); assert.doesNotMatch(last().p.text, /Паста|Мем/);
await bot.handleUpdate(msg(OWNER, "🕘 Последние"));
assert.match(last().p.text, /Паста/); assert.doesNotMatch(last().p.text, /Polévka/);
console.log("✓ recent: each user sees only their own items");

const before = sent().length;
await bot.handleUpdate(cb(CZ, "x:1"));
assert.equal(answers().at(-1)!.p.text, "záznam nenalezen"); assert.equal(sent().length, before);
await bot.handleUpdate(cb(CZ, "tr:1"));
assert.equal(sent().length, before);
console.log("✓ someone else's item by button id → “záznam nenalezen”, nothing shown");

await bot.handleUpdate(cb(OWNER, "x:1"));
assert.match(last().p.text, /Паста — суть/); assert.match(last().p.text, /Шаги/);
await bot.handleUpdate(cb(CZ, "x:3"));
assert.match(last().p.text, /Postup/);
console.log("✓ own card opens, labels in the user's language");

await bot.handleUpdate(cb(OWNER, "en:1"));
assert.match(last().p.text, /Паста EN/);
await bot.handleUpdate(cb(OWNER, "tr:1"));
assert.equal(last().method, "sendDocument");
await bot.handleUpdate(cb(OWNER, "sv:1:replicate"));
assert.equal(tables.items.find((i) => i.id === 1)!.stance, "replicate");
await bot.handleUpdate(cb(CZ, "sv:1:dislike"));
assert.equal(tables.items.find((i) => i.id === 1)!.stance, "replicate"); // not changed by another user
console.log("✓ EN / transcript / corrections work for the owner, can't be changed by another user");

// Status, menus
await bot.handleUpdate(msg(CZ, "📊 Stav"));
assert.match(last().p.text, /uloženo: 1/); assert.match(last().p.text, /není připojen/);
await bot.handleUpdate(msg(OWNER, "🧭 Направления"));
assert.ok(last().p.reply_markup.inline_keyboard.flat().some((b: any) => b.text === "здоровье и быт · 2"));
await bot.handleUpdate(msg(CZ, "🧭 Oblasti"));
assert.ok(last().p.reply_markup.inline_keyboard.flat().some((b: any) => b.text === "různé · 1"));
console.log("✓ status and menus are per user and per language");

// /projects, /lang
await bot.handleUpdate(msg(CZ, "/projects škola, práce, design"));
assert.deepEqual(Object.keys(tables.users[1].projects), ["škola", "práce", "design", "různé"]);
await bot.handleUpdate(cb(CZ, "lang:en"));
assert.equal(tables.users[1].lang, "en");
assert.ok(last().p.reply_markup.keyboard.flat().some((b: any) => (b.text ?? b) === "📊 Status"));
await bot.handleUpdate(msg(CZ, "📊 Status"));
assert.match(last().p.text, /saved: 1/);
console.log("✓ /projects sets own areas (misc kept last), /lang switches the whole interface");

// /retry only touches own items
tables.items.push(item(4, 1, "Ошибка", { status: "failed" }), item(5, 2, "Chyba", { status: "failed" }));
await bot.handleUpdate(msg(CZ, "/retry"));
assert.equal(tables.items.find((i) => i.id === 5)!.status, "queued");
assert.equal(tables.items.find((i) => i.id === 4)!.status, "failed");
console.log("✓ /retry requeues only the user's own failed items");

// Admin
const n = sent().length;
await bot.handleUpdate(msg(CZ, "/adduser 999"));
assert.equal(sent().length, n); assert.ok(!tables.users.some((u) => u.telegram_user_id === 999));
await bot.handleUpdate(msg(OWNER, "/adduser 999 vi"));
assert.ok(tables.users.some((u) => u.telegram_user_id === 999 && u.lang === "vi"));
await bot.handleUpdate(msg(OWNER, "/users"));
assert.match(strip(last().p.text), /585800070 owner · 🇷🇺 · 2 · 🗄 · admin/);
console.log("✓ /adduser works only for the admin; /users lists everyone");

// Strangers are ignored
const m = sent().length;
await bot.handleUpdate(msg(STRANGER, "/start"));
await bot.handleUpdate(msg(STRANGER, "https://www.tiktok.com/@a/video/1"));
assert.equal(sent().length, m);
console.log("✓ strangers get no reply");

// Repeat detection is per user: the same link saved by another user is not a repeat.
tables.items.push(item(6, 1, "Видео", { text_hash: (await import("../src/dedup.ts")).urlHash ? await (await import("../src/dedup.ts")).urlHash("https://www.tiktok.com/@a/video/7") : "" }));
await bot.handleUpdate(msg(CZ, "https://www.tiktok.com/@a/video/7"));
assert.match(last().p.text, /tiktok · received/);
await bot.handleUpdate(msg(OWNER, "https://www.tiktok.com/@a/video/7"));
assert.match(last().p.text, /повтор/);
console.log("✓ repeats are per user");
process.exit(0);
