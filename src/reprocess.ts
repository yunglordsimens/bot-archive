import type { Api, Bot } from "grammy";
import type { Part } from "@google/genai";
import { db, updateItem, type Item, type RawMeta } from "./db.js";
import { analyze, mediaPart, textPart, urlPart } from "./gemini.js";
import { fetchMeta, fetchTikTok, fetchVideoGeneric, fetchWebPage, type Fetched } from "./fetchers.js";
import { postTranscript, rewritePost } from "./channel.js";
import { applyAnalysis, contextText, tgDownload } from "./worker.js";
import { renderCard } from "./card.js";
import { esc, plural } from "./format.js";

// /reprocess — bring saved items to the current format: re-run Gemini on the original from the archive
// channel, fill author / project / theme / why_me / EN / transcript, rewrite the channel post.
//   /reprocess        — items not yet in the current format
//   /reprocess all    — every saved item
//   /reprocess <id>   — one item

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
let running = false;

function mimeOf(it: Item, index: number): string {
  if (it.input_kind === "tiktok" || it.input_kind === "link") {
    return /images|gallery/.test(it.raw_meta?.via ?? "") || it.archive_file_ids.length > 1 ? "image/jpeg" : "video/mp4";
  }
  return index === 0 && it.input?.mime ? it.input.mime : "application/octet-stream";
}

// Media from the archive channel (by file_id); if Telegram won't give it (>20 MB), download from the source again.
async function originalMedia(api: Api, it: Item, log: string[]): Promise<Part[]> {
  const ids = it.archive_file_ids?.length ? it.archive_file_ids : it.input?.file_id ? [it.input.file_id] : [];
  try {
    const parts: Part[] = [];
    for (const [i, id] of ids.slice(0, 20).entries()) parts.push(await mediaPart(await tgDownload(api, id), mimeOf(it, i)));
    if (parts.length) return parts;
  } catch (e) {
    log.push(`из канала не скачалось: ${(e as Error).message?.slice(0, 80)}`);
  }
  if (!it.source_url || !["tiktok", "instagram"].includes(it.origin ?? "")) return [];
  const f: Fetched = it.origin === "tiktok" ? await fetchTikTok(it.source_url) : await fetchVideoGeneric(it.source_url);
  const parts: Part[] = [];
  if (f.video) parts.push(await mediaPart(f.video.buf, f.video.mime));
  for (const img of f.images ?? []) parts.push(await mediaPart(img.buf, img.mime));
  log.push(parts.length ? `скачано заново: ${f.via}` : "видео недоступно — разбор по подписи");
  return parts;
}

async function reprocessItem(api: Api, it: Item): Promise<{ reposted: boolean; link?: string }> {
  const log: string[] = [];
  const patch: Record<string, unknown> = {};
  const meta: RawMeta = { ...it.raw_meta };

  if (it.source_url && ["tiktok", "instagram", "youtube"].includes(it.origin ?? "")) {
    const m = await fetchMeta(it.source_url);
    if (m?.author) patch.author = it.author = m.author;
    if (m?.caption && !it.caption) patch.caption = it.caption = m.caption;
    if (m?.stats && !meta.stats) meta.stats = m.stats; // counters at save time are not recoverable; better late than never
  }

  const extra: Record<string, string | undefined> = { "Подпись автора": it.caption ?? undefined, "Автор": it.author ?? undefined };
  let media: Part[] = [];
  if (it.origin === "youtube") media = [urlPart(it.source_url!)];
  else if (it.input_kind === "text" || it.input_kind === "forwarded") extra["Текст"] = it.input?.text ?? it.raw_text ?? "";
  else if (it.input_kind === "link" && it.origin === "other") {
    try {
      const p = await fetchWebPage(it.source_url!);
      Object.assign(extra, { "Сайт": p.site, "Заголовок": p.title, "Текст страницы": p.text });
    } catch {
      extra["Сохранённый текст"] = it.raw_text ?? it.summary ?? "";
    }
  } else {
    media = await originalMedia(api, it, log);
    if (!media.length) extra["Сохранённый текст и суть"] = [it.raw_text, it.summary].filter(Boolean).join("\n\n");
  }

  const a = await analyze([textPart(contextText(it, extra)), ...media]);
  patch.raw_meta = { ...meta, reprocess_log: log };
  await applyAnalysis(it, a, patch);
  const full = { ...it, ...patch } as Item;

  const post = await rewritePost(api, full);
  if (post.link) {
    full.archive_link = patch.archive_link = post.link;
    const transcript = await postTranscript(api, full, post.link).catch(() => undefined);
    if (transcript) patch.raw_meta = { ...(patch.raw_meta as RawMeta), transcript_link: transcript };
  }
  await updateItem(it.id, patch);

  // Refresh the card in the chat, if it's still there.
  if (full.reply_message_id && !full.batch_id) {
    const c = renderCard({ ...full, ...patch } as Item, "short");
    await api.editMessageText(full.tg_chat_id, full.reply_message_id, c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  }
  return { reposted: post.reposted, link: post.link };
}

async function run(api: Api, items: Item[], chatId: number, progressId: number) {
  const reposted: { it: Item; link?: string }[] = [];
  const failed: { it: Item; error: string }[] = [];
  let edited = 0;
  for (const [i, it] of items.entries()) {
    await api.editMessageText(chatId, progressId, `🔄 перепрохожу ${i + 1}/${items.length}…`).catch(() => {});
    try {
      const r = await reprocessItem(api, it);
      if (r.reposted) reposted.push({ it, link: r.link });
      else edited++;
    } catch (e) {
      console.error(`reprocess ${it.id} failed`, e);
      failed.push({ it, error: (e as Error).message ?? String(e) });
    }
  }
  const title = (it: Item) => esc(it.title ?? it.source_url ?? `#${it.id}`);
  const lines = [`✅ <b>перепройдено: ${items.length - failed.length} из ${items.length}</b>`, `✏️ посты в канале переписаны: ${edited}`];
  if (reposted.length) {
    lines.push(``, `📤 <b>выложено заново</b> (старый пост бот изменить не смог или поста не было): ${reposted.length}`);
    for (const r of reposted) lines.push(`• ${r.link ? `<a href="${r.link}">${title(r.it)}</a>` : title(r.it)}`);
  }
  if (failed.length) {
    lines.push(``, `⚠️ <b>не получилось</b>: ${failed.length}`);
    for (const f of failed) lines.push(`• ${title(f.it)} — ${esc(f.error.slice(0, 120))}`);
  }
  const text = lines.join("\n");
  await api.editMessageText(chatId, progressId, text.slice(0, 4000), html).catch(() => api.sendMessage(chatId, text.slice(0, 4000), html));
}

export function registerReprocess(bot: Bot) {
  bot.command("reprocess", async (ctx) => {
    if (running) return ctx.reply("уже идёт — дождись отчёта");
    const arg = ctx.match.trim().toLowerCase();
    let q = db.from("items").select().in("status", ["ok", "pending_media"]).order("id");
    if (/^\d+$/.test(arg)) q = q.eq("id", Number(arg));
    const { data, error } = await q;
    if (error) throw error;
    const items = ((data ?? []) as Item[]).filter((it) => arg === "all" || /^\d+$/.test(arg) || (it.raw_meta?.v ?? 0) < 2);
    if (!items.length) return ctx.reply("все записи уже в новом формате. Принудительно: /reprocess all");
    const msg = await ctx.reply(`🔄 перепрохожу ${plural(items.length, "запись", "записи", "записей")}… это займёт пару минут, отчёт пришлю сюда`);
    running = true;
    // In the background: the bot keeps answering while this runs.
    void run(ctx.api, items, ctx.chat.id, msg.message_id).finally(() => { running = false; });
  });
}
