// Offline check of archive-channel posts: format/limits, edit vs repost, transcript reply.
import { createServer } from "node:http";
import assert from "node:assert/strict";

const CHANNEL = -1001234567890;
const srv = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(req.url!.includes("/settings") ? { value: String(CHANNEL) } : []));
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "1", GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x",
  SUPABASE_URL: `http://127.0.0.1:${(srv.address() as any).port}` });

const { Api } = await import("grammy");
const { postHtml, publishToChannel, rewritePost, postTranscript } = await import("../src/channel.ts");
const api = new Api("1:x");
const calls: { method: string; p: any }[] = [];
let editFails = false;
api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  if (editFails && method.startsWith("edit")) throw Object.assign(new Error("400: Bad Request: message can't be edited"), { description: "message can't be edited" });
  return { ok: true, result: { message_id: 77, video: { file_id: "V" } } } as any;
});
const last = () => calls.at(-1)!;

const it: any = {
  id: 5, input_kind: "tiktok", origin: "tiktok", source_url: "https://www.tiktok.com/@chef/video/1", author: "chef",
  title: "Паста за 10 минут", summary: "Очень длинная суть. ".repeat(80), why_me: "Готовить быстрый ужин. ".repeat(20),
  theme: "рецепты", project: ["здоровье и быт"], content_type: "recipe", archive_file_ids: ["V"], input: {},
  raw_text: "слово ".repeat(1000), tg_chat_id: 1, tg_message_id: 2, archive_link: `https://t.me/c/1234567890/50`,
  raw_meta: { en: { title: "Pasta in 10 minutes", summary: "Quick pasta. ".repeat(60), structured: {} } },
};

const cap = postHtml(it, 1024);
const vis = cap.replace(/<[^>]+>/g, "").length;
assert.ok(vis <= 1024, `caption ${vis}`);
assert.match(cap, /@chef/); assert.match(cap, /🧭 здоровье и быт/); assert.match(cap, /Зачем мне/); assert.match(cap, /🇬🇧/);
console.log(`✓ caption fits (${vis} chars):\n` + cap.replace(/<[^>]+>/g, "").slice(0, 300) + "…");

let r = await rewritePost(api, it);
assert.equal(r.reposted, false); assert.equal(last().method, "editMessageCaption"); assert.equal(last().p.chat_id, CHANNEL);
console.log("✓ own post → caption edited in place");

editFails = true;
r = await rewritePost(api, it);
assert.equal(r.reposted, true); assert.equal(last().method, "sendVideo"); assert.equal(last().p.video, "V");
console.log("✓ not editable → published anew by file_id:", r.link);
editFails = false;

const text: any = { ...it, input_kind: "text", origin: "telegram", archive_file_ids: [], source_url: null, author: null };
await publishToChannel(api, text, undefined);
assert.equal(last().method, "sendMessage");
console.log("✓ text item → text post");

const tr = await postTranscript(api, it, "https://t.me/c/1234567890/77");
assert.equal(last().method, "sendDocument"); assert.equal(last().p.reply_parameters.message_id, 77);
console.log("✓ long transcript → .txt reply under the post:", tr);
await postTranscript(api, { ...it, raw_text: "коротко" }, "https://t.me/c/1234567890/77");
assert.equal(last().method, "sendMessage");
console.log("✓ short transcript → text reply");
srv.close();
