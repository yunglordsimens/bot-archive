import { TYPE_EMOJI } from "./config.js";
import type { Item } from "./db.js";
import { fmtDate, plural, type Dict } from "./i18n/index.js";

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export const typeLabel = (d: Dict, type?: string | null) => {
  const k = (type && type in d.types ? type : "other") as keyof Dict["types"];
  return `${TYPE_EMOJI[k]} ${d.types[k]}`;
};

export function sourceLabel(d: Dict, inputKind: string, origin?: string | null) {
  const key = inputKind === "link" && origin && origin !== "other" ? origin : inputKind;
  return d.sources[key] ?? "📥";
}

export const acceptedText = (d: Dict, inputKind: string, origin?: string | null) => `${sourceLabel(d, inputKind, origin)} · ${d.accepted}`;

// "💡 совет · как назначать цену · 5 пунктов · деньги и бизнес-идеи · → OFST"
export function resultLine(d: Dict, it: Pick<Item, "content_type" | "title" | "structured" | "theme"> & { project?: string[] | null }, misc?: string) {
  const parts = [typeLabel(d, it.content_type), it.title ?? ""];
  const s = it.structured ?? {};
  if (s.points?.length) parts.push(plural(d, s.points.length, d.forms.points));
  if (s.steps?.length) parts.push(plural(d, s.steps.length, d.forms.steps));
  for (const l of s.lists ?? []) parts.push(`${l.title.toLowerCase()}: ${l.items.length}`);
  if (it.theme) parts.push(it.theme);
  const projects = (it.project ?? []).filter((p) => p !== misc);
  if (projects.length) parts.push(`→ ${projects.join(", ")}`);
  return parts.filter(Boolean).join(" · ");
}

// Short by design (SPEC §3): the bot is a store, not a chat partner.
export function resultMessage(d: Dict, it: Item, misc?: string) {
  let msg = esc(resultLine(d, it, misc));
  if (it.archive_link) msg += ` · <a href="${it.archive_link}">${d.inArchive}</a>`;
  if (it.status === "pending_media") msg += `\n${d.pendingNote}`;
  return msg;
}

// times = how many times it has been sent in total (first save included).
export function duplicateText(d: Dict, it: Pick<Item, "title" | "summary" | "created_at"> & { archive_link?: string | null }, times?: number) {
  const link = it.archive_link ? ` · <a href="${it.archive_link}">${d.inArchive}</a>` : "";
  return `${d.dup(fmtDate(d, it.created_at), times)}\n${esc(it.title ?? it.summary ?? d.stillProcessing)}${link}`;
}

// Human-readable cause of a failed item (raw text stays in items.error and the Terminal log).
export function errorReason(d: Dict, error?: string | null): string {
  const e = error ?? "";
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(e)) return d.errors.overloaded;
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(e)) return d.errors.quota;
  if (/API key|PERMISSION_DENIED|401|403/i.test(e)) return d.errors.key;
  if (/chat not found|not enough rights|CHAT_ADMIN_REQUIRED/i.test(e)) return d.errors.channel;
  if (/JSON|empty summary/i.test(e)) return d.errors.json;
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(e)) return d.errors.network;
  return e ? d.errors.other(e.slice(0, 80)) : d.errors.unknown;
}

export const failedText = (d: Dict, it: Pick<Item, "error">) => d.failed(esc(errorReason(d, it.error)));

export function listLine(d: Dict, it: Item) {
  const href = it.source_url ?? it.archive_link;
  const title = esc(it.title ?? "—");
  return `${TYPE_EMOJI[it.content_type ?? "other"] ?? TYPE_EMOJI.other} ${href ? `<a href="${href}">${title}</a>` : title} · <i>${esc(it.theme ?? "")}</i>`;
}

export function batchMessage(d: Dict, items: Item[], misc?: string) {
  const ok = items.filter((i) => i.status === "ok");
  const dup = items.filter((i) => i.status === "duplicate").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const kinds = new Map<string, number>();
  for (const i of ok) kinds.set(i.kind ?? "—", (kinds.get(i.kind ?? "—") ?? 0) + 1);
  const parts = [plural(d, items.length, d.forms.screens)];
  if (kinds.size) parts.push([...kinds].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", "));
  if (dup) parts.push(d.batch.already(dup));
  if (failed) parts.push(d.batch.notParsed(failed));
  parts.push(d.batch.saved);
  let msg = `<b>${esc(parts.join(" · "))}</b>`;
  for (const i of ok) msg += `\n${esc(resultLine(d, i, misc))}${i.archive_link ? ` · <a href="${i.archive_link}">🗄</a>` : ""}`;
  const reasons = [...new Set(items.filter((i) => i.status === "failed").map((i) => errorReason(d, i.error)))];
  if (reasons.length) msg += `\n${d.batch.failedList(esc(reasons.join(", ")))}`;
  return msg;
}
