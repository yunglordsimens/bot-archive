// Offline check of the "канал-архив подключён" flow: fake Supabase REST + intercepted Telegram API.
import { createServer } from "node:http";
import assert from "node:assert/strict";

const OWNER = 585800070, CHANNEL = -1001234567890, STRANGER = 42;
const settings = new Map<string, string>();
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      for (const r of [JSON.parse(body)].flat()) settings.set(r.key, r.value);
      res.statusCode = 201;
      return res.end("[]");
    }
    const key = new URL(req.url!, "http://x").searchParams.get("key")?.replace(/^eq\./, "");
    const v = key && settings.get(key);
    res.end(v !== undefined && v !== null && key ? JSON.stringify({ value: v }) : "null");
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
Object.assign(process.env, {
  BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x",
  SUPABASE_URL: `http://127.0.0.1:${(srv.address() as any).port}`,
});

const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const sent: { chat_id: number; text: string }[] = [];
let dmBlocked = false;
bot.api.config.use(async (_prev, method, payload: any) => {
  if (method === "sendMessage") {
    if (dmBlocked && payload.chat_id === OWNER) throw new Error("403: bot can't initiate conversation with a user");
    sent.push({ chat_id: payload.chat_id, text: payload.text });
  }
  return { ok: true, result: { message_id: 1 } } as any;
});

let uid = 1;
const update = (fromId: number, chatType: string, status: string) => ({
  update_id: uid++,
  my_chat_member: {
    chat: { id: CHANNEL, type: chatType, title: "Архив" }, from: { id: fromId, is_bot: false, first_name: "u" },
    date: 0, old_chat_member: { status: "left", user: bot.botInfo }, new_chat_member: { status, user: bot.botInfo },
  },
} as any);

await bot.handleUpdate(update(OWNER, "channel", "administrator"));
assert.equal(settings.get("archive_channel_id"), String(CHANNEL));
assert.deepEqual(sent.at(-1), { chat_id: OWNER, text: `🗄 канал-архив подключён: Архив (${CHANNEL})` });
console.log("✓ owner makes bot admin → saved, DM to owner:", sent.at(-1)!.text);

dmBlocked = true; sent.length = 0;
await bot.handleUpdate(update(OWNER, "channel", "administrator"));
assert.equal(sent.at(-1)!.chat_id, CHANNEL);
console.log("✓ owner never pressed /start → message posted in the channel instead");
dmBlocked = false;

sent.length = 0; settings.clear();
await bot.handleUpdate(update(STRANGER, "channel", "administrator"));
await bot.handleUpdate(update(OWNER, "supergroup", "administrator"));
assert.equal(sent.length, 0); assert.equal(settings.size, 0);
console.log("✓ stranger / group → ignored");

settings.set("archive_channel_id", String(CHANNEL));
await bot.handleUpdate(update(OWNER, "channel", "kicked"));
assert.equal(settings.get("archive_channel_id"), "");
assert.match(sent.at(-1)!.text, /отключён/);
console.log("✓ bot removed → setting cleared, owner warned");

srv.close();
