import { SOURCE_LABEL, TYPES } from "./config.js";
import type { Item } from "./db.js";

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function sourceLabel(inputKind: string, origin?: string | null) {
  const key = inputKind === "link" && origin && origin !== "other" ? origin : inputKind;
  return SOURCE_LABEL[key] ?? "📥";
}

export function acceptedText(inputKind: string, origin?: string | null) {
  return `${sourceLabel(inputKind, origin)} · принято`;
}

// "💡 совет · как назначать цену · 5 пунктов · деньги и бизнес-идеи"
export function resultLine(it: Pick<Item, "content_type" | "title" | "structured" | "theme">) {
  const t = TYPES[it.content_type ?? "other"] ?? TYPES.other;
  const parts = [`${t.emoji} ${t.ru}`, it.title ?? ""];
  const s = it.structured ?? {};
  if (s.points?.length) parts.push(plural(s.points.length, "пункт", "пункта", "пунктов"));
  if (s.steps?.length) parts.push(plural(s.steps.length, "шаг", "шага", "шагов"));
  for (const l of s.lists ?? []) parts.push(`${l.title.toLowerCase()}: ${l.items.length}`);
  parts.push(it.theme ?? "разное");
  return parts.filter(Boolean).join(" · ");
}

// Short by design (SPEC §3): the bot is a store, not a chat partner.
export function resultMessage(it: Item) {
  let msg = esc(resultLine(it));
  if (it.archive_link) msg += ` · <a href="${it.archive_link}">оригинал</a>`;
  if (it.status === "pending_media") msg += `\n⏳ видео не скачалось — сохранил ссылку и подпись, повторю через сутки`;
  return msg;
}

// times = how many times it has been sent in total (first save included).
export function duplicateText(it: Pick<Item, "title" | "summary" | "created_at"> & { archive_link?: string | null }, times?: number) {
  const date = new Date(it.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const link = it.archive_link ? ` · <a href="${it.archive_link}">оригинал</a>` : "";
  const nth = times && times > 2 ? ` · присылаешь уже ${times}-й раз` : "";
  return `♻️ <b>повтор</b> — уже сохранено ${date}${nth}\n${esc(it.title ?? it.summary ?? "ещё разбирается…")}${link}`;
}

export function listLine(it: Item) {
  const t = TYPES[it.content_type ?? "other"] ?? TYPES.other;
  const href = it.source_url ?? it.archive_link;
  const title = esc(it.title ?? "без названия");
  return `${t.emoji} ${href ? `<a href="${href}">${title}</a>` : title} · <i>${esc(it.theme ?? "")}</i>`;
}

export function batchMessage(items: Item[]) {
  const ok = items.filter((i) => i.status === "ok");
  const dup = items.filter((i) => i.status === "duplicate").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const kinds = new Map<string, number>();
  for (const i of ok) kinds.set(i.kind ?? "другое", (kinds.get(i.kind ?? "другое") ?? 0) + 1);
  const parts = [plural(items.length, "скрин", "скрина", "скринов")];
  if (kinds.size) parts.push([...kinds].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", "));
  if (dup) parts.push(`${dup} уже были`);
  if (failed) parts.push(`${failed} не разобрал`);
  parts.push("сохранено");
  let msg = `<b>${esc(parts.join(" · "))}</b>`;
  for (const i of ok) msg += `\n${esc(resultLine(i))}`;
  return msg;
}
