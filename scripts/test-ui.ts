// Offline smoke test of buttons/status: fake Supabase REST + intercepted Telegram API.
import { createServer } from "node:http";
import assert from "node:assert/strict";

const OWNER = 585800070, CHANNEL = -1001234567890;
const rows = [
  { id: 1, status: "ok", theme: "рецепты", content_type: "recipe", title: "Паста", source_url: "https://t.co/1", created_at: new Date().toISOString(),
    summary: "Быстрая паста.", tags: ["ужин"], raw_text: "x".repeat(4000), input_kind: "tiktok", origin: "tiktok",
    structured: { ingredients: ["паста"], steps: ["сварить"], lists: [{ title: "Фильмы", items: ["Амели"] }] },
    raw_meta: { en: { title: "Pasta", summary: "Quick pasta.", structured: { lists: [{ title: "Films", items: ["Amélie"] }] } },
      similar: { id: 2, title: "Мем", summary: "Смешной мем", created_at: new Date().toISOString(), similarity: 0.93 } } },
  { id: 2, status: "ok", theme: "смешное", content_type: "funny", title: "Мем", source_url: null, created_at: new Date().toISOString() },
];
const srv = createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname.endsWith("/settings")) return res.end(JSON.stringify({ value: String(CHANNEL) }));
  if (req.method === "PATCH") return res.end(JSON.stringify([{ id: 2 }]));
  if (req.method === "HEAD") { res.setHeader("Content-Range", "0-0/1"); return res.end(); }
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  res.end(JSON.stringify(single ? rows[0] : url.searchParams.get("limit") === "1" ? [rows[0]] : rows));
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
Object.assign(process.env, {
  BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x",
  SUPABASE_URL: `http://127.0.0.1:${(srv.address() as any).port}`,
});

const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const calls: { method: string; p: any }[] = [];
bot.api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  const result = method === "getChatMember" ? { status: "administrator", can_post_messages: true }
    : method === "getChat" ? { id: CHANNEL, type: "channel", title: "Архив" } : method === "answerCallbackQuery" ? true : { message_id: 9 };
  return { ok: true, result } as any;
});
bot.catch((e) => { throw e.error; });

let uid = 1;
const chat = { id: OWNER, type: "private", first_name: "m" }, from = { id: OWNER, is_bot: false, first_name: "m" };
const msg = (text: string) => ({ update_id: uid++, message: { message_id: uid, date: 0, chat, from, text,
  ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}) } } as any);
const cb = (data: string) => ({ update_id: uid++, callback_query: { id: String(uid), from, chat_instance: "x", data,
  message: { message_id: 5, date: 0, chat, text: "x" } } } as any);
const last = () => calls.filter((c) => c.method !== "answerCallbackQuery").at(-1)!;

await bot.handleUpdate(msg("/start"));
assert.ok(last().p.reply_markup.keyboard.flat().some((b: any) => (b.text ?? b) === "📊 Статус"));
console.log("✓ /start shows keyboard");

await bot.handleUpdate(msg("📊 Статус"));
assert.match(last().p.text, /бот работает/); assert.match(last().p.text, /канал-архив: Архив ✓/);
console.log("✓ status:\n" + last().p.text.replace(/<[^>]+>/g, ""));

await bot.handleUpdate(msg("🗂 Темы"));
assert.ok(last().p.reply_markup.inline_keyboard.flat().some((b: any) => b.text === "рецепты · 1"));
console.log("✓ themes menu with counts");

await bot.handleUpdate(cb("th:6"));
assert.equal(last().method, "editMessageText"); assert.match(last().p.text, /Паста/);
console.log("✓ theme button opens list");

await bot.handleUpdate(msg("🏷 Типы"));
await bot.handleUpdate(cb("ty:recipe"));
assert.match(last().p.text, /рецепт/);
console.log("✓ types menu + type list");

await bot.handleUpdate(cb("retry:2"));
assert.equal(last().p.text, "🔁 повторяю…");
await bot.handleUpdate(cb("retryall"));
assert.match(last().p.text, /снова в очереди/);
console.log("✓ retry buttons");

await bot.handleUpdate(msg("🕘 Последние"));
assert.match(last().p.text, /Последние/);
await bot.handleUpdate(msg("❓ Помощь"));
assert.match(last().p.text, /Что кидать/);
console.log("✓ recent + help");
await bot.handleUpdate(msg("https://youtu.be/dQw4w9WgXcQ?si=1"));
const dupMsgs = calls.filter((c) => /♻️/.test(c.p?.text ?? ""));
assert.ok(dupMsgs.length >= 1);
console.log("✓ repeat link → " + dupMsgs.at(-1)!.p.text.replace(/<[^>]+>/g, ""));
// Card buttons
await bot.handleUpdate(cb("x:1"));
assert.match(last().p.text, /Ингредиенты/); assert.match(last().p.text, /Фильмы/); assert.match(last().p.text, /похоже на: Смешной мем/);
assert.ok(last().p.reply_markup.inline_keyboard.flat().some((b: any) => b.text === "🔼 Свернуть"));
console.log("✓ Подробнее:\n" + last().p.text.replace(/<[^>]+>/g, ""));
await bot.handleUpdate(cb("c:1"));
assert.doesNotMatch(last().p.text, /Ингредиенты/);
console.log("✓ Свернуть:", last().p.text.replace(/<[^>]+>/g, ""));
await bot.handleUpdate(cb("en:1"));
assert.match(last().p.text, /Films/);
console.log("✓ EN view");
await bot.handleUpdate(cb("tr:1"));
assert.equal(last().method, "sendDocument");
console.log("✓ long transcript → .txt file");
srv.close();
