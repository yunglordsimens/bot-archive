// Offline check of the archive post (SPEC §5.3a): short header on the media, full text card as replies, transcript after — nothing cut.
import assert from "node:assert/strict";

const CHANNEL = -1001234567890;
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "1", GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: "http://127.0.0.1:9" });
const u: any = { id: 1, telegram_user_id: 1, lang: "ru", archive_channel_id: CHANNEL };

const { Api } = await import("grammy");
const { headerHtml, cardBlocks, publishToChannel, rewritePost, postCard, postTranscript } = await import("../src/channel.ts");
const { splitMessages } = await import("../src/split.ts");
const api = new Api("1:x");
const calls: { method: string; p: any }[] = [];
let editFails = false, nextId = 100;
api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  if (editFails && method.startsWith("edit")) throw Object.assign(new Error("400: Bad Request: message can't be edited"), { description: "message can't be edited" });
  return { ok: true, result: method === "deleteMessage" ? true : { message_id: nextId++, video: { file_id: "V" } } } as any;
});
const last = () => calls.at(-1)!;
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const films = Array.from({ length: 300 }, (_, i) => `Фильм №${i + 1}`);
const it: any = {
  id: 5, user_id: 1, input_kind: "tiktok", origin: "tiktok", source_url: "https://www.tiktok.com/@chef/video/1", author: "chef",
  title: "Паста за 10 минут", summary: "Очень длинная суть. ".repeat(300), why_me: "Готовить быстрый ужин.",
  caption: "Описание автора полностью. ".repeat(200), comments_note: "рецепт соуса в закрепе",
  theme: "рецепты", project: ["здоровье и быт"], content_type: "recipe", archive_file_ids: ["V"], input: {},
  structured: { ingredients: ["паста 200 г", "соль"], steps: ["сварить", "посолить"], lists: [{ title: "Фильмы под ужин", items: films }] },
  raw_text: "слово ".repeat(1000), tg_chat_id: 1, tg_message_id: 2, archive_link: `https://t.me/c/1234567890/50`,
  raw_meta: { published_at: "2025-10-09T08:53:20Z", author_url: "https://www.tiktok.com/@chef", en: { title: "Pasta in 10 minutes", summary: "Quick pasta.", structured: {} } },
};

// (1) header
const head = strip(headerHtml(it, u));
assert.ok(head.length <= 1024); assert.match(head, /@chef/); assert.match(head, /2025/); assert.match(head, /рецепты/);
assert.doesNotMatch(head, /суть|Описание автора|слово/);
console.log(`✓ (1) caption is the short header (${head.length} chars):\n${head}`);

// (2) card — everything, split by paragraph, nothing lost
const msgs = splitMessages(cardBlocks(it, u));
const all = strip(msgs.join("\n"));
assert.ok(msgs.every((m) => m.length <= 4096)); assert.ok(!all.includes("…"));
assert.equal((all.match(/Очень длинная суть\./g) ?? []).length, 300);
assert.equal((all.match(/Описание автора полностью\./g) ?? []).length, 200);
for (const f of films) assert.ok(all.includes(`• ${f}\n`) || all.endsWith(`• ${f}`), f);
for (const s of ["Зачем мне", "Ингредиенты", "паста 200 г", "Шаги", "1. сварить", "В комментах", "Pasta in 10 minutes", "Описание из-под видео"]) assert.ok(all.includes(s), s);
assert.doesNotMatch(all, /слово слово/); // transcript is not in the card
console.log(`✓ (2) card: ${msgs.length} messages, summary/lists/recipe/description complete, no “…”, no transcript`);

// Publish: post → card replies → transcript reply
calls.length = 0;
const posted = await publishToChannel(api, it, { kind: "upload", video: { buf: Buffer.from("v"), mime: "video/mp4" } }, u);
assert.equal(calls[0].method, "sendVideo"); assert.equal(strip(calls[0].p.caption), head);
const postId = Number(posted.link!.split("/").pop());
const card = await postCard(api, { ...it, raw_meta: { ...it.raw_meta, card_links: undefined } }, posted.link!, u);
assert.equal(card.links.length, msgs.length); assert.ok(card.fresh);
assert.ok(calls.filter((c) => c.method === "sendMessage").every((c) => c.p.reply_parameters.message_id === postId));
await postTranscript(api, it, posted.link!, u, card.fresh);
assert.equal(last().method, "sendDocument"); assert.equal(last().p.reply_parameters.message_id, postId);
console.log("✓ publish: video with header → card replies → transcript (.txt) reply, all under the post");

// Re-run (/reprocess): header edited, card messages edited in place, extra old ones deleted
calls.length = 0;
const existing = { ...it, raw_meta: { ...it.raw_meta, card_links: [...card.links, "https://t.me/c/1234567890/999"] } };
const r = await rewritePost(api, existing, u);
assert.equal(r.reposted, false); assert.equal(calls[0].method, "editMessageCaption");
const again = await postCard(api, existing, existing.archive_link, u);
assert.equal(calls.filter((c) => c.method === "editMessageText").length, msgs.length);
assert.equal(calls.filter((c) => c.method === "deleteMessage").length, 1); assert.equal(again.fresh, false);
console.log("✓ /reprocess: header and card edited in place, surplus card message deleted");

editFails = true;
const r2 = await rewritePost(api, existing, u);
assert.equal(r2.reposted, true); assert.equal(last().method, "sendVideo"); assert.equal(last().p.video, "V");
editFails = false;
console.log("✓ post that can't be edited → published anew by file_id");

// Old-format post (no card yet): transcript is re-posted after the new card to keep the order
calls.length = 0;
const old = { ...it, raw_meta: { ...it.raw_meta, card_links: undefined, transcript_link: "https://t.me/c/1234567890/60" } };
const c2 = await postCard(api, old, old.archive_link, u);
await postTranscript(api, old, old.archive_link, u, c2.fresh);
assert.ok(calls.some((c) => c.method === "deleteMessage" && c.p.message_id === 60));
assert.equal(last().method, "sendDocument");
console.log("✓ old post: card added, old transcript moved below the card");

const cz = postHtmlCheck({ ...u, lang: "cs" });
function postHtmlCheck(user: any) { return strip(splitMessages(cardBlocks(it, user)).join("\n")); }
assert.match(cz, /Proč pro mě/); assert.match(cz, /Popisek pod videem/);
assert.doesNotMatch(postHtmlCheck({ ...u, lang: "en" }), /🇬🇧/);
console.log("✓ labels in the user's language; no EN block for English users");
