import { InputFile, type Api } from "grammy";
import type { Item } from "./db.js";
import { archiveChannel, archiveUpload, link } from "./archive.js";
import { esc, typeLabel } from "./format.js";
import { splitMessages } from "./split.js";
import { fmtDate, tr, type Dict } from "./i18n/index.js";
import type { User } from "./users.js";
import type { Media } from "./fetchers.js";

// Archive-channel post, nothing truncated (SPEC §5.3a):
// (1) media with a short caption: title · @author · date of the original · directions/topics;
// (2) reply: text card — summary, «why me», EN, structured in full, comments, original description in full (split by paragraph if long);
// (3) reply: transcript (.txt if long).

const CAPTION_MAX = 1024;
const TRANSCRIPT_INLINE_MAX = 3500;

export type Publish = { kind: "upload"; video?: Media; images?: Media[] } | { kind: "copy" } | undefined;

const visible = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp);/g, "x").length;

const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

// "@author (link to profile) · 📅 date of the original · source"
function authorLine(d: Dict, it: Item) {
  const who = it.author ?? it.origin_detail;
  const handle = who ? (/\s/.test(who) ? who : `@${who.replace(/^@/, "")}`) : "";
  const url = it.raw_meta?.author_url;
  const author = handle ? (url ? `<a href="${url}">${esc(handle)}</a>` : esc(handle)) : "";
  const date = it.raw_meta?.published_at ?? it.raw_meta?.stats?.published_at ?? it.occurred_at;
  const published = date ? fmtDate(d, date, true) : "";
  const src = it.source_url && it.input_kind !== "profile" ? `<a href="${it.source_url}">${d.post.source}</a>` : "";
  return [author, published && `📅 ${published}`, src].filter(Boolean).join(" · ");
}

function profileLine(d: Dict, it: Item) {
  const p = it.raw_meta?.profile;
  if (it.input_kind !== "profile" || !p) return "";
  const entity = p.entity === "company" ? d.post.company : p.entity === "person" ? d.post.person : "";
  return [p.followers != null && `👥 ${d.post.followers(fmtNum(p.followers))}`, entity].filter(Boolean).join(" · ");
}

// (1) Short header for the media caption (or the first text message).
export function headerHtml(it: Item, u: User): string {
  const d = tr(u.lang);
  const projects = (it.project ?? []).join(", ");
  const meta = [projects && `🧭 ${esc(projects)}`, it.theme && `🗂 ${esc(it.theme)}`, typeLabel(d, it.content_type)].filter(Boolean).join(" · ");
  return [`<b>${esc(it.title ?? "")}</b>`, authorLine(d, it), profileLine(d, it), meta].filter(Boolean).join("\n");
}

// Caption that fits Telegram's limit without cutting text: an absurdly long header moves into the card instead.
const captionFor = (it: Item, u: User) => {
  const h = headerHtml(it, u);
  return visible(h) <= CAPTION_MAX ? h : esc(tr(u.lang).sources[it.input_kind] ?? "📥");
};

const section = (title: string, items?: string[], numbered = false) =>
  items?.length ? `<b>${esc(title)}</b>\n${items.map((x, i) => `${numbered ? `${i + 1}.` : "•"} ${esc(x)}`).join("\n")}` : "";

// (2) The text card as blocks; splitMessages packs them into ≤4096-char messages.
export function cardBlocks(it: Item, u: User): string[] {
  const d = tr(u.lang);
  const s = it.structured ?? {};
  const en = u.lang === "en" ? undefined : it.raw_meta?.en; // English users already read it in English
  const caption = it.input_kind === "text" || it.input_kind === "forwarded" ? "" : it.caption?.trim();
  const header = headerHtml(it, u);
  return [
    visible(header) > CAPTION_MAX ? header : "",
    esc(it.summary ?? ""),
    it.why_me ? `💭 <b>${d.post.why}</b>\n${esc(it.why_me)}` : "",
    section(d.card.points, s.points),
    section(d.card.ingredients, s.ingredients),
    section(d.card.steps, s.steps, true),
    ...(s.lists ?? []).map((l) => section(l.title, l.items)),
    it.comments_note ? `💬 <b>${d.card.comments}</b>\n${esc(it.comments_note)}` : "",
    en ? [`🇬🇧 <b>${esc(en.title)}</b>`, esc(en.summary), en.why_me ? `💭 <b>Why me</b>\n${esc(en.why_me)}` : ""].filter(Boolean).join("\n\n") : "",
    caption ? `📝 <b>${d.post.description}</b>\n${esc(caption)}` : "",
  ].filter(Boolean);
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
export async function publishToChannel(api: Api, it: Item, pub: Publish, u: User): Promise<{ fileIds: string[]; link?: string }> {
  const ch = archiveChannel(u);
  if (!ch) return { fileIds: [] };
  if (pub?.kind === "upload" && (pub.video || pub.images?.length)) {
    return archiveUpload(api, ch, pub, captionFor(it, u));
  }
  if (!pub && hasFile(it) && !it.input?.file_id) {
    // Downloaded media already in the channel (TikTok/Reels): re-send by file_id.
    return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, captionFor(it, u))) };
  }
  if (pub?.kind === "copy" || (!pub && hasFile(it))) {
    // File sent to the bot by the user: copy their message (keeps the original type), file_id as fallback.
    const caption = captionFor(it, u);
    if (it.input_kind === "video_note") return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, caption)) };
    try {
      const m = await api.copyMessage(ch, it.tg_chat_id, it.tg_message_id, { caption, parse_mode: "HTML" });
      return { fileIds: [], link: link(ch, m.message_id) };
    } catch {
      return { fileIds: [], link: link(ch, await sendByFileId(api, ch, it, caption)) };
    }
  }
  const m = await api.sendMessage(ch, headerHtml(it, u), { parse_mode: "HTML" });
  return { fileIds: [], link: link(ch, m.message_id) };
}

// Edit the existing post into the current format; if that's impossible, publish anew.
export async function rewritePost(api: Api, it: Item, u: User): Promise<{ link?: string; reposted: boolean }> {
  const target = it.archive_link ? parseLink(it.archive_link) : undefined;
  if (target && it.input_kind !== "video_note") {
    try {
      if (hasFile(it)) await api.editMessageCaption(target.chat, target.msg, { caption: captionFor(it, u), parse_mode: "HTML" });
      else await api.editMessageText(target.chat, target.msg, headerHtml(it, u), { parse_mode: "HTML" });
      return { link: it.archive_link!, reposted: false };
    } catch (e: any) {
      if (String(e?.description ?? e).includes("not modified")) return { link: it.archive_link!, reposted: false };
      console.warn(`post for item ${it.id} not editable, publishing anew:`, e?.description ?? e);
    }
  }
  const r = await publishToChannel(api, it, undefined, u);
  return { link: r.link, reposted: true };
}

// Transcript as a reply under the post; long ones as a .txt file. Re-runs edit the existing text reply.
export async function postTranscript(api: Api, it: Item, postLink: string, u: User, fresh = false): Promise<string | undefined> {
  const title = tr(u.lang).card.transcriptTitle;
  const text = it.raw_text?.trim();
  const post = parseLink(postLink);
  if (!text || !post) return;
  const old = it.raw_meta?.transcript_link ? parseLink(it.raw_meta.transcript_link) : undefined;
  if (old && fresh) await api.deleteMessage(old.chat, old.msg).catch(() => {}); // keep the order post → card → transcript
  else if (old && old.chat === post.chat) {
    if (text.length <= TRANSCRIPT_INLINE_MAX) {
      const ok = await api.editMessageText(old.chat, old.msg, `${title}\n\n${text}`).then(() => true, (e) => String(e?.description).includes("not modified"));
      if (ok) return it.raw_meta!.transcript_link;
    } else {
      return it.raw_meta!.transcript_link; // file already there
    }
  }
  const reply = { reply_parameters: { message_id: post.msg } };
  const m = text.length <= TRANSCRIPT_INLINE_MAX
    ? await api.sendMessage(post.chat, `${title}\n\n${text}`, reply)
    : await api.sendDocument(post.chat, new InputFile(Buffer.from(text, "utf8"), `transcript-${it.id}.txt`), { caption: title, ...reply });
  return link(post.chat, m.message_id);
}


// (2) Text card under the post, split into as many messages as needed. Re-runs edit the existing ones,
// add missing ones and remove extra ones. fresh = the card was created now (the transcript must go after it).
export async function postCard(api: Api, it: Item, postLink: string, u: User): Promise<{ links: string[]; fresh: boolean }> {
  const post = parseLink(postLink);
  if (!post) return { links: [], fresh: false };
  const texts = splitMessages(cardBlocks(it, u));
  const old = (it.raw_meta?.card_links ?? []).map(parseLink).filter((x): x is { chat: number; msg: number } => !!x && x.chat === post.chat);
  const links: string[] = [];
  for (const [i, text] of texts.entries()) {
    const o = old[i];
    if (o) {
      const ok = await api.editMessageText(o.chat, o.msg, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
        .then(() => true, (e) => String(e?.description).includes("not modified"));
      if (ok) {
        links.push(link(o.chat, o.msg));
        continue;
      }
    }
    const m = await api.sendMessage(post.chat, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_parameters: { message_id: post.msg } });
    links.push(link(post.chat, m.message_id));
  }
  for (const o of old.slice(texts.length)) await api.deleteMessage(o.chat, o.msg).catch(() => {});
  return { links, fresh: old.length === 0 };
}
