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
export function resultLine(it: Pick<Item, "content_type" | "title" | "structured" | "theme"> & { project?: string[] | null }) {
  const t = TYPES[it.content_type ?? "other"] ?? TYPES.other;
  const parts = [`${t.emoji} ${t.ru}`, it.title ?? ""];
  const s = it.structured ?? {};
  if (s.points?.length) parts.push(plural(s.points.length, "пункт", "пункта", "пунктов"));
  if (s.steps?.length) parts.push(plural(s.steps.length, "шаг", "шага", "шагов"));
  for (const l of s.lists ?? []) parts.push(`${l.title.toLowerCase()}: ${l.items.length}`);
  parts.push(it.theme ?? "разное");
  const projects = (it.project ?? []).filter((p) => p !== "разное");
  if (projects.length) parts.push(`→ ${projects.join(", ")}`);
  return parts.filter(Boolean).join(" · ");
}

// Short by design (SPEC §3): the bot is a store, not a chat partner.
export function resultMessage(it: Item) {
  let msg = esc(resultLine(it));
  if (it.archive_link) msg += ` · <a href="${it.archive_link}">🗄 в архиве</a>`;
  if (it.status === "pending_media") msg += `\n⏳ видео не скачалось — сохранил ссылку и подпись, повторю через сутки`;
  return msg;
}

// times = how many times it has been sent in total (first save included).
export function duplicateText(it: Pick<Item, "title" | "summary" | "created_at"> & { archive_link?: string | null }, times?: number) {
  const date = new Date(it.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const link = it.archive_link ? ` · <a href="${it.archive_link}">🗄 в архиве</a>` : "";
  const nth = times && times > 2 ? ` · присылаешь уже ${times}-й раз` : "";
  return `♻️ <b>повтор</b> — уже сохранено ${date}${nth}\n${esc(it.title ?? it.summary ?? "ещё разбирается…")}${link}`;
}

// Human-readable cause of a failed item (raw text stays in items.error and the Terminal log).
export function errorReason(error?: string | null): string {
  const e = error ?? "";
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(e)) return "Gemini перегружен";
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(e)) return "лимит запросов Gemini";
  if (/API key|PERMISSION_DENIED|401|403/i.test(e)) return "ключ Gemini не подходит";
  if (/chat not found|not enough rights|CHAT_ADMIN_REQUIRED/i.test(e)) return "канал-архив недоступен";
  if (/JSON|empty summary/i.test(e)) return "модель вернула непонятный ответ";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(e)) return "нет связи";
  return e ? `ошибка: ${e.slice(0, 80)}` : "неизвестная ошибка";
}

export function failedText(it: Pick<Item, "error">) {
  return `⚠️ не получилось разобрать — ${esc(errorReason(it.error))}\nссылка сохранена · нажми 🔁 или /retry`;
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
  for (const i of ok) msg += `\n${esc(resultLine(i))}${i.archive_link ? ` · <a href="${i.archive_link}">🗄</a>` : ""}`;
  const reasons = [...new Set(items.filter((i) => i.status === "failed").map((i) => errorReason(i.error)))];
  if (reasons.length) msg += `\n⚠️ не разобрал: ${esc(reasons.join(", "))} · /retry`;
  return msg;
}
