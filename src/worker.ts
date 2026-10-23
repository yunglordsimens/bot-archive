import { createHash } from "node:crypto";
import { InlineKeyboard, type Api } from "grammy";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import { claimItems, db, findByHash, updateItem, type Item, type Similar } from "./db.js";
import { analyze, embed, mediaPart, sleep, textPart, urlPart, type Analysis } from "./gemini.js";
import { fetchTikTok, fetchVideoGeneric, fetchWebPage, fetchYouTubeText, updateYtdlp, type Fetched } from "./fetchers.js";
import { archiveCopy, archiveUpload } from "./archive.js";
import { batchMessage, duplicateText, sourceLabel } from "./format.js";
import { renderCard } from "./card.js";

const DAY = 24 * 3600 * 1000;
const MAX_MEDIA_RETRIES = 7;

type Result = { analysis: Analysis; patch: Record<string, unknown>; status: "ok" | "pending_media" | "duplicate" };

async function tgDownload(api: Api, fileId: string): Promise<Buffer> {
  const f = await api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
  if (!res.ok) throw new Error(`tg file HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function contextText(it: Item, extra: Record<string, string | undefined> = {}) {
  const lines = Object.entries({
    "Источник": it.origin && it.origin !== "telegram" ? it.origin : it.input_kind,
    "Ссылка": it.source_url ?? undefined,
    "Комментарий пользователя": it.input.text && it.source_url ? it.input.text : undefined,
    "Переслано от": it.origin_detail ?? undefined,
    ...extra,
  }).filter(([, v]) => v);
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

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
async function stage(api: Api, it: Item, text: string) {
  if (!it.reply_message_id || it.batch_id) return;
  await api.editMessageText(it.tg_chat_id, it.reply_message_id, `${sourceLabel(it.input_kind, it.origin)} · ${text}`).catch(() => {});
}

async function processVideoLink(api: Api, it: Item, f: Fetched): Promise<Result> {
  const parts: Part[] = [textPart(contextText(it, { "Подпись автора": f.caption, "Автор": f.author, "Субтитры автора": f.subtitles }))];
  if (f.video) parts.push(await mediaPart(f.video.buf, f.video.mime));
  for (const img of f.images ?? []) parts.push(await mediaPart(img.buf, img.mime));
  const hasMedia = !!(f.video || f.images?.length);
  await stage(api, it, hasMedia ? `🧠 разбираю ${f.images?.length ? "картинки" : "видео"}…` : "🧠 видео не скачалось, разбираю подпись…");
  if (!hasMedia) parts.push(textPart("Видео не удалось скачать — опирайся только на подпись и автора."));

  const analysis = await analyze(parts);
  const patch: Record<string, unknown> = { caption: f.caption, author: f.author, raw_meta: { via: f.via, log: f.log } };
  if (!it.occurred_at && f.date) patch.occurred_at = f.date;
  if (hasMedia) {
    const a = await safeArchive(() => archiveUpload(api, f, `${it.source_url}\n${analysis.title}`), patch);
    patch.archive_file_ids = a.fileIds;
    patch.tg_file_id = a.fileIds[0];
    patch.archive_link = a.link;
    patch.next_retry_at = null;
  } else {
    patch.next_retry_at = it.attempts < MAX_MEDIA_RETRIES ? new Date(Date.now() + DAY).toISOString() : null;
  }
  return { analysis, patch, status: hasMedia ? "ok" : "pending_media" };
}

async function processItem(api: Api, it: Item): Promise<Result> {
  const kind = it.input_kind === "link" ? it.origin : it.input_kind;
  switch (kind) {
    case "tiktok":
      return processVideoLink(api, it, await fetchTikTok(it.source_url!));
    case "instagram":
      return processVideoLink(api, it, await fetchVideoGeneric(it.source_url!));

    case "youtube": {
      try {
        const analysis = await analyze([textPart(contextText(it)), urlPart(it.source_url!)]);
        return { analysis, patch: {}, status: "ok" };
      } catch (e) {
        console.warn(`youtube direct failed for ${it.id}, falling back to subs`, e);
        const y = await fetchYouTubeText(it.source_url!);
        const analysis = await analyze([textPart(contextText(it, {
          "Название": y.title, "Канал": y.author, "Описание": y.description?.slice(0, 3000), "Субтитры": y.subs,
        }))]);
        return { analysis, patch: { author: y.author, caption: y.title }, status: "ok" };
      }
    }

    case "other": {
      const p = await fetchWebPage(it.source_url!);
      const analysis = await analyze([textPart(contextText(it, { "Сайт": p.site, "Заголовок": p.title, "Текст страницы": p.text }))]);
      return { analysis, patch: { caption: p.title, author: p.site }, status: "ok" };
    }

    case "text":
    case "forwarded": {
      const analysis = await analyze([textPart(contextText(it, { "Текст": it.input.text }))]);
      return { analysis, patch: {}, status: "ok" };
    }

    default: {
      // screenshot / voice / audio / video / video_note — file is in Telegram
      const buf = await tgDownload(api, it.input.file_id!);
      const hash = createHash("sha256").update(buf).digest("hex");
      if (it.input_kind === "screenshot") {
        const dup = await findByHash(hash, it.id);
        if (dup) {
          return { analysis: dup as unknown as Analysis, status: "duplicate",
            patch: { media_hash: hash, duplicate_of: dup.id, title: dup.title, kind: dup.kind } };
        }
      }
      const parts: Part[] = [textPart(contextText(it, { "Подпись": it.input.text }))];
      parts.push(await mediaPart(buf, it.input.mime ?? "application/octet-stream"));
      const analysis = await analyze(parts);
      const link = (await safeArchive(async () => ({ fileIds: [], link: await archiveCopy(api, it.tg_chat_id, it.tg_message_id) }), {})).link;
      return { analysis, status: "ok", patch: { media_hash: hash, archive_file_ids: [it.input.file_id], archive_link: link } };
    }
  }
}

async function finishReply(api: Api, it: Item) {
  if (!it.reply_message_id) return;
  let text: string;
  if (it.batch_id) {
    const { data } = await db.from("items").select().eq("batch_id", it.batch_id).order("id");
    const batch = (data ?? []) as Item[];
    if (batch.some((b) => b.status === "queued" || b.status === "processing")) return;
    text = batchMessage(batch);
  } else if (it.status === "failed") {
    text = "⚠️ не получилось разобрать · ссылка сохранена";
  } else if (it.status === "duplicate") {
    const { data } = await db.from("items").select("title, summary, created_at, archive_link").eq("id", it.duplicate_of!).single();
    text = data ? duplicateText(data) : "♻️ уже есть";
  } else {
    const c = renderCard(it, "short");
    await api.editMessageText(it.tg_chat_id, it.reply_message_id, c.text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: c.kb })
      .catch((e) => { if (!String(e?.description ?? e).includes("not modified")) console.warn("edit reply failed", e); });
    return;
  }
  try {
    const retry = !it.batch_id && it.status === "failed";
    await api.editMessageText(it.tg_chat_id, it.reply_message_id, text, {
      parse_mode: "HTML", link_preview_options: { is_disabled: true },
      ...(retry ? { reply_markup: new InlineKeyboard().text("🔁 Повторить", `retry:${it.id}`) } : {}),
    });
  } catch (e: any) {
    if (!String(e?.description ?? e).includes("not modified")) console.warn("edit reply failed", e);
  }
}

// Closest saved item by meaning; only returned when it's really close (SIMILAR_THRESHOLD).
async function nearest(embedding: string, id: number): Promise<Similar | undefined> {
  const { data, error } = await db.rpc("nearest_item", { query: embedding, exclude: id });
  if (error) return void console.warn("nearest_item failed", error);
  const top = (data as Similar[] | null)?.[0];
  return top && top.similarity > config.similarThreshold ? top : undefined;
}

async function handle(api: Api, it: Item) {
  const downloads = it.input_kind === "tiktok" || it.origin === "instagram";
  await stage(api, it, downloads ? "⬇️ скачиваю…" : it.input_kind === "link" ? "🔎 читаю…" : "🧠 разбираю…");
  try {
    const r = await processItem(api, it);
    const a = r.analysis;
    const patch: Record<string, unknown> = { ...r.patch, status: r.status };
    if (r.status !== "duplicate") {
      Object.assign(patch, {
        title: a.title, summary: a.summary, content_type: a.content_type, kind: a.kind,
        theme: a.theme, tags: a.tags, structured: a.structured, raw_text: a.raw_text, language: a.language,
        embedding: JSON.stringify(await embed(`${a.title}\n${a.summary}\n${a.raw_text}`)),
      });
      const similar = await nearest(patch.embedding as string, it.id);
      if (similar) patch.raw_meta = { ...(patch.raw_meta as object), similar };
    }
    await updateItem(it.id, patch);
    Object.assign(it, patch);
  } catch (e) {
    console.error(`item ${it.id} failed`, e);
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    await updateItem(it.id, { status: "failed", error });
    it.status = "failed";
  }
  await finishReply(api, it);
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
  // Items left in "processing" by a crash go back to the queue.
  await db.from("items").update({ status: "queued" }).eq("status", "processing");

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
