import type { Api, Bot } from "grammy";
import type { Part } from "@google/genai";
import { db, FORMAT_VERSION, updateItem, type Item, type RawMeta } from "./db.js";
import { needsFormatAnalysis, parseHints } from "./hints.js";
import { analyze, textPart, urlPart } from "./gemini.js";
import { fetchComments, fetchMeta, fetchWebPage } from "./fetchers.js";
import { postCard, postTranscript, rewritePost } from "./channel.js";
import { applyAnalysis } from "./worker.js";
import { addFormatAnalysis, contextText, originalMedia } from "./analysis.js";
import { ensurePreview } from "./preview.js";
import { renderCard } from "./card.js";
import { esc } from "./format.js";
import { plural, tr } from "./i18n/index.js";
import { profileOf, type Ctx, type User } from "./users.js";

// /reprocess — bring saved items to the current format: re-run Gemini on the original from the archive
// channel, fill author / project / theme / why_me / EN / transcript, rewrite the channel post.
//   /reprocess        — items not yet in the current format
//   /reprocess all    — every saved item
//   /reprocess <id>   — one item

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const running = new Set<number>(); // user ids with a /reprocess in progress

async function reprocessItem(api: Api, it: Item, u: User): Promise<{ reposted: boolean; link?: string }> {
  const d = tr(u.lang);
  const log: string[] = [];
  const patch: Record<string, unknown> = {};
  const meta: RawMeta = { ...it.raw_meta };

  let comments: string[] = [];
  const isVideoLink = it.source_url && it.input_kind !== "profile" && ["tiktok", "instagram", "youtube"].includes(it.origin ?? "");
  if (isVideoLink) {
    const [m, c] = await Promise.all([fetchMeta(it.source_url!), fetchComments(it.source_url!, it.origin!)]);
    comments = c;
    if (m?.author) patch.author = it.author = m.author;
    if (m?.caption && !it.caption) patch.caption = it.caption = m.caption;
    if (m?.stats && !meta.stats) meta.stats = m.stats; // counters at save time are not recoverable; better late than never
    meta.author_url ??= m?.authorUrl ?? (it.origin === "tiktok" && it.author ? `https://www.tiktok.com/@${it.author}` : undefined);
    meta.published_at ??= meta.stats?.published_at ?? m?.stats?.published_at;
    if (comments.length) meta.comments = comments;
  }

  const extra: Record<string, string | undefined> = {
    "Описание под видео (подпись автора)": it.caption ?? undefined, "Автор": it.author ?? undefined,
    "Топ-комментарии": comments.length ? comments.join("\n") : undefined,
  };
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

  const a = await analyze([textPart(contextText(it, extra)), ...media], profileOf(u));
  patch.raw_meta = { ...meta, reprocess_log: log };
  await applyAnalysis(it, a, patch, u);
  if (media.length && (needsFormatAnalysis(patch.value_in as string[]) || parseHints(it.input?.text).deepFormat) && !it.hook) {
    await addFormatAnalysis(it, media, patch, d.geminiLanguage).catch((e) => log.push(`разбор формата не удался: ${(e as Error).message?.slice(0, 80)}`));
  }
  const full = { ...it, ...patch } as Item;

  const post = await rewritePost(api, full, u);
  if (post.link) {
    full.archive_link = patch.archive_link = post.link;
    // A post published anew starts its own reply chain.
    if (post.reposted) full.raw_meta = { ...full.raw_meta, card_links: undefined, transcript_link: undefined };
    const card = await postCard(api, full, post.link, u).catch((e) => void log.push(`карточка не опубликована: ${(e as Error).message?.slice(0, 80)}`));
    if (card) patch.raw_meta = full.raw_meta = { ...(patch.raw_meta as RawMeta), card_links: card.links };
    const transcript = await postTranscript(api, full, post.link, u, card?.fresh ?? false).catch(() => undefined);
    if (transcript) patch.raw_meta = { ...(patch.raw_meta as RawMeta), transcript_link: transcript };
  }
  await updateItem(it.id, patch);
  if (!it.preview_path) await ensurePreview(api, { ...it, ...patch } as Item).catch(() => {});

  // Refresh the card in the chat, if it's still there.
  if (full.reply_message_id && !full.batch_id) {
    const c = renderCard({ ...full, ...patch } as Item, "short", u);
    await api.editMessageText(full.tg_chat_id, full.reply_message_id, c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  }
  return { reposted: post.reposted, link: post.link };
}

async function run(api: Api, u: User, items: Item[], chatId: number, progressId: number) {
  const d = tr(u.lang);
  const reposted: { it: Item; link?: string }[] = [];
  const failed: { it: Item; error: string }[] = [];
  let edited = 0;
  for (const [i, it] of items.entries()) {
    await api.editMessageText(chatId, progressId, d.reprocess.progress(i + 1, items.length)).catch(() => {});
    try {
      const r = await reprocessItem(api, it, u);
      if (r.reposted) reposted.push({ it, link: r.link });
      else edited++;
    } catch (e) {
      console.error(`reprocess ${it.id} failed`, e);
      failed.push({ it, error: (e as Error).message ?? String(e) });
    }
  }
  const title = (it: Item) => esc(it.title ?? it.source_url ?? `#${it.id}`);
  const lines = [d.reprocess.done(items.length - failed.length, items.length), d.reprocess.edited(edited)];
  if (reposted.length) {
    lines.push(``, d.reprocess.reposted(reposted.length));
    for (const r of reposted) lines.push(`• ${r.link ? `<a href="${r.link}">${title(r.it)}</a>` : title(r.it)}`);
  }
  if (failed.length) {
    lines.push(``, d.reprocess.failed(failed.length));
    for (const f of failed) lines.push(`• ${title(f.it)} — ${esc(f.error.slice(0, 120))}`);
  }
  const text = lines.join("\n");
  await api.editMessageText(chatId, progressId, text.slice(0, 4000), html).catch(() => api.sendMessage(chatId, text.slice(0, 4000), html));
}

export function registerReprocess(bot: Bot<Ctx>) {
  bot.command("reprocess", async (ctx) => {
    const d = tr(ctx.user.lang);
    if (running.has(ctx.user.id)) return ctx.reply(d.reprocess.running);
    const arg = ctx.match.trim().toLowerCase();
    let q = db.from("items").select().eq("user_id", ctx.user.id).in("status", ["ok", "pending_media"]).order("id");
    if (/^\d+$/.test(arg)) q = q.eq("id", Number(arg));
    const { data, error } = await q;
    if (error) throw error;
    const items = ((data ?? []) as Item[]).filter((it) => arg === "all" || /^\d+$/.test(arg) || (it.raw_meta?.v ?? 0) < FORMAT_VERSION);
    if (!items.length) return ctx.reply(d.reprocess.allDone);
    const msg = await ctx.reply(d.reprocess.start(plural(d, items.length, d.forms.items)));
    running.add(ctx.user.id);
    // In the background: the bot keeps answering while this runs.
    void run(ctx.api, ctx.user, items, ctx.chat.id, msg.message_id).finally(() => running.delete(ctx.user.id));
  });
}
