// Offline test of task 14: local telegram-bot-api — switch from the cloud (one logOut), files read from the server's folder, 2 GB limit.
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

// Fake local Bot API server: answers getMe; can be "down".
let localUp = true;
const srv = createServer((req, res) => {
  if (!localUp) { res.statusCode = 502; return res.end("down"); }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } }));
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const dir = await mkdtemp(join(tmpdir(), "botapi-"));
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: "1", GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase(),
  BOT_API_URL: `http://127.0.0.1:${(srv.address() as any).port}/`, BOT_API_DIR: dir });

// The cloud Bot API is faked: count logOut calls.
const cloud: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    cloud.push(String(url).split("/").pop()!);
    return Response.json({ ok: true, result: true });
  }
  return realFetch(url, init);
}) as typeof fetch;

const { config, TG_FILE_LIMIT, TG_UPLOAD_LIMIT } = await import("../src/config.ts");
const { prepareBotApi } = await import("../src/botapi.ts");
assert.equal(config.botApiUrl, process.env.BOT_API_URL!.replace(/\/$/, ""));
assert.equal(TG_FILE_LIMIT, 2000 * 1024 * 1024);
assert.equal(TG_UPLOAD_LIMIT, 2000 * 1024 * 1024);

// 1. Server down → exit 1 (start-mac.sh restarts), no logOut from the cloud.
localUp = false;
const exit = process.exit;
process.exit = ((code: number) => { throw new Error(`exit ${code}`); }) as typeof process.exit;
await assert.rejects(prepareBotApi(), /exit 1/);
assert.deepEqual(cloud, []);
console.log("✓ local server down → exit 1, still on the cloud");

// 2. Server up → one logOut from the cloud, remembered; the next start doesn't log out again.
localUp = true;
await prepareBotApi();
await prepareBotApi();
process.exit = exit;
assert.deepEqual(cloud, ["logOut"]);
assert.equal(tables.settings.find((s) => s.key === "bot_api")?.value, "local");
console.log("✓ switch: one logOut from the cloud, setting bot_api = local");

// 3. getFile on the local server gives an absolute path in its folder → read from BOT_API_DIR.
await mkdir(join(dir, "1:x", "videos"), { recursive: true });
await writeFile(join(dir, "1:x", "videos", "file_7.mp4"), "big phone video");
const { Api } = await import("grammy");
const api = new Api("1:x");
api.config.use(async () => ({ ok: true, result: { file_id: "f", file_unique_id: "u", file_path: "/var/lib/telegram-bot-api/1:x/videos/file_7.mp4" } }) as any);
const { tgDownload } = await import("../src/analysis.ts");
assert.equal((await tgDownload(api, "f")).toString(), "big phone video");
console.log("✓ file from the local server read from its folder");

// 4. Intake: a 300 MB phone video is accepted, a 3 GB one gets "too big (>2 ГБ)".
tables.users.push({ id: 1, telegram_user_id: 1, lang: "ru", is_admin: true, archive_channel_id: -1001, notify: false });
const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const calls: { method: string; p: any }[] = [];
bot.api.config.use(async (_prev, method, p: any) => { calls.push({ method, p }); return { ok: true, result: true } as any; });
const video = (id: number, mb: number) => ({ update_id: id, message: { message_id: id, date: 0, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "u" },
  video: { file_id: `v${id}`, file_unique_id: `u${id}`, width: 1, height: 1, duration: 60, mime_type: "video/mp4", file_size: mb * 1024 * 1024 } } } as any);
await bot.handleUpdate(video(10, 300));
assert.equal(tables.items.find((i) => i.tg_message_id === 10)?.status, "queued");
await bot.handleUpdate(video(11, 3000));
assert.equal(tables.items.find((i) => i.tg_message_id === 11), undefined);
const reply = calls.find((c) => c.method === "sendMessage")!;
assert.match(reply.p.text, /слишком большой \(>2 ГБ\)/);
console.log("✓ 300 MB video queued; 3 GB →", reply.p.text);

// 5. Cleanup: copies older than 3 days go, fresh ones and the server's own td.binlog stay.
const old = (Date.now() - 4 * 24 * 3600_000) / 1000;
await mkdir(join(dir, "1:x", "photos"), { recursive: true });
for (const [f, t] of [["1:x/videos/file_1.mp4", old], ["1:x/photos/file_2.jpg", old], ["1:x/td.binlog", old], ["tmp/upload", old]] as const) {
  await mkdir(join(dir, f, ".."), { recursive: true });
  await writeFile(join(dir, f), "x".repeat(1000));
  await utimes(join(dir, f), t, t);
}
const { cleanBotApiFiles } = await import("../src/botapi.ts");
const r = await cleanBotApiFiles();
const exists = (f: string) => access(join(dir, f)).then(() => true, () => false);
assert.equal(r.files, 3);
assert.equal(await exists("1:x/videos/file_1.mp4"), false);
assert.equal(await exists("1:x/photos/file_2.jpg"), false);
assert.equal(await exists("tmp/upload"), false);
assert.equal(await exists("1:x/videos/file_7.mp4"), true); // fresh
assert.equal(await exists("1:x/td.binlog"), true);        // server state
console.log("✓ cleanup: 3 old copies removed, fresh file and td.binlog kept");
process.exit(0);
