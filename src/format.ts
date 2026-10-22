import { SOURCE_LABEL, TYPES } from "./config.js";
import type { Item } from "./db.js";

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function acceptedText(sourceType: string) {
  return `${SOURCE_LABEL[sourceType] ?? "📥"} · принято`;
}

// "💡 совет · как назначать цену · 5 пунктов · деньги и бизнес-идеи"
export function resultLine(it: Pick<Item, "content_type" | "title" | "structured" | "theme">) {
  const t = TYPES[it.content_type ?? "other"] ?? TYPES.other;
  const parts = [`${t.emoji} ${t.ru}`, it.title ?? ""];
  const s = it.structured ?? {};
  if (s.points?.length) parts.push(plural(s.points.length, "пункт", "пункта", "пунктов"));
  if (s.steps?.length) parts.push(plural(s.steps.length, "шаг", "шага", "шагов"));
  parts.push(it.theme ?? "разное");
  return parts.filter(Boolean).join(" · ");
}

export function resultMessage(it: Item) {
  let msg = `<b>${esc(resultLine(it))}</b>\n${esc(it.summary ?? "")}`;
  if (it.status === "pending_media") msg += `\n\n⏳ видео не скачалось — сохранил ссылку и подпись, повторю через сутки`;
  if (it.archive_link) msg += `\n<a href="${it.archive_link}">оригинал</a>`;
  return msg;
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
