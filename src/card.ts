import { InlineKeyboard, InputFile, type Bot } from "grammy";
import { db, updateItem, type Item, type Similar, type Structured } from "./db.js";
import { esc, resultMessage } from "./format.js";
import { translateCard } from "./gemini.js";

// Card on a saved item: one line in chat; "Подробнее" / "Транскрипт" / "EN" buttons open the rest in place.
type Mode = "short" | "full" | "en";

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

function keyboard(it: Item, mode: Mode) {
  const kb = new InlineKeyboard();
  kb.text(mode === "short" ? "📖 Подробнее" : "🔼 Свернуть", mode === "short" ? `x:${it.id}` : `c:${it.id}`);
  if (it.raw_text) kb.text("📜 Транскрипт", `tr:${it.id}`);
  kb.text(mode === "en" ? "🇷🇺 RU" : "🇬🇧 EN", mode === "en" ? `x:${it.id}` : `en:${it.id}`);
  if (it.status === "pending_media") kb.row().text("🔁 Повторить", `retry:${it.id}`);
  return kb;
}

export function renderCard(it: Item, mode: Mode): { text: string; kb: InlineKeyboard } {
  const similar = similarLine(it.raw_meta?.similar);
  const short = resultMessage(it) + similar;
  let text = short;
  if (mode === "full") {
    const tags = it.tags?.length ? `\n\n${it.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ")}` : "";
    text = `<b>${resultMessage(it)}</b>${similar}\n\n${esc(it.summary ?? "")}${details(it.structured, false)}${tags}`;
  } else if (mode === "en" && it.raw_meta?.en) {
    const en = it.raw_meta.en;
    text = `<b>🇬🇧 ${esc(en.title)}</b>\n\n${esc(en.summary)}${details(en.structured, true)}`;
  }
  // Telegram limit is 4096; long lists fall back to the short card + a hint.
  if (text.length > 4000) text = `${short}\n\n${esc(cut(it.summary ?? "", 1500))}\n\n<i>(всё целиком — в «Транскрипт»)</i>`;
  return { text, kb: keyboard(it, mode) };
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

  bot.callbackQuery(/^en:(\d+)$/, async (ctx) => {
    const it = await getItem(Number(ctx.match[1]));
    if (!it) return ctx.answerCallbackQuery("запись не найдена");
    if (!it.raw_meta?.en) {
      await ctx.answerCallbackQuery("перевожу…");
      const en = await translateCard({ title: it.title ?? "", summary: it.summary ?? "", structured: it.structured ?? {} });
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
