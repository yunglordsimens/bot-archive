import { InputFile, type Api } from "grammy";
import { config } from "./config.js";
import { getSetting } from "./db.js";
import type { Media } from "./fetchers.js";

const BOT_UPLOAD_LIMIT = 50 * 1024 * 1024;

// Channel the bot detected itself (made admin) wins over ARCHIVE_CHANNEL_ID from .env.
export async function archiveChannel(): Promise<number | undefined> {
  const v = await getSetting("archive_channel_id");
  return v ? Number(v) : config.archiveChannelId;
}

// Is the archive channel usable? Used at startup and in the status screen.
export async function archiveState(api: Api, botId: number): Promise<{ ok: boolean; title?: string; problem?: string }> {
  const ch = await archiveChannel();
  if (!ch) return { ok: false, problem: "не подключён: добавь бота админом в приватный канал" };
  try {
    const me = await api.getChatMember(ch, botId);
    if (me.status !== "administrator" || !me.can_post_messages) return { ok: false, problem: "— бот там не админ или не может публиковать" };
    const chat = await api.getChat(ch);
    return { ok: true, title: "title" in chat ? chat.title : String(ch) };
  } catch {
    return { ok: false, problem: "недоступен — удали бота из админов канала и добавь заново" };
  }
}

export function link(channelId: number, messageId: number) {
  return `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${messageId}`;
}

// Downloaded media (TikTok etc.) — upload to the channel, return file_ids + link.
export async function archiveUpload(
  api: Api,
  media: { video?: Media; images?: Media[] },
  caption: string,
): Promise<{ fileIds: string[]; link?: string }> {
  const ch = await archiveChannel();
  if (!ch) return { fileIds: [] };

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
