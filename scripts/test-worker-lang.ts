// Worker end-to-end for a Czech user with the real Gemini (needs GEMINI_API_KEY): language, EN copy, the user's own channel.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "585800070", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });
tables.users.push({ id: 2, telegram_user_id: 777, lang: "cs", is_admin: false, archive_channel_id: -1002, projects: null, themes: null, notify: false });
const it: any = {
  id: 50, user_id: 2, status: "processing", attempts: 1, input_kind: "text", origin: "telegram", tg_chat_id: 777, tg_message_id: 3, reply_message_id: 4,
  input: { text: "Tip: v Praze je nejlepší kafe v Café Lounge a v Místo. Chci taky otevřít malou kavárnu." }, raw_meta: null, value_in: [], project: [], tags: [],
};
tables.items.push(it);

const { Api } = await import("grammy");
const { handle } = await import("../src/worker.ts");
const api = new Api("1:x");
const calls: { method: string; p: any }[] = [];
api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  return { ok: true, result: { message_id: 70, chat: { id: p.chat_id } } } as any;
});
await handle(api, it);
const row = tables.items.find((i) => i.id === 50)!;
console.log({ status: row.status, title: row.title, theme: row.theme, project: row.project, stance: row.stance, why_me: row.why_me, en: row.raw_meta?.en?.title });
assert.equal(row.status, "ok");
assert.ok(["typografie a písma", "designové reference", "háčky a marketing", "peníze a byznys nápady", "kód a nástroje", "studium", "recepty", "vtipné", "různé"].includes(row.theme));
assert.ok(row.project.every((p: string) => ["práce", "škola", "podnikání", "tvorba", "zdraví a domácnost", "různé"].includes(p)));
assert.equal(row.stance, "replicate"); // "chci taky" in the text
assert.ok(row.raw_meta?.en?.title);
const inChannel = calls.filter((c) => c.method === "sendMessage" && c.p.chat_id === -1002);
const post = inChannel[0], card = inChannel.find((c) => c.p.reply_parameters)!;
assert.ok(post, "post goes to the user's own channel");
assert.doesNotMatch(post.p.text, /Proč pro mě/); // header only
assert.match(card.p.text, /Proč pro mě/); assert.equal(card.p.reply_parameters.message_id, 70);
const reactions = calls.filter((c) => c.method === "setMessageReaction").map((c) => c.p.reaction[0].emoji);
assert.deepEqual(reactions, ["👀", "👌"]);
assert.ok(!calls.some((c) => c.method === "sendMessage" && c.p.chat_id === 777)); // /notify off → nothing in the chat
console.log("chat: reactions", reactions.join(" → "), "· no messages");
console.log("post in -1002:\n" + post.p.text.replace(/<[^>]+>/g, "") + "\n--- card (reply):\n" + card.p.text.replace(/<[^>]+>/g, ""));
console.log("✓ Czech user: Czech lists and labels, stance from the hint, EN copy, post in their own channel");
process.exit(0);
