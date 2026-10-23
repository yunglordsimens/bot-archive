import { Bot, type Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import { config, TG_FILE_LIMIT } from "./config.js";
import { db, findByTextHash, getSetting, insertItem, setSetting, type Item } from "./db.js";
import { acceptedText, duplicateText, plural } from "./format.js";
import { fetchTikTok, profileHandle } from "./fetchers.js";
import { parseHints } from "./hints.js";
import { registerUi } from "./ui.js";
import { registerCard } from "./card.js";
import { registerReprocess } from "./reprocess.js";
import { textHash, urlHash } from "./dedup.js";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function classifyUrl(url: string, caption?: string): { input_kind: string; origin: string } {
  const host = new URL(url).hostname.replace(/^www\./, "");
  // Profiles: tiktok.com/@x, instagram.com/x, youtube.com/@x — or any link with «профиль» in the message.
  const profile = profileHandle(url);
  if (profile) return { input_kind: "profile", origin: profile.platform };
  if (parseHints(caption).profile) return { input_kind: "profile", origin: "other" };
  if (/(^|\.)tiktok\.com$/.test(host)) return { input_kind: "tiktok", origin: "tiktok" };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { input_kind: "link", origin: "youtube" };
  if (/(^|\.)instagram\.com$/.test(host)) return { input_kind: "link", origin: "instagram" };
  return { input_kind: "link", origin: "other" };
}

function extractUrls(text: string, entities: MessageEntity[] = []): string[] {
  const urls = entities.flatMap((e) =>
    e.type === "url" ? [text.slice(e.offset, e.offset + e.length)] : e.type === "text_link" ? [e.url] : []);
  const found = urls.length ? urls : (text.match(/https?:\/\/\S+/g) ?? []);
  return [...new Set(found.map((u) => (u.startsWith("http") ? u : `https://${u}`)))];
}

function forwardInfo(m: Message) {
  const o = m.forward_origin;
  if (!o) return {};
  const author =
    o.type === "user" ? [o.sender_user.first_name, o.sender_user.last_name].filter(Boolean).join(" ") + (o.sender_user.username ? ` @${o.sender_user.username}` : "")
    : o.type === "hidden_user" ? o.sender_user_name
    : o.type === "chat" ? o.sender_chat.title ?? ""
    : o.chat.title ?? "";
  return { origin_detail: author, occurred_at: new Date(o.date * 1000).toISOString() };
}

type FileRef = { input_kind: string; file_id: string; mime: string; file_size?: number };

function fileOf(m: Message): FileRef | undefined {
  if (m.photo) {
    const p = m.photo[m.photo.length - 1];
    return { input_kind: "screenshot", file_id: p.file_id, mime: "image/jpeg", file_size: p.file_size };
  }
  if (m.voice) return { input_kind: "voice", file_id: m.voice.file_id, mime: m.voice.mime_type ?? "audio/ogg", file_size: m.voice.file_size };
  if (m.video_note) return { input_kind: "video_note", file_id: m.video_note.file_id, mime: "video/mp4", file_size: m.video_note.file_size };
  if (m.audio) return { input_kind: "audio", file_id: m.audio.file_id, mime: m.audio.mime_type ?? "audio/mpeg", file_size: m.audio.file_size };
  if (m.video) return { input_kind: "video", file_id: m.video.file_id, mime: m.video.mime_type ?? "video/mp4", file_size: m.video.file_size };
  if (m.document) {
    const mime = m.document.mime_type ?? "application/octet-stream";
    const type = mime.startsWith("image/") ? "screenshot" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
    return { input_kind: type, file_id: m.document.file_id, mime, file_size: m.document.file_size };
  }
}

function baseRow(m: Message) {
  return { tg_chat_id: m.chat.id, tg_message_id: m.message_id, origin: "telegram", ...forwardInfo(m) };
}

async function accept(ctx: Context, row: Partial<Item>) {
  const reply = await ctx.reply(acceptedText(row.input_kind!, row.origin), { reply_parameters: { message_id: ctx.msg!.message_id } });
  try {
    await insertItem({ ...row, reply_message_id: reply.message_id, status: "queued" } as Partial<Item>);
  } catch (e) {
    console.error("insert failed", e);
    await ctx.api.editMessageText(reply.chat.id, reply.message_id, `❌ не сохранилось: база недоступна (${dbErrorHint(e)})`).catch(() => {});
  }
}

export function dbErrorHint(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (/invalid api key|401|JWT/i.test(msg)) return "неверный SUPABASE_SERVICE_ROLE_KEY в .env";
  return msg.slice(0, 200);
}

// Albums arrive as separate updates with one media_group_id — buffer, then one reply per album.
const albums = new Map<string, { ctx: Context; msgs: Message[]; timer: NodeJS.Timeout }>();

async function flushAlbum(groupId: string) {
  const a = albums.get(groupId)!;
  albums.delete(groupId);
  const msgs = a.msgs.sort((x, y) => x.message_id - y.message_id);
  const files = msgs.map((m) => ({ m, f: fileOf(m)! }));
  const tooBig = files.filter(({ f }) => (f.file_size ?? 0) > TG_FILE_LIMIT).length;
  const ok = files.filter(({ f }) => (f.file_size ?? 0) <= TG_FILE_LIMIT);
  const reply = await a.ctx.api.sendMessage(msgs[0].chat.id,
    `🖼 ${plural(ok.length, "скрин", "скрина", "скринов")} · принято${tooBig ? ` · ${tooBig} слишком большие (>20 МБ)` : ""}`,
    { reply_parameters: { message_id: msgs[0].message_id } });
  if (!ok.length) return;
  const caption = msgs.find((m) => m.caption)?.caption;
  // One insert so the worker never sees half an album.
  const { error } = await db.from("items").insert(ok.map(({ m, f }) => ({
    ...baseRow(m), input_kind: f.input_kind, tg_file_id: f.file_id, batch_id: groupId, reply_message_id: reply.message_id,
    input: { file_id: f.file_id, mime: f.mime, file_size: f.file_size, text: caption },
  })));
  if (error) throw error;
}

export function createBot() {
  const bot = new Bot(config.botToken);

  // Archive channel: remember it when the owner makes the bot admin there.
  // Confirmation goes to the owner's private chat with the bot; if that fails (no /start yet) — into the channel.
  bot.on("my_chat_member", async (ctx) => {
    const u = ctx.myChatMember;
    if (u.from.id !== config.ownerId || u.chat.type !== "channel") return;
    const status = u.new_chat_member.status;
    if (status === "administrator") {
      await setSetting("archive_channel_id", String(u.chat.id));
      const text = `🗄 канал-архив подключён: ${u.chat.title} (${u.chat.id})`;
      console.log(text);
      try {
        await ctx.api.sendMessage(config.ownerId, text);
      } catch (e) {
        console.warn("owner DM failed (нажми /start в боте)", e);
        await ctx.api.sendMessage(u.chat.id, `${text}\nНапиши боту /start в личке — туда будут приходить ответы.`);
      }
    } else if ((status === "left" || status === "kicked" || status === "member") && (await getSetting("archive_channel_id")) === String(u.chat.id)) {
      await setSetting("archive_channel_id", "");
      await ctx.api.sendMessage(config.ownerId, `⚠️ бот больше не админ в «${u.chat.title}» — канал-архив отключён`).catch(() => {});
    }
  });

  // Whitelist: everyone else is silently ignored.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === config.ownerId && ctx.chat?.type === "private") await next();
  });

  registerUi(bot);
  registerCard(bot);
  registerReprocess(bot);

  // Diagnostics for the TikTok download chain: /probe <links…>
  bot.command("probe", async (ctx) => {
    const urls = extractUrls(ctx.match);
    if (!urls.length) return ctx.reply("/probe <ссылки на тиктоки>");
    await ctx.reply(`проверяю ${urls.length}…`);
    for (const url of urls) {
      try {
        const f = await fetchTikTok(url);
        const media = f.video ? `видео ${(f.video.buf.length / 1e6).toFixed(1)} МБ` : f.images ? `${f.images.length} картинок` : "без медиа";
        await ctx.reply(`${url}\n✅ ${f.via} · ${media}\n${f.log.join("\n")}`, { link_preview_options: { is_disabled: true } });
      } catch (e) {
        await ctx.reply(`${url}\n❌ ${e instanceof Error ? e.message : e}`, { link_preview_options: { is_disabled: true } });
      }
    }
  });

  bot.on("message", async (ctx) => {
    const m = ctx.message;
    const file = fileOf(m);

    if (file) {
      if (m.media_group_id) {
        const a = albums.get(m.media_group_id);
        if (a) {
          a.msgs.push(m);
          clearTimeout(a.timer);
        }
        const entry = a ?? { ctx, msgs: [m], timer: undefined as unknown as NodeJS.Timeout };
        entry.timer = setTimeout(() => flushAlbum(m.media_group_id!).catch((e) => console.error("album", e)), 1500);
        albums.set(m.media_group_id, entry);
        return;
      }
      if ((file.file_size ?? 0) > TG_FILE_LIMIT) return ctx.reply("слишком большой (>20 МБ) — не обработать", { reply_parameters: { message_id: m.message_id } });
      // A screenshot of a profile grid with «профиль» in the caption is analysed as a profile.
      const kind = file.input_kind === "screenshot" && parseHints(m.caption).profile ? "profile" : file.input_kind;
      return accept(ctx, { ...baseRow(m), input_kind: kind, tg_file_id: file.file_id, input: { file_id: file.file_id, mime: file.mime, file_size: file.file_size, text: m.caption } });
    }

    const text = m.text ?? m.caption;
    if (!text) return;
    const urls = extractUrls(text, m.entities ?? m.caption_entities);
    // Repeat: log it as a 'duplicate' row (repeats feed the future "what you keep coming back to"), tell how many times.
    const dupReply = async (d: Item, row: Partial<Item>) => {
      const reply = await ctx.reply(duplicateText(d), { ...html, reply_parameters: { message_id: m.message_id } });
      try {
        await insertItem({ ...baseRow(m), ...row, status: "duplicate", duplicate_of: d.id, reply_message_id: reply.message_id } as Partial<Item>);
        const { count } = await db.from("items").select("id", { count: "exact", head: true }).eq("duplicate_of", d.id);
        if (count) await ctx.api.editMessageText(m.chat.id, reply.message_id, duplicateText(d, count + 1), html);
      } catch (e) {
        console.warn("duplicate log failed", e);
      }
    };

    if (!urls.length) {
      const hash = textHash(text);
      const dup = await findByTextHash(hash);
      const row = { input_kind: m.forward_origin ? "forwarded" : "text", text_hash: hash, input: { text } };
      if (dup) return dupReply(dup, row);
      return accept(ctx, { ...baseRow(m), ...row });
    }

    for (const url of urls) {
      const hash = await urlHash(url);
      const dup = await findByTextHash(hash);
      if (dup) {
        await dupReply(dup, { ...classifyUrl(url, text), source_url: url, text_hash: hash, input: { text } });
        continue;
      }
      await accept(ctx, { ...baseRow(m), ...classifyUrl(url, text), source_url: url, text_hash: hash, input: { text } });
    }
  });

  bot.catch((err) => console.error("bot error", err.error));
  return bot;
}
