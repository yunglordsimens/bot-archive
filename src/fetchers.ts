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
  stats?: Stats;            // public counters at save time (SPEC §5.2)
  authorUrl?: string;       // profile link of the author
  log: string[];            // what each path did, for /probe and errors
};

// Public counters as the platform shows them when the item is saved — can't be recovered later.
export type Stats = {
  source: "yt-dlp" | "tikwm";
  captured_at: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  repost_count?: number;
  published_at?: string;
  author_followers?: number;
  duration?: number;
};

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

function statsFromYt(i: YtInfo): Stats {
  const published = i.timestamp ? new Date(i.timestamp * 1000).toISOString()
    : i.upload_date ? `${i.upload_date.slice(0, 4)}-${i.upload_date.slice(4, 6)}-${i.upload_date.slice(6, 8)}` : undefined;
  return clean({
    source: "yt-dlp" as const, captured_at: new Date().toISOString(),
    view_count: i.view_count, like_count: i.like_count, comment_count: i.comment_count, repost_count: i.repost_count,
    published_at: published, author_followers: i.channel_follower_count, duration: i.duration,
  });
}

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

type YtInfo = {
  description?: string; title?: string; uploader?: string; creator?: string; channel?: string; timestamp?: number; vcodec?: string; duration?: number;
  view_count?: number; like_count?: number; comment_count?: number; repost_count?: number; upload_date?: string; channel_follower_count?: number;
  uploader_url?: string; channel_url?: string; uploader_id?: string;
  comments?: { text?: string; like_count?: number; author?: string }[];
};

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

export async function resolveTikTok(url: string): Promise<{ url: string; id?: string; photo: boolean }> {
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
    stats: clean<Stats>({
      source: "tikwm", captured_at: new Date().toISOString(),
      view_count: j.data.play_count, like_count: j.data.digg_count, comment_count: j.data.comment_count, repost_count: j.data.share_count,
      published_at: j.data.create_time ? new Date(j.data.create_time * 1000).toISOString() : undefined, duration: j.data.duration,
    }),
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
        out.stats = statsFromYt(info);
        out.authorUrl = info.uploader_url || info.channel_url;
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
      out.stats ??= t.stats;
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
      out.stats = statsFromYt(info);
      out.authorUrl = info.uploader_url || info.channel_url;
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

// Top comments (SPEC §5.3a): 20–30 by likes. TikTok via TikWM first (yt-dlp pulls every comment there — slow),
// then yt-dlp with a hard timeout. Nothing → [] (the item is saved anyway).
export async function fetchComments(url: string, origin: string): Promise<string[]> {
  const top = (list: { text?: string; likes?: number }[]) => list
    .filter((c) => c.text?.trim())
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 25)
    .map((c) => `${c.likes ? `♥${c.likes} ` : ""}${c.text!.replace(/\s+/g, " ").slice(0, 300)}`);
  if (origin === "tiktok") {
    try {
      const res = await fetch(`https://www.tikwm.com/api/comment/list/?url=${encodeURIComponent(url)}&count=30&cursor=0`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const j: any = await res.json();
      const list = (j?.data?.comments ?? []).map((c: any) => ({ text: c.text, likes: c.digg_count }));
      if (list.length) return top(list);
    } catch {}
  }
  try {
    const { stdout } = await run("yt-dlp", ["--no-warnings", "--no-playlist", "-j", "--skip-download", "--write-comments",
      "--extractor-args", "youtube:max_comments=60,all,60,0;comment_sort=top", url], { timeout: 45_000, maxBuffer: 100 * 1024 * 1024 });
    const info = JSON.parse(stdout.trim().split("\n").pop()!) as YtInfo;
    return top((info.comments ?? []).map((c) => ({ text: c.text, likes: c.like_count })));
  } catch (e) {
    console.warn("comments skipped:", errMsg(e));
    return [];
  }
}

// Profile pages (SPEC §5.3a): whatever is public — name, bio, followers, recent post titles.
export type ProfileInfo = {
  platform: string; url: string; handle?: string; name?: string; bio?: string;
  followers?: number; following?: number; posts?: number; likes?: number; verified?: boolean; recent?: string[]; raw?: string;
};

export function profileHandle(url: string): { platform: string; handle: string } | undefined {
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|m)\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  if (/tiktok\.com$/.test(host) && seg.length === 1 && seg[0].startsWith("@")) return { platform: "tiktok", handle: seg[0].slice(1) };
  if (/instagram\.com$/.test(host) && seg.length === 1 && !["p", "reel", "reels", "tv", "stories", "explore", "accounts"].includes(seg[0])) return { platform: "instagram", handle: seg[0] };
  if (/youtube\.com$/.test(host) && (seg[0]?.startsWith("@") || ["channel", "c", "user"].includes(seg[0])) && seg.length <= 2 && !["videos", "shorts"].includes(seg[1] ?? ""))
    return { platform: "youtube", handle: seg[0].startsWith("@") ? seg[0].slice(1) : seg[1] ?? seg[0] };
}

export async function fetchProfile(url: string): Promise<ProfileInfo> {
  const p = profileHandle(url);
  const out: ProfileInfo = { platform: p?.platform ?? new URL(url).hostname, url, handle: p?.handle };
  if (p?.platform === "tiktok") {
    try {
      const j: any = await (await fetch(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(p.handle)}`, { headers: { "User-Agent": UA } })).json();
      const u = j?.data?.user, s = j?.data?.stats;
      if (u) Object.assign(out, { name: u.nickname, bio: u.signature, verified: u.verified, followers: s?.followerCount, following: s?.followingCount, likes: s?.heartCount, posts: s?.videoCount });
    } catch {}
  }
  if (p?.platform === "youtube") {
    try {
      const { stdout } = await run("yt-dlp", ["--no-warnings", "-J", "--flat-playlist", "--playlist-items", "1:10", url], { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
      const j = JSON.parse(stdout);
      Object.assign(out, { name: j.channel ?? j.uploader ?? j.title, bio: j.description, followers: j.channel_follower_count,
        recent: (j.entries ?? []).map((e: any) => e.title).filter(Boolean) });
    } catch {}
  }
  if (!out.name) {
    // Instagram / websites / fallback: Open Graph tags (Instagram puts "N Followers, N Following, N Posts" there).
    try {
      const html = await (await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(15000) })).text();
      const { document } = parseHTML(html);
      const og = (k: string) => document.querySelector(`meta[property="${k}"]`)?.getAttribute("content") ?? undefined;
      out.name = og("og:title") ?? document.title;
      out.raw = [og("og:description"), document.querySelector('meta[name="description"]')?.getAttribute("content")].filter(Boolean).join("\n");
    } catch {}
  }
  return out;
}

// Metadata only (no download, no subs) — for counters of links that skip yt-dlp otherwise (YouTube goes to Gemini directly).
export async function fetchStats(url: string): Promise<Stats | undefined> {
  return (await fetchMeta(url))?.stats;
}

// Author, caption and counters without downloading the video; TikTok falls back to oEmbed for the author.
export async function fetchMeta(url: string): Promise<{ author?: string; caption?: string; stats?: Stats; authorUrl?: string } | undefined> {
  try {
    const { stdout } = await run("yt-dlp", ["--no-warnings", "--no-playlist", "-j", "--skip-download", url], { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
    const info = JSON.parse(stdout.trim().split("\n").pop()!) as YtInfo;
    return { author: info.uploader || info.creator || info.channel, caption: info.description || info.title, stats: statsFromYt(info), authorUrl: info.uploader_url || info.channel_url };
  } catch (e) {
    console.warn("metadata failed", errMsg(e));
  }
  if (/tiktok\.com/.test(url)) {
    try {
      return await oembed((await resolveTikTok(url)).url);
    } catch {}
  }
}

export async function fetchYouTubeText(url: string): Promise<{ title?: string; description?: string; author?: string; subs?: string; duration?: number }> {
  return withTmp(async (dir) => {
    const { info, subs } = await ytdlp(url, dir, { video: false });
    return { title: info.title, description: info.description, author: info.channel || info.uploader, subs, duration: info.duration };
  });
}

const absUrl = (u: string | undefined, base: string) => {
  try {
    return u ? new URL(u, base).href : undefined;
  } catch {
    return undefined;
  }
};

export async function fetchWebPage(url: string): Promise<{ title?: string; text: string; site?: string; image?: string }> {
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
    image: absUrl(og("og:image") ?? document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ?? undefined, res.url || url),
  };
}
