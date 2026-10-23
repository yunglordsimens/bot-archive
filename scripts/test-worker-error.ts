// Worker failure path offline (bad Gemini key): 🤷 reaction + one short error with a retry button, nothing else.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "1", GEMINI_API_KEY: "bad", GEMINI_FALLBACK_MODELS: "gemini-3.5-flash", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase() });
tables.users.push({ id: 1, telegram_user_id: 1, lang: "ru", is_admin: true, archive_channel_id: -1001, notify: false });
const it: any = { id: 9, user_id: 1, status: "processing", attempts: 1, input_kind: "text", origin: "telegram", tg_chat_id: 1, tg_message_id: 3, input: { text: "заметка" }, raw_meta: null };
tables.items.push(it);

const { Api } = await import("grammy");
const { handle } = await import("../src/worker.ts");
const api = new Api("1:x");
const calls: { method: string; p: any }[] = [];
api.config.use(async (_prev, method, p: any) => { calls.push({ method, p }); return { ok: true, result: { message_id: 70 } } as any; });
await handle(api, it);
const reactions = calls.filter((c) => c.method === "setMessageReaction").map((c) => c.p.reaction[0].emoji);
const msgs = calls.filter((c) => c.method === "sendMessage");
assert.equal(tables.items[0].status, "failed");
assert.deepEqual(reactions, ["👀", "🤷"]);
assert.equal(msgs.length, 1); assert.match(msgs[0].p.text, /не получилось/); assert.equal(msgs[0].p.reply_markup.inline_keyboard[0][0].callback_data, "retry:9");
console.log("✓ error: 👀 → 🤷 and one short message:", msgs[0].p.text.replace(/\n/g, " | "));
process.exit(0);
