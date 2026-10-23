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

function link(channelId: number, messageId: number) {
  return `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${messageId}`;
}

// Original is already in Telegram — copy it to the channel.
export async function archiveCopy(api: Api, chatId: number, messageId: number): Promise<string | undefined> {
  const ch = await archiveChannel();
  if (!ch) return;
  const m = await api.copyMessage(ch, chatId, messageId);
  return link(ch, m.message_id);
}

// Downloaded media (TikTok etc.) — upload to the channel, return file_ids + link.
export async function archiveUpload(
  api: Api,
  media: { video?: Media; images?: Media[] },
  caption: string,
): Promise<{ fileIds: string[]; link?: string }> {
  const ch = await archiveChannel();
  if (!ch) return { fileIds: [] };
  caption = caption.slice(0, 1000);

  if (media.video && media.video.buf.length < BOT_UPLOAD_LIMIT) {
    const m = await api.sendVideo(ch, new InputFile(media.video.buf, "video.mp4"), { caption, supports_streaming: true });
    return { fileIds: [m.video.file_id], link: link(ch, m.message_id) };
  }
  if (media.images?.length) {
    const fileIds: string[] = [];
    let first: number | undefined;
    for (let i = 0; i < media.images.length; i += 10) {
      const group = media.images.slice(i, i + 10).map((img, j) => ({
        type: "photo" as const,
        media: new InputFile(img.buf, `${i + j}.jpg`),
        ...(i + j === 0 ? { caption } : {}),
      }));
      const msgs = await api.sendMediaGroup(ch, group);
      first ??= msgs[0].message_id;
      for (const m of msgs) if ("photo" in m && m.photo) fileIds.push(m.photo[m.photo.length - 1].file_id);
    }
    return { fileIds, link: first ? link(ch, first) : undefined };
  }
  return { fileIds: [] };
}
