import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { getSetting, setSetting } from "./db.js";

// Switching between Telegram's cloud Bot API and the local telegram-bot-api server (SPEC §2, files up to 2 GB).
// Telegram's rule: before the first start on a local server the bot logs out of the cloud one (once);
// after that the cloud refuses it for ~10 minutes, so the local server must be up before we log out.
const CLOUD = "https://api.telegram.org";

async function call(root: string, method: string): Promise<{ ok: boolean; description?: string; result?: any }> {
  const res = await fetch(`${root}/bot${config.botToken}/${method}`, { method: "POST", signal: AbortSignal.timeout(15000) });
  return res.json() as Promise<{ ok: boolean; description?: string }>;
}

export async function prepareBotApi() {
  const mode = await getSetting("bot_api");
  if (!config.botApiUrl) {
    if (mode === "local") {
      // Back to the cloud: it accepts the bot again ~10 minutes after the logOut.
      console.warn("BOT_API_URL пуст — бот снова на облачном Bot API. Если Telegram отвечает «Logged out», подожди 10 минут.");
      await setSetting("bot_api", "cloud");
    }
    return;
  }

  const me = await call(config.botApiUrl, "getMe").catch((e) => ({ ok: false, description: String(e?.message ?? e) }));
  if (!me.ok) {
    console.error(`❌ локальный telegram-bot-api не отвечает (${config.botApiUrl}): ${me.description ?? ""}\n` +
      "   Запусти его: docker compose up -d telegram-bot-api (нужны TELEGRAM_API_ID и TELEGRAM_API_HASH в .env)");
    process.exit(1); // start-mac.sh retries in 10 s — the server may still be starting
  }
  if (mode === "local") return;

  const out = await call(CLOUD, "logOut");
  if (!out.ok && !/logged out/i.test(out.description ?? "")) throw new Error(`logOut from the cloud Bot API failed: ${out.description}`);
  await setSetting("bot_api", "local");
  console.log(`bot moved to the local Bot API server ${config.botApiUrl} (logged out of the cloud)`);
}

// The local server keeps a copy of every file the bot downloaded (<dir>/<bot>/videos, photos, documents…) and never
// deletes it. Copies older than BOT_API_KEEP_DAYS are removed; if one is needed again (/reprocess, previews),
// the server downloads it from Telegram anew. Files directly in <dir>/<bot>/ (td.binlog — the server's own state) stay.
async function removeOld(dir: string, before: number): Promise<{ files: number; bytes: number }> {
  const out = { files: 0, bytes: 0 };
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = await removeOld(p, before);
      out.files += r.files;
      out.bytes += r.bytes;
    } else if (e.isFile()) {
      const s = await stat(p).catch(() => undefined);
      if (!s || s.mtimeMs >= before) continue;
      await rm(p, { force: true });
      out.files++;
      out.bytes += s.size;
    }
  }
  return out;
}

export async function cleanBotApiFiles(now = Date.now()) {
  const before = now - config.botApiKeepDays * 24 * 3600 * 1000;
  const total = { files: 0, bytes: 0 };
  const add = (r: { files: number; bytes: number }) => { total.files += r.files; total.bytes += r.bytes; };
  for (const e of await readdir(config.botApiDir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    if (e.name === "tmp") { add(await removeOld(join(config.botApiDir, e.name), before)); continue; } // upload leftovers
    // A bot's folder: only its subfolders hold file copies.
    for (const sub of await readdir(join(config.botApiDir, e.name), { withFileTypes: true }).catch(() => [])) {
      if (sub.isDirectory()) add(await removeOld(join(config.botApiDir, e.name, sub.name), before));
    }
  }
  if (total.files) console.log(`removed ${total.files} file copies older than ${config.botApiKeepDays} days (${(total.bytes / 1048576).toFixed(0)} MB)`);
  return total;
}

// At start and every 6 hours.
export function startBotApiCleanup() {
  if (!config.botApiUrl) return;
  const run = () => cleanBotApiFiles().catch((e) => console.warn("file cleanup failed:", e?.message ?? e));
  run();
  setInterval(run, 6 * 3600_000).unref();
}
