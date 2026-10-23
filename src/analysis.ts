import type { Api } from "grammy";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import type { Item } from "./db.js";
import { analyzeFormat, embed, mediaPart, textPart, urlPart } from "./gemini.js";
import { fetchTikTok, fetchVideoGeneric, type Fetched } from "./fetchers.js";
import { parseHints, type Hints } from "./hints.js";

// Shared by the worker, /reprocess and card buttons: Telegram downloads, context for Gemini, deep format analysis.

export async function tgDownload(api: Api, fileId: string): Promise<Buffer> {
  const f = await api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
  if (!res.ok) throw new Error(`tg file HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function hintLine(h: Hints) {
  const parts = [h.value_in.length && `ценность: ${h.value_in.join(", ")}`, h.stance && `отношение: ${h.stance}`, h.deepFormat && "важен формат"].filter(Boolean);
  return parts.length ? parts.join("; ") : undefined;
}

export function contextText(it: Item, extra: Record<string, string | undefined> = {}) {
  const lines = Object.entries({
    "Источник": it.origin && it.origin !== "telegram" ? it.origin : it.input_kind,
    "Ссылка": it.source_url ?? undefined,
    "Комментарий пользователя": it.input.text && it.source_url ? it.input.text : undefined,
    "Переслано от": it.origin_detail ?? undefined,
    "Подсказка пользователя (главнее твоей догадки)": hintLine(parseHints(it.input?.text)),
    ...extra,
  }).filter(([, v]) => v);
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function mimeOf(it: Item, index: number): string {
  if (it.input_kind === "tiktok" || it.input_kind === "link") {
    return /images|gallery/.test(it.raw_meta?.via ?? "") || it.archive_file_ids.length > 1 ? "image/jpeg" : "video/mp4";
  }
  return index === 0 && it.input?.mime ? it.input.mime : "application/octet-stream";
}

// Media from the archive channel (by file_id); if Telegram won't give it (>20 MB), download from the source again.
export async function originalMedia(api: Api, it: Item, log: string[]): Promise<Part[]> {
  if (it.origin === "youtube" && it.source_url) return [urlPart(it.source_url)];
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

// Deep format analysis (SPEC §3.9) + hook_embedding — groups videos by the trick, not by topic.
export async function addFormatAnalysis(it: Item, media: Part[], patch: Record<string, unknown>) {
  const full = { ...it, ...patch } as Item;
  const hook = await analyzeFormat([textPart(contextText(full, {
    "Суть": full.summary ?? undefined, "Что в кадре": full.visual_description ?? undefined, "Своя заметка пользователя (важнее всего)": full.my_note ?? undefined,
  })), ...media]);
  patch.hook = hook;
  const key = [full.my_note, hook.looks_accidental, hook.probably_deliberate, hook.how_hidden, hook.mismatch, hook.reusable_move].filter(Boolean).join("\n");
  patch.hook_embedding = JSON.stringify(await embed(key));
}

