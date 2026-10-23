import { InputFile, type Api } from "grammy";
import { TYPES } from "./config.js";
import type { Item } from "./db.js";
import { archiveChannel, archiveUpload, link } from "./archive.js";
import { esc } from "./format.js";
import type { Media } from "./fetchers.js";

// Archive-channel post: title, @author, directions · theme · type, summary, «Зачем мне», EN.
// Transcript goes as a reply under the post (media captions are limited to 1024 chars).

const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;
const TRANSCRIPT_INLINE_MAX = 3500;

export type Publish = { kind: "upload"; video?: Media; images?: Media[] } | { kind: "copy" } | undefined;

const visible = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp);/g, "x").length;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

function authorLine(it: Item) {
  const who = it.author ?? it.origin_detail;
  const handle = who ? (/\s/.test(who) ? who : `@${who.replace(/^@/, "")}`) : "";
  const src = it.source_url ? `<a href="${it.source_url}">источник</a>` : "";
  return [esc(handle), src].filter(Boolean).join(" · ");
}

// Builds the post and shrinks the long parts until it fits the limit.
export function postHtml(it: Item, limit: number): string {
  const t = TYPES[it.content_type ?? "other"] ?? TYPES.other;
  const projects = (it.project ?? []).join(", ");
  const meta = [projects && `🧭 ${esc(projects)}`, it.theme && `🗂 ${esc(it.theme)}`, `${t.emoji} ${t.ru}`].filter(Boolean).join(" · ");
  const en = it.raw_meta?.en;
  let budget = 1500;
  for (;;) {
    const parts = [
      `<b>${esc(cut(it.title ?? "", 200))}</b>`,
      authorLine(it),
      meta,
      "",
      esc(cut(it.summary ?? "", budget)),
      it.why_me ? `\n💭 <b>Зачем мне:</b> ${esc(cut(it.why_me, Math.round(budget / 2)))}` : "",
      en ? `\n🇬🇧 <b>${esc(cut(en.title, 150))}</b> — ${esc(cut(en.summary, Math.round(budget * 0.7)))}` : "",
    ].filter((p, i) => p !== "" || i === 3);
    const html = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (visible(html) <= limit || budget < 60) return html;
    budget = Math.round(budget * 0.8);
  }
}

function parseLink(l: string): { chat: number; msg: number } | undefined {
  const m = l.match(/t\.me\/c\/(\d+)\/(\d+)/);
  return m ? { chat: Number(`-100${m[1]}`), msg: Number(m[2]) } : undefined;
}

const hasFile = (it: Item) => it.archive_file_ids?.length > 0 || !!it.input?.file_id;
const isPhotoSet = (it: Item) => /images|gallery/.test(it.raw_meta?.via ?? "") || (it.archive_file_ids?.length ?? 0) > 1;

// Send a file the bot already knows by file_id, with the post as caption.
async function sendByFileId(api: Api, ch: number, it: Item, caption: string): Promise<number> {
  const ids = it.archive_file_ids?.length ? it.archive_file_ids : [it.input.file_id!];
  const opts = { caption, parse_mode: "HTML" as const };
  if (it.input_kind === "tiktok" || it.input_kind === "link") {
    if (isPhotoSet(it)) {
      const msgs = await api.sendMediaGroup(ch, ids.slice(0, 10).map((id, i) => ({ type: "photo" as const, media: id, ...(i ? {} : opts) })));
      return msgs[0].message_id;
    }
    return (await api.sendVideo(ch, ids[0], opts)).message_id;
  }
  switch (it.input_kind) {
    case "voice": return (await api.sendVoice(ch, ids[0], opts)).message_id;
    case "audio": return (await api.sendAudio(ch, ids[0], opts)).message_id;
    case "video": return (await api.sendVideo(ch, ids[0], opts).catch(() => api.sendDocument(ch, ids[0], opts))).message_id;
    case "video_note": {
      const m = await api.sendVideoNote(ch, ids[0]);
      await api.sendMessage(ch, caption, { parse_mode: "HTML", reply_parameters: { message_id: m.message_id } });
      return m.message_id;
    }
    case "screenshot": return (await api.sendPhoto(ch, ids[0], opts).catch(() => api.sendDocument(ch, ids[0], opts))).message_id;
    default: return (await api.sendDocument(ch, ids[0], opts)).message_id;
  }
}

// New post for an item. Returns the link and file ids of uploaded media.
export async function publishToChannel(api: Api, it: Item, pub: Publish): Promise<{ fileIds: string[]; link?: string }> {
  const ch = await archiveChannel();
  if (!ch) return { fileIds: [] };
  if (pub?.kind === "upload" && (pub.video || pub.images?.length)) {
    return archiveUpload(api, pub, postHtml(it, CAPTION_MAX));
  }
  if (!pub && hasFile(it) && !it.input?.file_id) {
    // Downloaded media already in the channel (TikTok/Reels): re-send by file_id.
    return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, postHtml(it, CAPTION_MAX))) };
  }
  if (pub?.kind === "copy" || (!pub && hasFile(it))) {
    // File sent to the bot by the user: copy their message (keeps the original type), file_id as fallback.
    const caption = postHtml(it, CAPTION_MAX);
    if (it.input_kind === "video_note") return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, caption)) };
    try {
      const m = await api.copyMessage(ch, it.tg_chat_id, it.tg_message_id, { caption, parse_mode: "HTML" });
      return { fileIds: [], link: link(ch, m.message_id) };
    } catch {
      return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, caption)) };
    }
  }
  const m = await api.sendMessage(ch, postHtml(it, TEXT_MAX), { parse_mode: "HTML" });
  return { fileIds: [], link: link(ch, m.message_id) };
}

// Edit the existing post into the current format; if that's impossible, publish anew.
export async function rewritePost(api: Api, it: Item): Promise<{ link?: string; reposted: boolean }> {
  const target = it.archive_link ? parseLink(it.archive_link) : undefined;
  if (target && it.input_kind !== "video_note") {
    try {
      if (hasFile(it)) await api.editMessageCaption(target.chat, target.msg, { caption: postHtml(it, CAPTION_MAX), parse_mode: "HTML" });
      else await api.editMessageText(target.chat, target.msg, postHtml(it, TEXT_MAX), { parse_mode: "HTML" });
      return { link: it.archive_link!, reposted: false };
    } catch (e: any) {
      if (String(e?.description ?? e).includes("not modified")) return { link: it.archive_link!, reposted: false };
      console.warn(`post for item ${it.id} not editable, publishing anew:`, e?.description ?? e);
    }
  }
  const r = await publishToChannel(api, it, undefined);
  return { link: r.link, reposted: true };
}

// Transcript as a reply under the post; long ones as a .txt file. Re-runs edit the existing text reply.
export async function postTranscript(api: Api, it: Item, postLink: string): Promise<string | undefined> {
  const text = it.raw_text?.trim();
  const post = parseLink(postLink);
  if (!text || !post) return;
  const old = it.raw_meta?.transcript_link ? parseLink(it.raw_meta.transcript_link) : undefined;
  if (old && old.chat === post.chat) {
    if (text.length <= TRANSCRIPT_INLINE_MAX) {
      const ok = await api.editMessageText(old.chat, old.msg, `📜 Транскрипт\n\n${text}`).then(() => true, (e) => String(e?.description).includes("not modified"));
      if (ok) return it.raw_meta!.transcript_link;
    } else {
      return it.raw_meta!.transcript_link; // file already there
    }
  }
  const reply = { reply_parameters: { message_id: post.msg } };
  const m = text.length <= TRANSCRIPT_INLINE_MAX
    ? await api.sendMessage(post.chat, `📜 Транскрипт\n\n${text}`, reply)
    : await api.sendDocument(post.chat, new InputFile(Buffer.from(text, "utf8"), `transcript-${it.id}.txt`), { caption: "📜 Транскрипт", ...reply });
  return link(post.chat, m.message_id);
}

