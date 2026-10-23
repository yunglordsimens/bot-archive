import { InlineKeyboard, InputFile, type Api, type Bot } from "grammy";
import { db, updateItem, type Hook, type Item, type Similar, type Structured } from "./db.js";
import { STANCE_LABEL, VALUE_LABEL } from "./config.js";
import { STANCES, VALUE_IN } from "./hints.js";
import { addFormatAnalysis, originalMedia } from "./analysis.js";
import { esc, resultMessage } from "./format.js";
import { translateCard } from "./gemini.js";

// Card on a saved item: one line in chat; "Подробнее" / "Транскрипт" / "EN" buttons open the rest in place.
type Mode = "short" | "full" | "en" | "edit" | "format";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const TRANSCRIPT_INLINE_MAX = 3500;
const MAX_ITEMS = 30;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function similarLine(s?: Similar) {
  if (!s) return "";
  return `\n≈ похоже на: ${esc(cut(s.summary ?? s.title ?? "", 100))}, ${date(s.created_at)}`;
}

function section(title: string, items: string[] | undefined, numbered = false) {
  if (!items?.length) return "";
  const lines = items.slice(0, MAX_ITEMS).map((x, i) => `${numbered ? `${i + 1}.` : "•"} ${esc(cut(x, 200))}`);
  if (items.length > MAX_ITEMS) lines.push(`… ещё ${items.length - MAX_ITEMS}`);
  return `\n\n<b>${esc(title)}</b>\n${lines.join("\n")}`;
}

function details(s: Structured | null | undefined, en: boolean) {
  s ??= {};
  return section(en ? "Key points" : "Пункты", s.points)
    + section(en ? "Ingredients" : "Ингредиенты", s.ingredients)
    + section(en ? "Steps" : "Шаги", s.steps, true)
    + (s.lists ?? []).map((l) => section(l.title, l.items)).join("");
}

// Inputs that have a picture/video to look at for the format analysis.
const hasVisual = (it: Item) => ["tiktok", "video", "video_note", "screenshot", "profile"].includes(it.input_kind) || ["youtube", "instagram"].includes(it.origin ?? "");

const HOOK_LABELS: [keyof Hook, string][] = [
  ["first_seconds", "Первые секунды"], ["looks_accidental", "Выглядит случайным"], ["probably_deliberate", "Скорее всего, задумано"],
  ["how_hidden", "Как спрятано"], ["mismatch", "Что не вяжется"], ["visual", "Картинка"], ["audio", "Звук"], ["text_on_screen", "Текст на экране"],
  ["emotion", "Реакция"], ["format", "Формат"], ["edit", "Монтаж"], ["why_it_works", "Почему работает"], ["reusable_move", "Приём для себя"],
];

function formatView(it: Item) {
  const h = it.hook!;
  const lines = HOOK_LABELS.filter(([k]) => h[k]).map(([k, label]) => `<b>${label}:</b> ${esc(cut(h[k], 400))}`);
  return `🎬 <b>Разбор формата</b> · ${esc(it.title ?? "")}\n\n${lines.join("\n\n")}`;
}

function editView(it: Item) {
  return `✏️ <b>Поправить</b> · ${esc(it.title ?? "")}\nОтношение: ${STANCE_LABEL[it.stance ?? ""] ?? "—"}\nЦенность: ${(it.value_in ?? []).map((v) => VALUE_LABEL[v]).join(", ") || "—"}`;
}

function editKeyboard(it: Item) {
  const kb = new InlineKeyboard();
  STANCES.forEach((s, i) => {
    kb.text(`${it.stance === s ? "● " : ""}${STANCE_LABEL[s]}`, `sv:${it.id}:${s}`);
    if (i % 2) kb.row();
  });
  kb.row();
  VALUE_IN.forEach((v) => kb.text(`${it.value_in?.includes(v) ? "✓ " : ""}${VALUE_LABEL[v]}`, `vt:${it.id}:${v}`));
  return kb.row().text("← Назад", `c:${it.id}`);
}

function keyboard(it: Item, mode: Mode) {
  if (mode === "edit") return editKeyboard(it);
  if (mode === "format") return new InlineKeyboard().text("← Назад", `c:${it.id}`);
  const kb = new InlineKeyboard();
  kb.text(mode === "short" ? "📖 Подробнее" : "🔼 Свернуть", mode === "short" ? `x:${it.id}` : `c:${it.id}`);
  if (it.raw_text) kb.text("📜 Транскрипт", `tr:${it.id}`);
  kb.text(mode === "en" ? "🇷🇺 RU" : "🇬🇧 EN", mode === "en" ? `x:${it.id}` : `en:${it.id}`);
  kb.row().text("✏️ Поправить", `ed:${it.id}`);
  if (it.hook) kb.text("🎬 Формат", `fv:${it.id}`);
  else if (hasVisual(it)) kb.text("🎬 Разобрать формат", `fa:${it.id}`);
  if (it.status === "pending_media") kb.row().text("🔁 Повторить", `retry:${it.id}`);
  return kb;
}

export function renderCard(it: Item, mode: Mode): { text: string; kb: InlineKeyboard } {
  const stance = it.stance && STANCE_LABEL[it.stance] ? ` · ${STANCE_LABEL[it.stance].split(" ")[0]}` : "";
  const comments = it.comments_note ? `\n💬 В комментах: ${esc(cut(it.comments_note, 300))}` : "";
  const similar = similarLine(it.raw_meta?.similar) + comments;
  const short = resultMessage(it) + stance + similar;
  let text = short;
  if (mode === "edit") text = editView(it);
  else if (mode === "format" && it.hook) text = formatView(it);
  else if (mode === "full") {
    const tags = it.tags?.length ? `\n\n${it.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ")}` : "";
    const why = it.why_me ? `\n\n💭 <b>Зачем мне:</b> ${esc(it.why_me)}` : "";
    const visual = it.visual_description ? `\n\n🎞 <b>В кадре:</b> ${esc(cut(it.visual_description, 600))}` : "";
    const rel = [it.stance && STANCE_LABEL[it.stance], ...(it.value_in ?? []).map((v) => VALUE_LABEL[v])].filter(Boolean).join(" · ");
    const move = it.hook?.reusable_move ? `\n\n🎬 <b>Приём:</b> ${esc(cut(it.hook.reusable_move, 300))}` : "";
    text = `<b>${resultMessage(it)}</b>${similar}\n\n${esc(it.summary ?? "")}${why}${visual}${move}${details(it.structured, false)}${rel ? `\n\n${rel}` : ""}${tags}`;
  } else if (mode === "en" && it.raw_meta?.en) {
    const en = it.raw_meta.en;
    const why = en.why_me ? `\n\n💭 <b>Why me:</b> ${esc(en.why_me)}` : "";
    text = `<b>🇬🇧 ${esc(en.title)}</b>\n\n${esc(en.summary)}${why}${details(en.structured, true)}`;
  }
  // Telegram limit is 4096; long lists fall back to the short card + a hint.
  if (text.length > 4000) text = `${short}\n\n${esc(cut(it.summary ?? "", 1500))}\n\n<i>(всё целиком — в «Транскрипт»)</i>`;
  return { text, kb: keyboard(it, mode) };
}

// Format analysis by button: original from the archive channel (or the source), runs in the background.
async function formatInBackground(api: Api, it: Item, chatId: number, messageId: number) {
  try {
    const media = await originalMedia(api, it, []);
    if (!media.length) throw new Error("видео недоступно");
    const patch: Record<string, unknown> = {};
    await addFormatAnalysis(it, media, patch);
    await updateItem(it.id, patch);
    const c = renderCard({ ...it, ...patch } as Item, "format");
    await api.editMessageText(chatId, messageId, c.text, { ...html, reply_markup: c.kb });
  } catch (e) {
    console.warn(`format analysis ${it.id} failed`, e);
    await api.sendMessage(chatId, `⚠️ не получилось разобрать формат: ${(e as Error).message?.slice(0, 120)}`, { reply_parameters: { message_id: messageId } }).catch(() => {});
  }
}

async function getItem(id: number) {
  const { data } = await db.from("items").select().eq("id", id).single();
  return data as Item | null;
}

export function registerCard(bot: Bot) {
  const show = (mode: Mode) => async (ctx: any) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    await ctx.answerCallbackQuery();
    const c = renderCard(it, mode);
    await ctx.editMessageText(c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  };
  bot.callbackQuery(/^x:(\d+)$/, show("full"));
  bot.callbackQuery(/^c:(\d+)$/, show("short"));
  bot.callbackQuery(/^ed:(\d+)$/, show("edit"));
  bot.callbackQuery(/^fv:(\d+)$/, show("format"));

  // Optional corrections: stance (one) and value_in (toggles). The model only guesses.
  bot.callbackQuery(/^sv:(\d+):(\w+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    it.stance = ctx.match[2];
    await updateItem(it.id, { stance: it.stance });
    await ctx.answerCallbackQuery("сохранено");
    const c = renderCard(it, "edit");
    await ctx.editMessageText(c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  });
  bot.callbackQuery(/^vt:(\d+):(\w+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    const v = ctx.match[2];
    it.value_in = it.value_in?.includes(v) ? it.value_in.filter((x) => x !== v) : [...(it.value_in ?? []), v];
    await updateItem(it.id, { value_in: it.value_in });
    await ctx.answerCallbackQuery("сохранено");
    const c = renderCard(it, "edit");
    await ctx.editMessageText(c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  });

  bot.callbackQuery(/^fa:(\d+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    await ctx.answerCallbackQuery("разбираю формат… это ~минута");
    const msg = ctx.callbackQuery.message!;
    void formatInBackground(ctx.api, it, msg.chat.id, msg.message_id);
  });

  bot.callbackQuery(/^en:(\d+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    if (!it.raw_meta?.en) {
      await ctx.answerCallbackQuery("перевожу…");
      const en = await translateCard({ title: it.title ?? "", summary: it.summary ?? "", structured: it.structured ?? {}, why_me: it.why_me ?? undefined });
      it.raw_meta = { ...it.raw_meta, en };
      await updateItem(it.id, { raw_meta: it.raw_meta });
    } else {
      await ctx.answerCallbackQuery();
    }
    const c = renderCard(it, "en");
    await ctx.editMessageText(c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  });

  bot.callbackQuery(/^tr:(\d+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it?.raw_text) return ctx.answerCallbackQuery("транскрипта нет");
    await ctx.answerCallbackQuery();
    const reply = { reply_parameters: { message_id: ctx.callbackQuery.message!.message_id } };
    if (it.raw_text.length <= TRANSCRIPT_INLINE_MAX) {
      await ctx.reply(`📜 Транскрипт\n\n${it.raw_text}`, reply);
    } else {
      const name = `transcript-${it.id}.txt`;
      await ctx.replyWithDocument(new InputFile(Buffer.from(it.raw_text, "utf8"), name), { caption: `📜 ${cut(it.title ?? "Транскрипт", 900)}`, ...reply });
    }
  });
}
