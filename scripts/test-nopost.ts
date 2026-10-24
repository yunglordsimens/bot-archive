// Offline: «Зачем мне» labels, the author line, and the message when the archive post doesn't go out (+ "📤 Post to channel").
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "1", GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });
delete process.env.ARCHIVE_CHANNEL_ID;

// Fake Gemini: one answer that fits both the analysis and the EN translation; "ofst" must be dropped (no OFST area).
const analysis = {
  title: "Цена от ценности", summary: "Ставь цену от ценности для клиента.", content_type: "tip", kind: "видео", theme: "разное", project: ["разное"],
  why_me: "Пересчитать цены на сайты.", why_tags: ["ofst", "strategy", "bogus"], tags: ["цены"], structured: {}, raw_text: "", visual_description: "",
  value_in: ["info"], stance: "like", comments_note: "", entity: "none", language: ["ru"],
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, init);
  if (/embedContent/i.test(String(url))) return Response.json({ embedding: { values: Array(1536).fill(0.01) }, embeddings: [{ values: Array(1536).fill(0.01) }] });
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(analysis) }] }, finishReason: "STOP" }] });
}) as typeof fetch;

tables.users.push({ id: 1, telegram_user_id: 1, lang: "ru", is_admin: true, archive_channel_id: null, notify: false });
const { Api } = await import("grammy");
const { handle, republish } = await import("../src/worker.ts");
const { headerHtml, cardBlocks } = await import("../src/channel.ts");

let channelDown = false;
const calls: { method: string; p: any }[] = [];
const api = new Api("1:x");
api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  if (channelDown && p.chat_id === -1001) throw new Error("Bad Request: not enough rights to send text messages to the chat");
  return { ok: true, result: { message_id: 70 + calls.length, chat: { id: p.chat_id } } } as any;
});
const chat = () => calls.filter((c) => c.method === "sendMessage" && c.p.chat_id === 1);
const reactions = () => calls.filter((c) => c.method === "setMessageReaction").map((c) => c.p.reaction[0].emoji);
const newItem = (id: number) => {
  const it: any = { id, user_id: 1, status: "processing", attempts: 1, input_kind: "text", origin: "telegram", tg_chat_id: 1, tg_message_id: id,
    input: { text: "заметка про цены" }, raw_meta: null, value_in: [], project: [], tags: [], archive_file_ids: [] };
  tables.items.push(it);
  return it;
};

// 1. No archive channel: saved (👌), labels kept, one message saying the post is missing and why — no button (nowhere to post).
const a = newItem(1);
await handle(api, a);
assert.equal(a.status, "ok");
assert.deepEqual(a.why_tags, ["strategy"]);
assert.deepEqual(reactions(), ["👀", "👌"]);
assert.equal(chat().length, 1);
assert.match(chat()[0].p.text, /поста в канале-архиве нет — канал-архив не подключён/);
assert.equal(chat()[0].p.reply_markup?.inline_keyboard?.flat().length ?? 0, 0);
console.log("✓ no channel → 👌 + one line:", chat()[0].p.text);

// 2. Channel exists but Telegram refuses: reason + "📤 Post to channel" button; the item is saved anyway.
calls.length = 0;
const { updateUser } = await import("../src/users.ts");
await updateUser(tables.users[0] as any, { archive_channel_id: -1001 }); // as the bot does (refreshes the user cache)
channelDown = true;
const b = newItem(2);
await handle(api, b);
assert.equal(b.status, "ok");
assert.equal(b.archive_link ?? null, null);
assert.match(chat()[0].p.text, /канал-архив недоступен/);
assert.equal(chat()[0].p.reply_markup.inline_keyboard[0][0].callback_data, "repost:2");
console.log("✓ channel refuses → reason + button:", chat()[0].p.text);

// 3. The button: channel works again → post + card replies, the error is cleared.
channelDown = false;
const link = await republish(api, tables.items.find((i) => i.id === 2) as any, tables.users[0] as any);
const saved = tables.items.find((i) => i.id === 2)!;
assert.equal(saved.archive_link, link);
assert.equal(saved.raw_meta.archive_error, undefined);
console.log("✓ 📤 republish →", link);

// 4. Post: "Name (@handle)" with followers, labels next to «Зачем мне».
const u = tables.users[0] as any;
const post = { ...saved, raw_meta: { ...saved.raw_meta, author: { name: "Anna K", handle: "anna", url: "https://www.tiktok.com/@anna", followers: 12345, platform: "tiktok" } } } as any;
assert.match(headerHtml(post, u), /<a href="https:\/\/www\.tiktok\.com\/@anna">Anna K \(@anna\)<\/a> · 👥 12\.3K подписчиков/);
assert.match(cardBlocks(post, u).join("\n"), /💭 <b>Зачем мне<\/b> · ♟ стратегия\nПересчитать/);
console.log("✓ author line and «Зачем мне» labels in the post");
process.exit(0);
