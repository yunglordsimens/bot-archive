import { createHash } from "node:crypto";
import type { Api } from "grammy";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import { claimItems, db, findByHash, updateItem, type Item } from "./db.js";
import { analyze, embed, mediaPart, sleep, textPart, urlPart, type Analysis } from "./gemini.js";
import { fetchTikTok, fetchVideoGeneric, fetchWebPage, fetchYouTubeText, updateYtdlp, type Fetched } from "./fetchers.js";
import { archiveCopy, archiveUpload } from "./archive.js";
import { batchMessage, resultMessage } from "./format.js";

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
    "Источник": it.source_type,
    "Ссылка": it.source_url ?? undefined,
    "Комментарий пользователя": it.input.text && it.source_url ? it.input.text : undefined,
    "Переслано от": it.forward_author ?? undefined,
    ...extra,
  }).filter(([, v]) => v);
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

async function processVideoLink(api: Api, it: Item, f: Fetched): Promise<Result> {
  const parts: Part[] = [textPart(contextText(it, { "Подпись автора": f.caption, "Автор": f.author, "Субтитры автора": f.subtitles }))];
  if (f.video) parts.push(await mediaPart(f.video.buf, f.video.mime));
  for (const img of f.images ?? []) parts.push(await mediaPart(img.buf, img.mime));
  const hasMedia = !!(f.video || f.images?.length);
  if (!hasMedia) parts.push(textPart("Видео не удалось скачать — опирайся только на подпись и автора."));

  const analysis = await analyze(parts);
  const patch: Record<string, unknown> = { caption: f.caption, author: f.author, original_date: f.date, error: hasMedia ? null : f.log.join("; ") };
  if (hasMedia) {
    const a = await archiveUpload(api, f, `${it.source_url}\n${analysis.title}`);
    patch.archive_file_ids = a.fileIds;
    patch.archive_link = a.link;
    patch.next_retry_at = null;
  } else {
    patch.next_retry_at = it.attempts < MAX_MEDIA_RETRIES ? new Date(Date.now() + DAY).toISOString() : null;
  }
  return { analysis, patch, status: hasMedia ? "ok" : "pending_media" };
}

async function processItem(api: Api, it: Item): Promise<Result> {
  switch (it.source_type) {
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

    case "web": {
      const p = await fetchWebPage(it.source_url!);
      const analysis = await analyze([textPart(contextText(it, { "Сайт": p.site, "Заголовок": p.title, "Текст страницы": p.text }))]);
      return { analysis, patch: { caption: p.title, author: p.site }, status: "ok" };
    }

    case "text": {
      const analysis = await analyze([textPart(contextText(it, { "Текст": it.input.text }))]);
      return { analysis, patch: {}, status: "ok" };
    }

    default: {
      // screenshot / voice / audio / video / video_note — file is in Telegram
      const buf = await tgDownload(api, it.input.file_id!);
      const hash = createHash("sha256").update(buf).digest("hex");
      if (it.source_type === "screenshot") {
        const dup = await findByHash(hash, it.id);
        if (dup) {
          return { analysis: dup as unknown as Analysis, status: "duplicate",
            patch: { file_hash: hash, duplicate_of: dup.id, title: dup.title, kind: dup.kind } };
        }
      }
      const parts: Part[] = [textPart(contextText(it, { "Подпись": it.input.text }))];
      parts.push(await mediaPart(buf, it.input.mime ?? "application/octet-stream"));
      const analysis = await analyze(parts);
      const link = await archiveCopy(api, it.tg_chat_id, it.tg_message_id);
      return { analysis, status: "ok", patch: { file_hash: hash, archive_file_ids: [it.input.file_id], archive_link: link } };
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
    text = "⚠️ не получилось разобрать · сохранено, ссылка не потеряется";
  } else if (it.status === "duplicate") {
    text = "♻️ уже есть";
  } else {
    text = resultMessage(it);
  }
  try {
    await api.editMessageText(it.tg_chat_id, it.reply_message_id, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e: any) {
    if (!String(e?.description ?? e).includes("not modified")) console.warn("edit reply failed", e);
  }
}

async function handle(api: Api, it: Item) {
  try {
    const r = await processItem(api, it);
    const a = r.analysis;
    const patch: Record<string, unknown> = { ...r.patch, status: r.status };
    if (r.status !== "duplicate") {
      Object.assign(patch, {
        title: a.title, summary: a.summary, content_type: a.content_type, kind: a.kind,
        theme: a.theme, tags: a.tags, structured: a.structured, raw_text: a.raw_text,
        embedding: JSON.stringify(await embed(`${a.title}\n${a.summary}\n${a.raw_text}`)),
      });
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
