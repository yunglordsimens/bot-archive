import { createHash } from "node:crypto";
import { InlineKeyboard, type Api } from "grammy";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import { claimItems, db, findByHash, FORMAT_VERSION, updateItem, type Item, type RawMeta, type Similar } from "./db.js";
import { analyze, embed, mediaPart, sleep, textPart, translateCard, urlPart, type Analysis } from "./gemini.js";
import { needsFormatAnalysis, parseHints } from "./hints.js";
import { addFormatAnalysis, contextText, tgDownload } from "./analysis.js";
import { fetchComments, fetchMeta, fetchProfile, fetchTikTok, fetchVideoGeneric, fetchWebPage, fetchYouTubeText, profileHandle, resolveTikTok, updateYtdlp, type Fetched } from "./fetchers.js";
import { postTranscript, publishToChannel, type Publish } from "./channel.js";
import { batchMessage, duplicateText, failedText, sourceLabel } from "./format.js";
import { tr, type Dict } from "./i18n/index.js";
import { getUserById, miscProject, profileOf, type User } from "./users.js";
import { renderCard } from "./card.js";

const DAY = 24 * 3600 * 1000;
const MAX_MEDIA_RETRIES = 7;

// media: the parts Gemini saw — reused for the deep format analysis without downloading again.
type Result = { analysis: Analysis; patch: Record<string, unknown>; status: "ok" | "pending_media" | "duplicate"; publish?: Publish; media?: Part[] };

const commentsText = (c: string[]) => (c.length ? c.join("\n") : undefined);
const profileUrl = (origin: string | null, handle?: string) =>
  handle && origin === "tiktok" ? `https://www.tiktok.com/@${handle}` : handle && origin === "instagram" ? `https://www.instagram.com/${handle}/` : undefined;

// Archive-channel problems must not lose the item: save it without the original and note why.
async function safeArchive(fn: () => Promise<{ fileIds: string[]; link?: string }>, patch: Record<string, unknown>) {
  try {
    return await fn();
  } catch (e) {
    console.warn("archive channel failed", e);
    patch.raw_meta = { ...(patch.raw_meta as object), archive_error: String((e as Error)?.message ?? e).slice(0, 300) };
    return { fileIds: [] as string[], link: undefined };
  }
}

// Status line on the "принято" message while the item is being processed.
async function stage(api: Api, it: Item, d: Dict, text: string) {
  if (!it.reply_message_id || it.batch_id) return;
  await api.editMessageText(it.tg_chat_id, it.reply_message_id, `${sourceLabel(d, it.input_kind, it.origin)} · ${text}`).catch(() => {});
}

async function processVideoLink(api: Api, it: Item, u: User, f: Fetched, commentsP: Promise<string[]>): Promise<Result> {
  const d = tr(u.lang);
  const comments = await commentsP;
  const media: Part[] = [];
  if (f.video) media.push(await mediaPart(f.video.buf, f.video.mime));
  for (const img of f.images ?? []) media.push(await mediaPart(img.buf, img.mime));
  const parts: Part[] = [textPart(contextText(it, {
    "Описание под видео (подпись автора)": f.caption, "Автор": f.author, "Субтитры автора": f.subtitles, "Топ-комментарии": commentsText(comments),
  })), ...media];
  const hasMedia = !!(f.video || f.images?.length);
  await stage(api, it, d, hasMedia ? (f.images?.length ? d.stage.thinkImages : d.stage.thinkVideo) : d.stage.noVideo);
  if (!hasMedia) parts.push(textPart("Видео не удалось скачать — опирайся только на подпись и автора."));

  const analysis = await analyze(parts, profileOf(u));
  const patch: Record<string, unknown> = { caption: f.caption, author: f.author, raw_meta: {
    via: f.via, log: f.log, stats: f.stats, comments, author_url: f.authorUrl ?? profileUrl(it.origin, f.author), published_at: f.stats?.published_at ?? f.date,
  } };
  if (!it.occurred_at && f.date) patch.occurred_at = f.date;
  if (hasMedia) patch.next_retry_at = null;
  else patch.next_retry_at = it.attempts < MAX_MEDIA_RETRIES ? new Date(Date.now() + DAY).toISOString() : null;
  return { analysis, patch, status: hasMedia ? "ok" : "pending_media", publish: hasMedia ? { kind: "upload", video: f.video, images: f.images } : undefined, media };
}

async function processItem(api: Api, it: Item, u: User): Promise<Result> {
  const p = profileOf(u);
  const kind = it.input_kind === "link" ? it.origin : it.input_kind;
  switch (kind) {
    case "tiktok": {
      // A shared TikTok link can point to a profile, not a video.
      const r = await resolveTikTok(it.source_url!);
      if (!r.id && profileHandle(r.url)) return processProfile(api, { ...it, source_url: r.url }, u);
      const comments = fetchComments(it.source_url!, "tiktok"); // in parallel with the download
      return processVideoLink(api, it, u, await fetchTikTok(it.source_url!), comments);
    }
    case "instagram": {
      const comments = fetchComments(it.source_url!, "instagram");
      return processVideoLink(api, it, u, await fetchVideoGeneric(it.source_url!), comments);
    }
    case "profile":
      return processProfile(api, it, u);

    case "youtube": {
      const meta = fetchMeta(it.source_url!); // in parallel with Gemini
      const comments = await fetchComments(it.source_url!, "youtube");
      const ytPatch = async () => {
        const m = await meta;
        return { author: m?.author, raw_meta: { stats: m?.stats, comments, author_url: m?.authorUrl, published_at: m?.stats?.published_at } };
      };
      try {
        const media = [urlPart(it.source_url!)];
        const analysis = await analyze([textPart(contextText(it, { "Топ-комментарии": commentsText(comments) })), ...media], p);
        return { analysis, patch: await ytPatch(), status: "ok", media };
      } catch (e) {
        console.warn(`youtube direct failed for ${it.id}, falling back to subs`, e);
        const y = await fetchYouTubeText(it.source_url!);
        const analysis = await analyze([textPart(contextText(it, {
          "Название": y.title, "Канал": y.author, "Описание": y.description?.slice(0, 3000), "Субтитры": y.subs,
        }))], p);
        return { analysis, patch: { ...(await ytPatch()), author: y.author, caption: y.title }, status: "ok" };
      }
    }

    case "other": {
      const page = await fetchWebPage(it.source_url!);
      const analysis = await analyze([textPart(contextText(it, { "Сайт": page.site, "Заголовок": page.title, "Текст страницы": page.text }))], p);
      return { analysis, patch: { caption: page.title, author: page.site }, status: "ok" };
    }

    case "text":
    case "forwarded": {
      const analysis = await analyze([textPart(contextText(it, { "Текст": it.input.text }))], p);
      return { analysis, patch: {}, status: "ok" };
    }

    default: {
      // screenshot / voice / audio / video / video_note — file is in Telegram
      const buf = await tgDownload(api, it.input.file_id!);
      const hash = createHash("sha256").update(buf).digest("hex");
      if (it.input_kind === "screenshot") {
        const dup = await findByHash(it.user_id, hash, it.id);
        if (dup) {
          return { analysis: dup as unknown as Analysis, status: "duplicate",
            patch: { media_hash: hash, duplicate_of: dup.id, title: dup.title, kind: dup.kind } };
        }
      }
      const media = [await mediaPart(buf, it.input.mime ?? "application/octet-stream")];
      const analysis = await analyze([textPart(contextText(it, { "Подпись": it.input.text })), ...media], p);
      return { analysis, status: "ok", patch: { media_hash: hash, archive_file_ids: [it.input.file_id] }, publish: { kind: "copy" }, media };
    }
  }
}

// Profile / account (SPEC §5.3a): a link (public data) or a screenshot of the profile grid.
async function processProfile(api: Api, it: Item, u: User): Promise<Result> {
  const extra: Record<string, string | undefined> = { "Тип записи": "профиль / аккаунт" };
  const patch: Record<string, unknown> = {};
  const media: Part[] = [];
  if (it.input?.file_id) {
    media.push(await mediaPart(await tgDownload(api, it.input.file_id), it.input.mime ?? "image/jpeg"));
    patch.archive_file_ids = [it.input.file_id];
  } else {
    const p = await fetchProfile(it.source_url!);
    Object.assign(extra, {
      "Платформа": p.platform, "Имя": p.name, "Ник": p.handle, "Био": p.bio,
      "Подписчики": p.followers?.toString(), "Подписки": p.following?.toString(), "Постов/видео": p.posts?.toString(), "Лайков всего": p.likes?.toString(),
      "Последние посты": p.recent?.join("; "), "Данные страницы": p.raw,
    });
    patch.author = p.handle ?? p.name;
    patch.source_url = it.source_url;
    patch.raw_meta = { author_url: it.source_url, profile: { followers: p.followers, following: p.following, posts: p.posts, likes: p.likes, bio: p.bio, platform: p.platform, verified: p.verified } };
  }
  const analysis = await analyze([textPart(contextText(it, extra)), ...media], profileOf(u));
  const meta = (patch.raw_meta ?? {}) as RawMeta;
  patch.raw_meta = { ...meta, profile: { ...meta.profile, entity: analysis.entity } };
  return { analysis, patch, status: "ok", publish: media.length ? { kind: "copy" } : undefined, media };
}

async function finishReply(api: Api, it: Item, u: User) {
  if (!it.reply_message_id) return;
  const d = tr(u.lang);
  let text: string;
  if (it.batch_id) {
    const { data } = await db.from("items").select().eq("user_id", it.user_id).eq("batch_id", it.batch_id).order("id");
    const batch = (data ?? []) as Item[];
    if (batch.some((b) => b.status === "queued" || b.status === "processing")) return;
    text = batchMessage(d, batch, miscProject(u));
  } else if (it.status === "failed") {
    text = failedText(d, it);
  } else if (it.status === "duplicate") {
    const { data } = await db.from("items").select("title, summary, created_at, archive_link").eq("id", it.duplicate_of!).single();
    text = data ? duplicateText(d, data) : d.dup("");
  } else {
    const c = renderCard(it, "short", u);
    await api.editMessageText(it.tg_chat_id, it.reply_message_id, c.text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: c.kb })
      .catch((e) => { if (!String(e?.description ?? e).includes("not modified")) console.warn("edit reply failed", e); });
    return;
  }
  try {
    const retry = !it.batch_id && it.status === "failed";
    await api.editMessageText(it.tg_chat_id, it.reply_message_id, text, {
      parse_mode: "HTML", link_preview_options: { is_disabled: true },
      ...(retry ? { reply_markup: new InlineKeyboard().text(d.card.retry, `retry:${it.id}`) } : {}),
    });
  } catch (e: any) {
    if (!String(e?.description ?? e).includes("not modified")) console.warn("edit reply failed", e);
  }
}

// Closest saved item by meaning; only returned when it's really close (SIMILAR_THRESHOLD).
export async function nearest(embedding: string, id: number, uid: number): Promise<Similar | undefined> {
  const { data, error } = await db.rpc("nearest_item", { query: embedding, exclude: id, uid });
  if (error) return void console.warn("nearest_item failed", error);
  const top = (data as Similar[] | null)?.[0];
  return top && top.similarity > config.similarThreshold ? top : undefined;
}

// Analysis → item fields, embedding, "похоже на", EN translation (for the channel post and the EN button).
export async function applyAnalysis(it: Item, a: Analysis, patch: Record<string, unknown>, u: User) {
  const hints = parseHints(it.input?.text);
  Object.assign(patch, {
    title: a.title, summary: a.summary, content_type: a.content_type, kind: a.kind, why_me: a.why_me,
    visual_description: a.visual_description, comments_note: a.comments_note || null,
    // Caption hints beat the model's guess.
    value_in: hints.value_in.length ? hints.value_in : a.value_in, stance: hints.stance ?? a.stance,
    theme: a.theme, project: a.project, tags: a.tags, structured: a.structured, raw_text: a.raw_text, language: a.language, error: null,
    embedding: JSON.stringify(await embed(`${a.title}\n${a.summary}\n${a.raw_text}`)),
  });
  const meta: RawMeta = { ...it.raw_meta, ...(patch.raw_meta as RawMeta), v: FORMAT_VERSION };
  const similar = await nearest(patch.embedding as string, it.id, it.user_id);
  if (similar) meta.similar = similar;
  try {
    const card = { title: a.title, summary: a.summary, structured: a.structured, why_me: a.why_me };
    meta.en = u.lang === "en" ? card : await translateCard(card); // summary + "why me" in the user's language and in English
  } catch (e) {
    console.warn(`translation failed for ${it.id}`, e);
    delete meta.en;
  }
  patch.raw_meta = meta;
}

// Every item gets a post in the archive channel (new format) + transcript reply under it.
async function publishItem(api: Api, it: Item, patch: Record<string, unknown>, pub: Publish, u: User) {
  const full = { ...it, ...patch } as Item;
  const posted = await safeArchive(() => publishToChannel(api, full, pub, u), patch);
  if (!posted.link) return;
  patch.archive_link = posted.link;
  if (posted.fileIds.length) Object.assign(patch, { archive_file_ids: posted.fileIds, tg_file_id: posted.fileIds[0] });
  const transcript = await postTranscript(api, { ...full, archive_link: posted.link }, posted.link, u).catch((e) => void console.warn("transcript post failed", e));
  if (transcript) patch.raw_meta = { ...(patch.raw_meta as RawMeta), transcript_link: transcript };
}

const MAX_TRANSIENT_ATTEMPTS = 4;
const isTransient = (e: string) => /503|500|429|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(e);
const errorReasonShort = (d: Dict, e: string) => (/429|RESOURCE_EXHAUSTED/i.test(e) ? d.errors.quota : /fetch failed|ECONN|ETIMEDOUT|socket/i.test(e) ? d.errors.network : d.errors.overloaded);

export async function handle(api: Api, it: Item) {
  const u = await getUserById(it.user_id);
  const d = tr(u.lang);
  const downloads = it.input_kind === "tiktok" || it.origin === "instagram";
  await stage(api, it, d, downloads ? d.stage.download : it.input_kind === "link" || it.input_kind === "profile" ? d.stage.read : d.stage.think);
  try {
    const r = await processItem(api, it, u);
    const a = r.analysis;
    const patch: Record<string, unknown> = { ...r.patch, status: r.status };
    if (r.status !== "duplicate") {
      await applyAnalysis(it, a, patch, u);
      // Deep format analysis only when the form matters (value_in) or the caption asks for it.
      if (r.media?.length && (needsFormatAnalysis(patch.value_in as string[]) || parseHints(it.input?.text).deepFormat)) {
        await stage(api, it, d, d.stage.format);
        await addFormatAnalysis(it, r.media, patch, d.geminiLanguage).catch((e) => console.warn(`format analysis failed for ${it.id}`, e));
      }
      await publishItem(api, it, patch, r.publish, u);
    }
    await updateItem(it.id, patch);
    Object.assign(it, patch);
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    // Temporary trouble (Gemini overloaded, network): back to the queue in a few minutes instead of failing.
    if (isTransient(error) && it.attempts < MAX_TRANSIENT_ATTEMPTS) {
      const min = 5 * it.attempts;
      console.warn(`item ${it.id}: temporary error, retry in ${min} min — ${error.slice(0, 200)}`);
      await updateItem(it.id, { status: "queued", error, next_retry_at: new Date(Date.now() + min * 60_000).toISOString() });
      await stage(api, it, d, d.stage.retryIn(errorReasonShort(d, error), min));
      return;
    }
    console.error(`item ${it.id} failed`, e);
    await updateItem(it.id, { status: "failed", error });
    Object.assign(it, { status: "failed", error });
  }
  await finishReply(api, it, u);
}

let lastYtdlpUpdate = 0;

// Once an hour: requeue pending_media whose retry time has come (after yt-dlp -U, max once a day).
async function requeueMedia() {
  const { data } = await db.from("items").select("id").eq("status", "pending_media").lte("next_retry_at", new Date().toISOString());
  if (!data?.length) return;
  if (Date.now() - lastYtdlpUpdate > DAY) {
    await updateYtdlp();
    lastYtdlpUpdate = Date.now();
  }
  // Keep the "принято" message untouched; the retry edits it again when done.
  await db.from("items").update({ status: "queued" }).in("id", data.map((d) => d.id));
  console.log(`requeued ${data.length} pending_media`);
}

export async function startWorker(api: Api) {
  // Items left in "processing" by a crash or Ctrl+C go back to the queue.
  const { data: stuck } = await db.from("items").update({ status: "queued", next_retry_at: null }).eq("status", "processing").select("id");
  if (stuck?.length) console.log(`returned ${stuck.length} stuck item(s) to the queue: ${stuck.map((s) => s.id).join(", ")}`);

  setInterval(() => requeueMedia().catch((e) => console.error("requeue", e)), 3600_000);
  requeueMedia().catch((e) => console.error("requeue", e));

  const running = new Set<Promise<void>>();
  for (;;) {
    try {
      const free = config.workerConcurrency - running.size;
      const items = free > 0 ? await claimItems(free) : [];
      for (const it of items) {
        const p: Promise<void> = handle(api, it).finally(() => running.delete(p));
        running.add(p);
      }
      if (!items.length) await sleep(2000);
      else await sleep(200);
    } catch (e) {
      console.error("worker loop", e);
      await sleep(5000);
    }
  }
}
