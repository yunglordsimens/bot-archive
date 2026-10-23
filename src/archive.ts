import { InputFile, type Api } from "grammy";
import { config } from "./config.js";
import { tr } from "./i18n/index.js";
import type { User } from "./users.js";
import type { Media } from "./fetchers.js";

const BOT_UPLOAD_LIMIT = 50 * 1024 * 1024;

// The user's own archive channel (set when they make the bot admin there). The owner may also set ARCHIVE_CHANNEL_ID.
export function archiveChannel(u: User): number | undefined {
  return u.archive_channel_id ?? (u.telegram_user_id === config.ownerId ? config.archiveChannelId : undefined);
}

// Is the archive channel usable? Used at startup and in the status screen.
export async function archiveState(api: Api, botId: number, u: User): Promise<{ ok: boolean; title?: string; problem?: string }> {
  const d = tr(u.lang);
  const ch = archiveChannel(u);
  if (!ch) return { ok: false, problem: d.channel.notConnected };
  try {
    const me = await api.getChatMember(ch, botId);
    if (me.status !== "administrator" || !me.can_post_messages) return { ok: false, problem: d.channel.notAdmin };
    const chat = await api.getChat(ch);
    return { ok: true, title: "title" in chat ? chat.title : String(ch) };
  } catch {
    return { ok: false, problem: d.channel.unavailable };
  }
}

export function link(channelId: number, messageId: number) {
  return `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${messageId}`;
}

// Downloaded media (TikTok etc.) — upload to the channel, return file_ids + link.
export async function archiveUpload(
  api: Api,
  ch: number,
  media: { video?: Media; images?: Media[] },
  caption: string,
): Promise<{ fileIds: string[]; link?: string }> {
  if (media.video && media.video.buf.length < BOT_UPLOAD_LIMIT) {
    const m = await api.sendVideo(ch, new InputFile(media.video.buf, "video.mp4"), { caption, parse_mode: "HTML", supports_streaming: true });
    return { fileIds: [m.video.file_id], link: link(ch, m.message_id) };
  }
  if (media.images?.length) {
    const fileIds: string[] = [];
    let first: number | undefined;
    for (let i = 0; i < media.images.length; i += 10) {
      const group = media.images.slice(i, i + 10).map((img, j) => ({
        type: "photo" as const,
        media: new InputFile(img.buf, `${i + j}.jpg`),
        ...(i + j === 0 ? { caption, parse_mode: "HTML" as const } : {}),
      }));
      const msgs = await api.sendMediaGroup(ch, group);
      first ??= msgs[0].message_id;
      for (const m of msgs) if ("photo" in m && m.photo) fileIds.push(m.photo[m.photo.length - 1].file_id);
    }
    return { fileIds, link: first ? link(ch, first) : undefined };
  }
  return { fileIds: [] };
}
