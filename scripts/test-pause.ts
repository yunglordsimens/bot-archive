// Offline test of task 18 (/pause, /resume): no Gemini while paused, the original still goes to the channel,
// /resume queues the held items and their analysis edits that post instead of making a second one.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

const OWNER = 585800070;
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });
delete process.env.BOT_API_URL;

// Fake Gemini: counts calls.
let gemini = 0;
const analysis = {
  title: "Цена от ценности", summary: "Ставь цену от ценности.", content_type: "tip", kind: "заметка", theme: "разное", project: ["разное"],
  why_me: "Пересчитать цены.", why_tags: ["strategy"], tags: [], structured: {}, raw_text: "", visual_description: "", value_in: ["info"],
  stance: "like", comments_note: "", entity: "none", language: ["ru"],
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, init);
  gemini++;
  if (/embedContent/i.test(String(url))) return Response.json({ embedding: { values: Array(1536).fill(0.01) }, embeddings: [{ values: Array(1536).fill(0.01) }] });
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(analysis) }] }, finishReason: "STOP" }] });
}) as typeof fetch;

tables.users.push({ id: 1, telegram_user_id: OWNER, lang: "ru", is_admin: true, archive_channel_id: -1001, notify: false, paused: false, name: "owner" });
tables.users.push({ id: 2, telegram_user_id: 777, lang: "cs", is_admin: false, archive_channel_id: -1002, notify: false, paused: false, name: "Jana" });

const { createBot } = await import("../src/bot.ts");
const { handle } = await import("../src/worker.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const calls: { method: string; p: any }[] = [];
bot.api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  return { ok: true, result: ["setMessageReaction", "editMessageText", "editMessageCaption", "setMyCommands"].includes(method) ? true : { message_id: 100 + calls.length, chat: { id: p.chat_id } } } as any;
});
bot.catch((e) => { throw e.error; });
let uid = 1;
const cmd = (from: number, text: string) => bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat: { id: from, type: "private" },
  from: { id: from, is_bot: false, first_name: "u" }, text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } } as any);
const lastReply = () => calls.filter((c) => c.method === "sendMessage" && c.p.chat_id > 0).at(-1)!.p.text as string;

// 1. /pause (owner, for themself), /pause of another user only by the owner.
await cmd(OWNER, "/pause");
assert.equal(tables.users[0].paused, true);
assert.match(lastReply(), /⏸ пауза/);
await cmd(777, "/pause 585800070");
assert.match(lastReply(), /majitel/); // not the owner → usage
assert.equal(tables.users[1].paused, false);
await cmd(OWNER, "/pause 777");
assert.equal(tables.users[1].paused, true);
assert.match(lastReply(), /\(777 Jana\)/);
await cmd(OWNER, "/resume 777");
assert.equal(tables.users[1].paused, false);
console.log("✓ /pause for yourself; the owner can pause/resume another user, others can't");

// 2. Paused: the item is held — posted to the channel as the original, 😴, no Gemini.
const it: any = { id: 9, user_id: 1, status: "processing", attempts: 1, input_kind: "text", origin: "telegram", tg_chat_id: OWNER, tg_message_id: 50,
  input: { text: "Как ставить цену\nот ценности, а не от часов" }, raw_meta: null, value_in: [], project: [], tags: [], archive_file_ids: [] };
tables.items.push(it);
calls.length = 0;
await handle(bot.api, it);
const row = tables.items.find((i) => i.id === 9)!;
assert.equal(gemini, 0);
assert.equal(row.status, "paused");
assert.equal(row.title, "Как ставить цену");
assert.ok(row.archive_link, "posted to the channel");
const posts = calls.filter((c) => c.method === "sendMessage" && c.p.chat_id === -1001).length;
assert.ok(posts >= 1);
assert.deepEqual(calls.filter((c) => c.method === "setMessageReaction").map((c) => c.p.reaction[0].emoji), ["😴"]);
console.log(`✓ paused: original posted (${row.archive_link}), 😴, Gemini calls: 0`);

// 3. /status shows the pause; /resume queues the held item.
await cmd(OWNER, "/status");
assert.match(lastReply(), /⏸ на паузе — ждут разбора: 1/);
await cmd(OWNER, "/resume");
assert.equal(tables.users[0].paused, false);
assert.equal(row.status, "queued");
assert.match(lastReply(), /▶️ продолжаю: 1 запись/);
console.log("✓ /status shows the pause; /resume → 1 item queued");

// 4. After /resume: analysed, the existing post is edited (no second header post).
calls.length = 0;
await handle(bot.api, Object.assign(row, { status: "processing" }));
assert.ok(gemini > 0);
assert.equal(row.status, "ok");
assert.equal(row.title, "Цена от ценности");
const headerPosts = calls.filter((c) => c.method === "sendMessage" && c.p.chat_id === -1001 && !c.p.reply_parameters);
assert.equal(headerPosts.length, 0, "no second post");
assert.ok(calls.some((c) => c.method === "editMessageText" && c.p.chat_id === -1001 && /Цена от ценности/.test(c.p.text)), "header edited");
console.log("✓ after /resume: analysed by Gemini, the same post edited");

// 5. Menu: /pause and /resume come first.
const { tr } = await import("../src/i18n/index.ts");
assert.deepEqual(Object.keys(tr("ru").commands).slice(0, 2), ["pause", "resume"]);
console.log("✓ /pause and /resume in the command menu");
process.exit(0);
