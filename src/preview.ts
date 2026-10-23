import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Api } from "grammy";
import { config } from "./config.js";
import { db, type Item } from "./db.js";
import { tgDownload } from "./analysis.js";
import { fetchWebPage } from "./fetchers.js";
import { urlKey } from "./dedup.js";

const run = promisify(execFile);
const BUCKET = "previews";

// What a preview can be made from: the media itself or a picture URL (YouTube thumbnail, og:image).
export type Thumb = Buffer | string;

// One small jpg (≤480 px wide, ~50 KB) for the Mini App feed (SPEC §6.0). Video → frame at 1 s; image → resized.
export async function makePreview(src: Thumb): Promise<Buffer> {
  let buf = src;
  if (typeof buf === "string") {
    const res = await fetch(buf, { redirect: "follow" });
    if (!res.ok) throw new Error(`thumb HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  await mkdir(config.tmpDir, { recursive: true });
  const dir = await mkdtemp(join(config.tmpDir, "preview-"));
  try {
    const input = join(dir, "in");
    const out = join(dir, "out.jpg");
    await writeFile(input, buf);
    const args = (seek: string[]) => ["-y", "-loglevel", "error", ...seek, "-i", input, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "6", out];
    // Frame at 1 s skips black first frames; short clips and images have none there.
    for (const seek of [["-ss", "1"], []]) {
      await run("ffmpeg", args(seek), { timeout: 60_000 }).catch(() => {});
      const jpg = await readFile(out).catch(() => undefined);
      if (jpg?.length) return jpg;
    }
    throw new Error("ffmpeg made no frame");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Saves the preview to Storage; returns its path ("" = tried, nothing to show — not retried).
export async function savePreview(it: Pick<Item, "id" | "user_id">, src: Thumb | undefined): Promise<string> {
  if (!src) return "";
  try {
    const path = `${it.user_id}/${it.id}.jpg`;
    const { error } = await db.storage.from(BUCKET).upload(path, await makePreview(src), { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return path;
  } catch (e) {
    console.warn(`preview failed for ${it.id}:`, (e as Error)?.message ?? e);
    return "";
  }
}

export const youtubeThumb = async (url: string | null) => {
  const k = url ? await urlKey(url).catch(() => null) : null;
  return k?.startsWith("youtube:") ? `https://i.ytimg.com/vi/${k.slice(8)}/hqdefault.jpg` : undefined;
};

const NO_PICTURE = new Set(["voice", "audio", "text", "forwarded"]);

// Where to take a preview for an already saved item: the original in the archive channel, the file sent to the bot,
// the YouTube thumbnail or the page's og:image.
async function sourceFor(api: Api, it: Item): Promise<Thumb | undefined> {
  if (NO_PICTURE.has(it.input_kind)) return undefined;
  const fileId = it.tg_file_id ?? it.archive_file_ids?.[0] ?? it.input?.file_id;
  if (fileId) {
    const buf = await tgDownload(api, fileId).catch(() => undefined); // >20 MB can't be downloaded by a bot
    if (buf) return buf;
  }
  const yt = it.origin === "youtube" ? await youtubeThumb(it.source_url) : undefined;
  if (yt) return yt;
  if (it.input_kind === "link" && (it.origin === "other" || !it.origin) && it.source_url) {
    return (await fetchWebPage(it.source_url).catch(() => undefined))?.image;
  }
  return undefined;
}

// Items saved before previews existed (or by /reprocess): made once in the background, one by one.
export async function ensurePreview(api: Api, it: Item): Promise<string> {
  const path = await savePreview(it, await sourceFor(api, it));
  const { error } = await db.from("items").update({ preview_path: path }).eq("id", it.id);
  if (error) throw error;
  return path;
}

export async function backfillPreviews(api: Api) {
  let done = 0;
  for (;;) {
    const { data, error } = await db.from("items").select().is("preview_path", null).in("status", ["ok", "pending_media"]).order("id", { ascending: false }).limit(20);
    if (error || !data?.length) break;
    for (const it of data as Item[]) {
      if (await ensurePreview(api, it)) done++;
    }
  }
  if (done) console.log(`previews made for ${done} item(s)`);
}
