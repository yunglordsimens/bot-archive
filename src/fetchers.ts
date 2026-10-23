import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { config } from "./config.js";

const run = promisify(execFile);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type Media = { buf: Buffer; mime: string };
export type Fetched = {
  via: string;              // which path worked
  video?: Media;
  images?: Media[];
  caption?: string;
  author?: string;
  date?: string;
  subtitles?: string;
  log: string[];            // what each path did, for /probe and errors
};

export async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  await mkdir(config.tmpDir, { recursive: true });
  const dir = await mkdtemp(join(config.tmpDir, "job-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const mimeByExt: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
};
const extOf = (f: string) => f.split(".").pop()!.toLowerCase();

function cleanVtt(vtt: string): string {
  const lines = vtt.split("\n").filter((l) => l && !l.includes("-->") && !/^(WEBVTT|Kind:|Language:|\d+$)/.test(l));
  return [...new Set(lines.map((l) => l.replace(/<[^>]+>/g, "").trim()))].join(" ");
}

async function readSubs(dir: string): Promise<string | undefined> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
  if (!files.length) return;
  const preferred = files.find((f) => /\.(ru|uk|cs|en)/.test(f)) ?? files[0];
  return cleanVtt(await readFile(join(dir, preferred), "utf8")).slice(0, 20000);
}

// ---------- yt-dlp ----------

type YtInfo = { description?: string; title?: string; uploader?: string; creator?: string; channel?: string; timestamp?: number; vcodec?: string; duration?: number };

export async function ytdlp(url: string, dir: string, opts: { video: boolean }): Promise<{ info: YtInfo; file?: string; subs?: string }> {
  const args = [
    "--no-warnings", "--no-playlist", "--no-progress", "-j", "--no-simulate",
    "--write-subs", "--sub-langs", "ru.*,uk.*,cs.*,en.*", "--sub-format", "vtt",
    "-o", join(dir, "media.%(ext)s"),
  ];
  if (opts.video) args.push("-f", "b[filesize<45M]/b[filesize_approx<45M]/b");
  else args.push("--skip-download", "--write-auto-subs");
  const { stdout } = await run("yt-dlp", [...args, url], { timeout: 180_000, maxBuffer: 50 * 1024 * 1024 });
  const info = JSON.parse(stdout.trim().split("\n").pop()!) as YtInfo;
  const file = (await readdir(dir)).find((f) => f.startsWith("media.") && !f.endsWith(".vtt"));
  return { info, file: file && join(dir, file), subs: await readSubs(dir) };
}

// Docker: standalone binary updates itself. Homebrew install refuses -U → brew upgrade.
export async function updateYtdlp() {
  try {
    await run("yt-dlp", ["-U"], { timeout: 120_000 });
  } catch {
    try {
      await run("brew", ["upgrade", "yt-dlp"], { timeout: 300_000 });
    } catch (e) {
      console.warn("yt-dlp update failed", e);
    }
  }
}

// ---------- TikTok ----------

async function resolveTikTok(url: string): Promise<{ url: string; id?: string; photo: boolean }> {
  let final = url;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": UA } });
    final = res.url || url;
  } catch {}
  const m = final.match(/\/(video|photo)\/(\d+)/);
  return { url: final, id: m?.[2], photo: m?.[1] === "photo" };
}

async function download(url: string, referer?: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function tikwm(url: string) {
  const res = await fetch("https://www.tikwm.com/api/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ url, hd: "1" }),
  });
  const j: any = await res.json();
  if (j.code !== 0 || !j.data) throw new Error(`tikwm: ${j.msg ?? "no data"}`);
  const abs = (u?: string) => (u && u.startsWith("/") ? `https://www.tikwm.com${u}` : u);
  return {
    play: abs(j.data.play) as string | undefined,
    images: (j.data.images ?? []) as string[],
    caption: j.data.title as string | undefined,
    author: j.data.author?.unique_id as string | undefined,
    date: j.data.create_time ? new Date(j.data.create_time * 1000).toISOString() : undefined,
  };
}

async function oembed(url: string) {
  const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`oembed HTTP ${res.status}`);
  const j: any = await res.json();
  return { caption: j.title as string | undefined, author: j.author_unique_id ?? j.author_name };
}

async function embedPage(id: string): Promise<Buffer> {
  const page = `https://www.tiktok.com/embed/v2/${id}`;
  const html = await (await fetch(page, { headers: { "User-Agent": UA } })).text();
  const m = html.match(/"playAddr":"([^"]+)"/);
  if (!m) throw new Error("embed: no playAddr");
  return download(JSON.parse(`"${m[1]}"`), page);
}

async function galleryDl(url: string, parent: string): Promise<Media[]> {
  const dir = join(parent, "gallery");
  await run("gallery-dl", ["-q", "-D", dir, url], { timeout: 120_000 });
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort();
  return Promise.all(files.map(async (f) => ({ buf: await readFile(join(dir, f)), mime: mimeByExt[extOf(f)] })));
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200);

// Fallback chain: yt-dlp → TikWM → embed page → oEmbed (caption only).
export async function fetchTikTok(inputUrl: string): Promise<Fetched> {
  const r = await resolveTikTok(inputUrl);
  const out: Fetched = { via: "none", log: [`resolved: ${r.url}${r.photo ? " (photo)" : ""}`] };
  const meta = (p: { caption?: string; author?: string; date?: string }) => {
    out.caption ??= p.caption || undefined;
    out.author ??= p.author || undefined;
    out.date ??= p.date;
  };

  return withTmp(async (dir) => {
    // 1. yt-dlp
    if (!r.photo) {
      try {
        const { info, file, subs } = await ytdlp(r.url, dir, { video: true });
        meta({ caption: info.description || info.title, author: info.uploader || info.creator || info.channel,
          date: info.timestamp ? new Date(info.timestamp * 1000).toISOString() : undefined });
        out.subtitles = subs;
        if (file && info.vcodec !== "none" && mimeByExt[extOf(file)]?.startsWith("video/")) {
          out.video = { buf: await readFile(file), mime: mimeByExt[extOf(file)] };
          out.via = "yt-dlp";
          out.log.push("yt-dlp: video ok");
          return out;
        }
        out.log.push("yt-dlp: no video (slideshow?)");
        r.photo = true;
      } catch (e) {
        out.log.push(`yt-dlp: ${errMsg(e)}`);
      }
    }

    // 2. TikWM (video or slideshow images)
    try {
      const t = await tikwm(r.url);
      meta(t);
      if (t.images.length) {
        out.images = await Promise.all(t.images.slice(0, 20).map(async (u) => ({ buf: await download(u), mime: "image/jpeg" })));
        out.via = "tikwm-images";
        out.log.push(`tikwm: ${t.images.length} images`);
        return out;
      }
      if (t.play) {
        out.video = { buf: await download(t.play), mime: "video/mp4" };
        out.via = "tikwm";
        out.log.push("tikwm: video ok");
        return out;
      }
      out.log.push("tikwm: no media");
    } catch (e) {
      out.log.push(`tikwm: ${errMsg(e)}`);
    }

    // Slideshow via gallery-dl
    if (r.photo) {
      try {
        const imgs = await galleryDl(r.url, dir);
        if (imgs.length) {
          out.images = imgs;
          out.via = "gallery-dl";
          out.log.push(`gallery-dl: ${imgs.length} images`);
          return out;
        }
        out.log.push("gallery-dl: no images");
      } catch (e) {
        out.log.push(`gallery-dl: ${errMsg(e)}`);
      }
    }

    // 3. embed page
    if (r.id && !r.photo) {
      try {
        out.video = { buf: await embedPage(r.id), mime: "video/mp4" };
        out.via = "embed";
        out.log.push("embed: video ok");
        return out;
      } catch (e) {
        out.log.push(`embed: ${errMsg(e)}`);
      }
    }

    // 4. oEmbed — caption and author only
    try {
      meta(await oembed(r.url));
      out.via = "oembed";
      out.log.push("oembed: caption only");
    } catch (e) {
      out.log.push(`oembed: ${errMsg(e)}`);
    }
    return out;
  });
}

// Reels / Shorts / other video hosts — yt-dlp only.
export async function fetchVideoGeneric(url: string): Promise<Fetched> {
  const out: Fetched = { via: "none", log: [] };
  return withTmp(async (dir) => {
    try {
      const { info, file, subs } = await ytdlp(url, dir, { video: true });
      out.caption = info.description || info.title;
      out.author = info.uploader || info.channel;
      out.subtitles = subs;
      if (file && mimeByExt[extOf(file)]) {
        out.video = { buf: await readFile(file), mime: mimeByExt[extOf(file)] };
        out.via = "yt-dlp";
      }
    } catch (e) {
      out.log.push(`yt-dlp: ${errMsg(e)}`);
    }
    return out;
  });
}

export async function fetchYouTubeText(url: string): Promise<{ title?: string; description?: string; author?: string; subs?: string; duration?: number }> {
  return withTmp(async (dir) => {
    const { info, subs } = await ytdlp(url, dir, { video: false });
    return { title: info.title, description: info.description, author: info.channel || info.uploader, subs, duration: info.duration };
  });
}

export async function fetchWebPage(url: string): Promise<{ title?: string; text: string; site?: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru,uk,cs,en" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const { document } = parseHTML(html);
  const og = (p: string) => document.querySelector(`meta[property="${p}"]`)?.getAttribute("content") ?? undefined;
  let text = "";
  try {
    text = new Readability(document as any).parse()?.textContent ?? "";
  } catch {}
  if (!text.trim()) text = og("og:description") ?? document.body?.textContent ?? "";
  return {
    title: og("og:title") ?? document.title,
    text: text.replace(/\s+/g, " ").trim().slice(0, 30000),
    site: og("og:site_name") ?? new URL(url).hostname,
  };
}
