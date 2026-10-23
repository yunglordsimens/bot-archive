import { createHash } from "node:crypto";
import { Bot, type Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import { config, THEMES, TG_FILE_LIMIT, TYPES } from "./config.js";
import { db, findByTextHash, getSetting, insertItem, setSetting, type Item } from "./db.js";
import { acceptedText, duplicateText, esc, listLine, plural } from "./format.js";
import { fetchTikTok } from "./fetchers.js";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function classifyUrl(url: string): { input_kind: string; origin: string } {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/(^|\.)tiktok\.com$/.test(host)) return { input_kind: "tiktok", origin: "tiktok" };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { input_kind: "link", origin: "youtube" };
  if (/(^|\.)instagram\.com$/.test(host)) return { input_kind: "link", origin: "instagram" };
  return { input_kind: "link", origin: "other" };
}

const TRACKING = /^(utm_\w+|si|_t|_r|igsh|igshid|is_from_webapp|sender_device|share_\w+|fbclid)$/;

// sha256 of a normalized url (tracking params dropped) or text — for exact dedup.
function textHash(s: string, isUrl: boolean) {
  let norm = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (isUrl) {
    const u = new URL(s.trim());
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    norm = u.toString().replace(/\/$/, "");
  }
  return createHash("sha256").update(norm).digest("hex");
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
  await insertItem({ ...row, reply_message_id: reply.message_id, status: "queued" } as Partial<Item>);
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

  bot.command("start", (ctx) =>
    ctx.reply("Кидай ссылки, скрины, голосовые, текст — разберу и сохраню.\n/recent · /theme &lt;тема&gt; · /type &lt;тип&gt;", html));

  bot.command("recent", async (ctx) => {
    const { data } = await db.from("items").select().in("status", ["ok", "pending_media"]).order("id", { ascending: false }).limit(10);
    await ctx.reply(data?.length ? (data as Item[]).map(listLine).join("\n") : "пока пусто", html);
  });

  bot.command("theme", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const theme = q && THEMES.find((t) => t.startsWith(q)) || THEMES.find((t) => q && t.includes(q));
    if (!theme) return ctx.reply(`Темы:\n${THEMES.map((t) => `• ${t}`).join("\n")}`);
    const { data } = await db.from("items").select().eq("theme", theme).in("status", ["ok", "pending_media"]).order("id", { ascending: false }).limit(20);
    await ctx.reply(`<b>${esc(theme)}</b>\n${(data as Item[] ?? []).map(listLine).join("\n") || "пусто"}`, html);
  });

  bot.command("type", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const type = Object.keys(TYPES).find((k) => q && (k.startsWith(q) || TYPES[k].ru.startsWith(q)));
    if (!type) return ctx.reply(`Типы: ${Object.entries(TYPES).map(([k, v]) => `${k} (${v.ru})`).join(", ")}`);
    const { data } = await db.from("items").select().eq("content_type", type).in("status", ["ok", "pending_media"]).order("id", { ascending: false }).limit(20);
    await ctx.reply(`<b>${TYPES[type].emoji} ${TYPES[type].ru}</b>\n${(data as Item[] ?? []).map(listLine).join("\n") || "пусто"}`, html);
  });

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
      return accept(ctx, { ...baseRow(m), input_kind: file.input_kind, tg_file_id: file.file_id, input: { file_id: file.file_id, mime: file.mime, file_size: file.file_size, text: m.caption } });
    }

    const text = m.text ?? m.caption;
    if (!text) return;
    const urls = extractUrls(text, m.entities ?? m.caption_entities);
    const dupReply = (d: Item) => ctx.reply(duplicateText(d), { ...html, reply_parameters: { message_id: m.message_id } });

    if (!urls.length) {
      const hash = textHash(text, false);
      const dup = await findByTextHash(hash);
      if (dup) return dupReply(dup);
      return accept(ctx, { ...baseRow(m), input_kind: m.forward_origin ? "forwarded" : "text", text_hash: hash, input: { text } });
    }

    for (const url of urls) {
      const hash = textHash(url, true);
      const dup = await findByTextHash(hash);
      if (dup) {
        await dupReply(dup);
        continue;
      }
      await accept(ctx, { ...baseRow(m), ...classifyUrl(url), source_url: url, text_hash: hash, input: { text } });
    }
  });

  bot.catch((err) => console.error("bot error", err.error));
  return bot;
}
