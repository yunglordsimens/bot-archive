import { createHash } from "node:crypto";
import { InlineKeyboard, type Api } from "grammy";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import { claimItems, db, findByHash, FORMAT_VERSION, updateItem, type Item, type RawMeta, type Similar } from "./db.js";
import { analyze, embed, mediaPart, sleep, textPart, translateCard, urlPart, type Analysis } from "./gemini.js";
import { needsFormatAnalysis, parseHints } from "./hints.js";
import { addFormatAnalysis, contextText, tgDownload } from "./analysis.js";
import { authorInfo, fetchComments, fetchMeta, fetchProfile, fetchTikTok, fetchVideoGeneric, fetchWebPage, fetchYouTubeText, profileHandle, resolveTikTok, updateYtdlp, type Fetched } from "./fetchers.js";
import { postCard, postTranscript, publishToChannel, rewritePost, type Publish } from "./channel.js";
import { batchMessage, duplicateText, errorReason, esc, failedText } from "./format.js";
import { archiveChannel } from "./archive.js";
import { react, REACT } from "./reactions.js";
import { tr, type Dict } from "./i18n/index.js";
import { getUserById, miscProject, profileOf, type User } from "./users.js";
import { renderCard } from "./card.js";
import { savePreview, youtubeThumb, type Thumb } from "./preview.js";

const DAY = 24 * 3600 * 1000;
const MAX_MEDIA_RETRIES = 7;

// media: the parts Gemini saw — reused for the deep format analysis without downloading again.
// thumb: what the Mini App preview frame is made from.
type Result = { analysis: Analysis; patch: Record<string, unknown>; status: "ok" | "pending_media" | "duplicate"; publish?: Publish; media?: Part[]; thumb?: Thumb };

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
// Progress is shown by the 👀 reaction only; the steps go to the Terminal log.
async function stage(_api: Api, it: Item, _d: Dict, text: string) {
  console.log(`item ${it.id}: ${text}`);
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

  const [analysis, author] = await Promise.all([analyze(parts, profileOf(u)), authorInfo(it.source_url!, f)]);
  const patch: Record<string, unknown> = { caption: f.caption, author: f.author, raw_meta: {
    via: f.via, log: f.log, stats: f.stats, comments, author, author_url: author?.url ?? f.authorUrl ?? profileUrl(it.origin, f.author),
    published_at: f.stats?.published_at ?? f.date,
  } };
  if (!it.occurred_at && f.date) patch.occurred_at = f.date;
  if (hasMedia) patch.next_retry_at = null;
  else patch.next_retry_at = it.attempts < MAX_MEDIA_RETRIES ? new Date(Date.now() + DAY).toISOString() : null;
  return { analysis, patch, status: hasMedia ? "ok" : "pending_media", publish: hasMedia ? { kind: "upload", video: f.video, images: f.images } : undefined, media,
    thumb: f.video?.buf ?? f.images?.[0]?.buf };
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
        const author = m && await authorInfo(it.source_url!, m);
        return { author: m?.author, raw_meta: { stats: m?.stats, comments, author, author_url: author?.url ?? m?.authorUrl, published_at: m?.stats?.published_at } };
      };
      try {
        const media = [urlPart(it.source_url!)];
        const analysis = await analyze([textPart(contextText(it, { "Топ-комментарии": commentsText(comments) })), ...media], p);
        return { analysis, patch: await ytPatch(), status: "ok", media, thumb: await youtubeThumb(it.source_url) };
      } catch (e) {
        console.warn(`youtube direct failed for ${it.id}, falling back to subs`, e);
        const y = await fetchYouTubeText(it.source_url!);
        const analysis = await analyze([textPart(contextText(it, {
          "Название": y.title, "Канал": y.author, "Описание": y.description?.slice(0, 3000), "Субтитры": y.subs,
        }))], p);
        return { analysis, patch: { ...(await ytPatch()), author: y.author, caption: y.title }, status: "ok", thumb: await youtubeThumb(it.source_url) };
      }
    }

    case "other": {
      const page = await fetchWebPage(it.source_url!);
      const analysis = await analyze([textPart(contextText(it, { "Сайт": page.site, "Заголовок": page.title, "Текст страницы": page.text }))], p);
      return { analysis, patch: { caption: page.title, author: page.site }, status: "ok", thumb: page.image };
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
      const picture = /^(image|video)\//.test(it.input.mime ?? "") || ["screenshot", "video", "video_note"].includes(it.input_kind);
      return { analysis, status: "ok", patch: { media_hash: hash, archive_file_ids: [it.input.file_id] }, publish: { kind: "copy" }, media, thumb: picture ? buf : undefined };
    }
  }
}

// Profile / account (SPEC §5.3a): a link (public data) or a screenshot of the profile grid.
async function processProfile(api: Api, it: Item, u: User): Promise<Result> {
  const extra: Record<string, string | undefined> = { "Тип записи": "профиль / аккаунт" };
  const patch: Record<string, unknown> = {};
  const media: Part[] = [];
  let thumb: Thumb | undefined;
  if (it.input?.file_id) {
    thumb = await tgDownload(api, it.input.file_id);
    media.push(await mediaPart(thumb, it.input.mime ?? "image/jpeg"));
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
  return { analysis, patch, status: "ok", publish: media.length ? { kind: "copy" } : undefined, media, thumb };
}

// Saved, but the archive post didn't go out (no channel, no rights, Telegram error) — the user must hear about it,
// otherwise 👌 looks like everything is in the channel.
const noPost = (it: Item) => (it.status === "ok" || it.status === "pending_media") && !it.archive_link;
const noPostReason = (d: Dict, it: Item, u: User) => (archiveChannel(u) ? errorReason(d, it.raw_meta?.archive_error) : d.noChannel);

// Albums already reported (one message per album, even if two photos finish at the same moment).
const batchesDone = new Set<string>();

// The result lives in the archive channel. In the chat: a reaction on the user's message, short errors,
// and — with /notify on — one line with a link to the post (with the card buttons).
async function finishReply(api: Api, it: Item, u: User) {
  const d = tr(u.lang);
  const opts = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true },
    reply_parameters: { message_id: it.tg_message_id, allow_sending_without_reply: true } };
  const send = (text: string, extra: object = {}) => api.sendMessage(it.tg_chat_id, text, { ...opts, ...extra }).catch((e) => void console.warn("chat message failed", e));
  await react(api, it.tg_chat_id, it.tg_message_id, it.status === "failed" ? REACT.error : it.status === "duplicate" ? REACT.repeat : REACT.done);

  if (it.batch_id) {
    const { data } = await db.from("items").select().eq("user_id", it.user_id).eq("batch_id", it.batch_id).order("id");
    const batch = (data ?? []) as Item[];
    if (batch.some((b) => b.status === "queued" || b.status === "processing") || batchesDone.has(it.batch_id)) return;
    batchesDone.add(it.batch_id);
    const failed = batch.filter((b) => b.status === "failed");
    const lost = batch.filter(noPost);
    let text = batchMessage(d, batch, miscProject(u));
    if (lost.length) text += `\n${d.batch.noPost(lost.length)} — ${esc(noPostReason(d, lost[0], u))} · /reprocess`;
    if (failed.length || lost.length || u.notify) await send(text, { reply_parameters: { message_id: batch[0].tg_message_id, allow_sending_without_reply: true } });
    return;
  }
  if (it.status === "failed") return void send(failedText(d, it), { reply_markup: new InlineKeyboard().text(d.card.retry, `retry:${it.id}`) });
  const postNote = noPost(it) ? d.noPost(esc(noPostReason(d, it, u))) : "";
  const repostKb = (kb: InlineKeyboard) => (postNote && archiveChannel(u) ? kb.text(d.card.repost, `repost:${it.id}`) : kb);
  if (it.status === "pending_media") {
    // Saved without the video — worth a short note even with /notify off.
    return void send(`${d.pendingNote}${it.archive_link ? ` · <a href="${it.archive_link}">${d.inArchive}</a>` : ""}${postNote && `\n${postNote}`}`,
      { reply_markup: repostKb(new InlineKeyboard().text(d.card.retry, `retry:${it.id}`)) });
  }
  if (postNote) return void send(postNote, { reply_markup: repostKb(new InlineKeyboard()) });
  if (!u.notify) return;
  if (it.status === "duplicate") {
    const { data } = await db.from("items").select("title, summary, created_at, archive_link").eq("id", it.duplicate_of!).single();
    if (data) await send(duplicateText(d, data));
    return;
  }
  const c = renderCard(it, "short", u);
  await send(c.text, { reply_markup: c.kb });
  for (const t of c.more) await send(t);
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
    title: a.title, summary: a.summary, content_type: a.content_type, kind: a.kind, why_me: a.why_me, why_tags: a.why_tags,
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
// An item posted while paused already has its post (with the media): it is edited, not posted a second time.
// A post without media (video didn't download back then) is replaced when the media is here now.
async function publishItem(api: Api, it: Item, patch: Record<string, unknown>, pub: Publish, u: User) {
  const full = { ...it, ...patch } as Item;
  const reuse = !!it.archive_link && !(pub?.kind === "upload" && !it.archive_file_ids?.length);
  const posted = await safeArchive(async () => {
    if (!reuse) return publishToChannel(api, full, pub, u);
    const r = await rewritePost(api, full, u);
    if (r.reposted) full.raw_meta = { ...full.raw_meta, card_links: undefined, transcript_link: undefined };
    return { fileIds: [] as string[], link: r.link };
  }, patch);
  if (!posted.link) return;
  patch.archive_link = posted.link;
  if (posted.fileIds.length) Object.assign(patch, { archive_file_ids: posted.fileIds, tg_file_id: posted.fileIds[0] });
  // Post → text card → transcript, each as a reply under the post (SPEC §5.3a).
  const card = await postCard(api, full, posted.link, u).catch((e) => void console.warn("card post failed", e));
  if (card) patch.raw_meta = { ...(patch.raw_meta as RawMeta), card_links: card.links };
  const transcript = await postTranscript(api, { ...full, archive_link: posted.link }, posted.link, u).catch((e) => void console.warn("transcript post failed", e));
  if (transcript) patch.raw_meta = { ...(patch.raw_meta as RawMeta), transcript_link: transcript };
}

// "📤 Post to channel" for an item saved without a post; TikTok / Reels are downloaded again (the video was never kept).
export async function republish(api: Api, it: Item, u: User): Promise<string> {
  let pub: Publish;
  if (it.input?.file_id) pub = { kind: "copy" };
  else if (!it.archive_file_ids?.length && it.source_url && (it.input_kind === "tiktok" || it.origin === "instagram")) {
    const f = it.input_kind === "tiktok" ? await fetchTikTok(it.source_url) : await fetchVideoGeneric(it.source_url);
    if (f.video || f.images?.length) pub = { kind: "upload", video: f.video, images: f.images };
  }
  const patch: Record<string, unknown> = { raw_meta: { ...it.raw_meta, archive_error: undefined, card_links: undefined, transcript_link: undefined } };
  await publishItem(api, it, patch, pub, u);
  await updateItem(it.id, patch);
  if (!patch.archive_link) throw new Error((patch.raw_meta as RawMeta).archive_error ?? "no post");
  return patch.archive_link as string;
}

const firstLine = (s?: string | null) => s?.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 100);

// Paused user (SPEC §7, /pause): saved, downloaded (yt-dlp is free) and posted to the archive channel as the original —
// but nothing goes to Gemini. /resume puts these items back to the queue; publishItem then edits this post.
// Never fails: what couldn't be fetched now is fetched again after /resume.
async function holdItem(api: Api, it: Item, u: User) {
  const meta: RawMeta = { ...it.raw_meta };
  const patch: Record<string, unknown> = { status: "paused" };
  let pub: Publish;
  const kind = it.input_kind === "link" ? it.origin : it.input_kind;
  try {
    if ((kind === "tiktok" || kind === "instagram") && it.source_url) {
      const f = kind === "tiktok" ? await fetchTikTok(it.source_url) : await fetchVideoGeneric(it.source_url);
      const author = await authorInfo(it.source_url, f).catch(() => undefined);
      Object.assign(patch, { caption: f.caption, author: f.author, title: firstLine(f.caption) });
      Object.assign(meta, { via: f.via, log: f.log, stats: f.stats, author, author_url: author?.url ?? f.authorUrl ?? profileUrl(it.origin, f.author),
        published_at: f.stats?.published_at ?? f.date });
      if (!it.occurred_at && f.date) patch.occurred_at = f.date;
      if (f.video || f.images?.length) pub = { kind: "upload", video: f.video, images: f.images };
    } else if (kind === "youtube" && it.source_url) {
      const m = await fetchMeta(it.source_url);
      const author = m && await authorInfo(it.source_url, m).catch(() => undefined);
      Object.assign(patch, { author: m?.author, caption: m?.caption, title: firstLine(m?.caption) });
      Object.assign(meta, { stats: m?.stats, author, author_url: author?.url ?? m?.authorUrl, published_at: m?.stats?.published_at });
    } else if (kind === "other" && it.source_url) {
      const p = await fetchWebPage(it.source_url);
      Object.assign(patch, { caption: p.title, author: p.site, title: p.title });
    } else if (it.input?.file_id) pub = { kind: "copy" };
  } catch (e) {
    console.warn(`item ${it.id} (paused): fetch failed, will retry after /resume`, (e as Error)?.message ?? e);
  }
  patch.title ??= firstLine(it.input?.text) ?? null;
  patch.raw_meta = meta;
  if (!it.archive_link) await publishItem(api, it, patch, pub, u);
  await updateItem(it.id, patch);
  Object.assign(it, patch);
  await react(api, it.tg_chat_id, it.tg_message_id, REACT.paused);
}

const MAX_TRANSIENT_ATTEMPTS = 4;
const isTransient = (e: string) => /503|500|429|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(e);
const errorReasonShort = (d: Dict, e: string) => (/429|RESOURCE_EXHAUSTED/i.test(e) ? d.errors.quota : /fetch failed|ECONN|ETIMEDOUT|socket/i.test(e) ? d.errors.network : d.errors.overloaded);

export async function handle(api: Api, it: Item) {
  const u = await getUserById(it.user_id);
  if (u.paused) return holdItem(api, it, u);
  const d = tr(u.lang);
  await react(api, it.tg_chat_id, it.tg_message_id, REACT.working); // also on retries
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
      patch.preview_path = await savePreview(it, r.thumb);
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
  // Paused users' items wait for /resume (a retry would call Gemini).
  const { data: paused } = await db.from("users").select("id").eq("paused", true);
  let q = db.from("items").select("id").eq("status", "pending_media").lte("next_retry_at", new Date().toISOString());
  if (paused?.length) q = q.not("user_id", "in", `(${paused.map((p) => p.id).join(",")})`);
  const { data } = await q;
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
