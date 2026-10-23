import { InlineKeyboard, InputFile, type Api, type Bot, type CallbackQueryContext } from "grammy";
import { db, updateItem, type Hook, type Item, type Similar, type Structured } from "./db.js";
import { STANCES, VALUE_IN } from "./hints.js";
import { addFormatAnalysis, originalMedia } from "./analysis.js";
import { esc, resultMessage } from "./format.js";
import { translateCard } from "./gemini.js";
import { DICTS, fmtDate, tr, type Dict } from "./i18n/index.js";
import { miscProject, type Ctx, type User } from "./users.js";

// Card on a saved item: one line in chat; buttons open details, transcript, English, corrections and format analysis in place.
type Mode = "short" | "full" | "en" | "edit" | "format";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const TRANSCRIPT_INLINE_MAX = 3500;
const MAX_ITEMS = 30;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function similarLine(d: Dict, s?: Similar) {
  if (!s) return "";
  return `\n≈ ${d.card.similar}: ${esc(cut(s.summary ?? s.title ?? "", 100))}, ${fmtDate(d, s.created_at)}`;
}

function section(d: Dict, title: string, items: string[] | undefined, numbered = false) {
  if (!items?.length) return "";
  const lines = items.slice(0, MAX_ITEMS).map((x, i) => `${numbered ? `${i + 1}.` : "•"} ${esc(cut(x, 200))}`);
  if (items.length > MAX_ITEMS) lines.push(d.card.moreItems(items.length - MAX_ITEMS));
  return `\n\n<b>${esc(title)}</b>\n${lines.join("\n")}`;
}

function details(d: Dict, s: Structured | null | undefined) {
  s ??= {};
  return section(d, d.card.points, s.points)
    + section(d, d.card.ingredients, s.ingredients)
    + section(d, d.card.steps, s.steps, true)
    + (s.lists ?? []).map((l) => section(d, l.title, l.items)).join("");
}

// Inputs that have a picture/video to look at for the format analysis.
const hasVisual = (it: Item) => ["tiktok", "video", "video_note", "screenshot", "profile"].includes(it.input_kind) || ["youtube", "instagram"].includes(it.origin ?? "");

const HOOK_ORDER: (keyof Hook)[] = [
  "first_seconds", "looks_accidental", "probably_deliberate", "how_hidden", "mismatch", "visual", "audio",
  "text_on_screen", "emotion", "format", "edit", "why_it_works", "reusable_move",
];

function formatView(d: Dict, it: Item) {
  const h = it.hook!;
  const lines = HOOK_ORDER.filter((k) => h[k]).map((k) => `<b>${d.card.hook[k]}:</b> ${esc(cut(h[k], 400))}`);
  return `<b>${d.card.formatTitle}</b> · ${esc(it.title ?? "")}\n\n${lines.join("\n\n")}`;
}

function editView(d: Dict, it: Item) {
  return `<b>${d.card.editTitle}</b> · ${esc(it.title ?? "")}\n${d.card.stanceLbl}: ${d.stance[it.stance ?? ""] ?? "—"}\n${d.card.valueLbl}: ${(it.value_in ?? []).map((v) => d.value[v]).join(", ") || "—"}`;
}

function editKeyboard(d: Dict, it: Item) {
  const kb = new InlineKeyboard();
  STANCES.forEach((s, i) => {
    kb.text(`${it.stance === s ? "● " : ""}${d.stance[s]}`, `sv:${it.id}:${s}`);
    if (i % 2) kb.row();
  });
  kb.row();
  VALUE_IN.forEach((v) => kb.text(`${it.value_in?.includes(v) ? "✓ " : ""}${d.value[v]}`, `vt:${it.id}:${v}`));
  return kb.row().text(d.card.back, `c:${it.id}`);
}

function keyboard(d: Dict, it: Item, mode: Mode) {
  if (mode === "edit") return editKeyboard(d, it);
  if (mode === "format") return new InlineKeyboard().text(d.card.back, `c:${it.id}`);
  const kb = new InlineKeyboard();
  kb.text(mode === "short" ? d.card.more : d.card.less, mode === "short" ? `x:${it.id}` : `c:${it.id}`);
  if (it.raw_text) kb.text(d.card.transcript, `tr:${it.id}`);
  // English is the second language for everyone except English users.
  if (d.code !== "en") kb.text(mode === "en" ? `${d.flag} ${d.code.toUpperCase()}` : "🇬🇧 EN", mode === "en" ? `x:${it.id}` : `en:${it.id}`);
  kb.row().text(d.card.edit, `ed:${it.id}`);
  if (it.hook) kb.text(d.card.formatShow, `fv:${it.id}`);
  else if (hasVisual(it)) kb.text(d.card.formatRun, `fa:${it.id}`);
  if (it.status === "pending_media") kb.row().text(d.card.retry, `retry:${it.id}`);
  return kb;
}

export function renderCard(it: Item, mode: Mode, u: User): { text: string; kb: InlineKeyboard } {
  const d = tr(u.lang);
  const misc = miscProject(u);
  const stance = it.stance && d.stance[it.stance] ? ` · ${d.stance[it.stance].split(" ")[0]}` : "";
  const comments = it.comments_note ? `\n💬 ${d.card.comments}: ${esc(cut(it.comments_note, 300))}` : "";
  const similar = similarLine(d, it.raw_meta?.similar) + comments;
  const short = resultMessage(d, it, misc) + stance + similar;
  let text = short;
  if (mode === "edit") text = editView(d, it);
  else if (mode === "format" && it.hook) text = formatView(d, it);
  else if (mode === "full") {
    const tags = it.tags?.length ? `\n\n${it.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ")}` : "";
    const why = it.why_me ? `\n\n💭 <b>${d.card.why}:</b> ${esc(it.why_me)}` : "";
    const visual = it.visual_description ? `\n\n🎞 <b>${d.card.inFrame}:</b> ${esc(cut(it.visual_description, 600))}` : "";
    const rel = [it.stance && d.stance[it.stance], ...(it.value_in ?? []).map((v) => d.value[v])].filter(Boolean).join(" · ");
    const move = it.hook?.reusable_move ? `\n\n🎬 <b>${d.card.move}:</b> ${esc(cut(it.hook.reusable_move, 300))}` : "";
    text = `<b>${resultMessage(d, it, misc)}</b>${similar}\n\n${esc(it.summary ?? "")}${why}${visual}${move}${details(d, it.structured)}${rel ? `\n\n${rel}` : ""}${tags}`;
  } else if (mode === "en" && it.raw_meta?.en) {
    const en = it.raw_meta.en;
    const why = en.why_me ? `\n\n💭 <b>${DICTS.en.card.why}:</b> ${esc(en.why_me)}` : "";
    text = `<b>🇬🇧 ${esc(en.title)}</b>\n\n${esc(en.summary)}${why}${details(DICTS.en, en.structured)}`;
  }
  // Telegram limit is 4096; long lists fall back to the short card + a hint.
  if (text.length > 4000) text = `${short}\n\n${esc(cut(it.summary ?? "", 1500))}\n\n<i>${d.card.tooLong}</i>`;
  return { text, kb: keyboard(d, it, mode) };
}

// Format analysis by button: original from the archive channel (or the source), runs in the background.
async function formatInBackground(api: Api, it: Item, u: User, chatId: number, messageId: number) {
  const d = tr(u.lang);
  try {
    const media = await originalMedia(api, it, []);
    if (!media.length) throw new Error(d.card.videoUnavailable);
    const patch: Record<string, unknown> = {};
    await addFormatAnalysis(it, media, patch, d.geminiLanguage);
    await updateItem(it.id, patch);
    const c = renderCard({ ...it, ...patch } as Item, "format", u);
    await api.editMessageText(chatId, messageId, c.text, { ...html, reply_markup: c.kb });
  } catch (e) {
    console.warn(`format analysis ${it.id} failed`, e);
    await api.sendMessage(chatId, d.card.formatFailed((e as Error).message?.slice(0, 120) ?? ""), { reply_parameters: { message_id: messageId } }).catch(() => {});
  }
}

// Only the owner of an item can open it — ids in buttons are never trusted on their own.
async function getItem(id: number, u: User) {
  const { data } = await db.from("items").select().eq("id", id).eq("user_id", u.id).maybeSingle();
  return data as Item | null;
}

export function registerCard(bot: Bot<Ctx>) {
  const load = async (ctx: CallbackQueryContext<Ctx>) => {
    const it = await getItem(Number(ctx.match[1]), ctx.user);
    if (!it) await ctx.answerCallbackQuery(tr(ctx.user.lang).card.notFound);
    return it;
  };
  const edit = (ctx: Ctx, it: Item, mode: Mode) => {
    const c = renderCard(it, mode, ctx.user);
    return ctx.editMessageText(c.text, { ...html, reply_markup: c.kb }).catch(() => {});
  };
  const show = (mode: Mode) => async (ctx: CallbackQueryContext<Ctx>) => {
    const it = await load(ctx);
    if (!it) return;
    await ctx.answerCallbackQuery();
    await edit(ctx, it, mode);
  };
  bot.callbackQuery(/^x:(\d+)$/, show("full"));
  bot.callbackQuery(/^c:(\d+)$/, show("short"));
  bot.callbackQuery(/^ed:(\d+)$/, show("edit"));
  bot.callbackQuery(/^fv:(\d+)$/, show("format"));

  // Optional corrections: stance (one) and value_in (toggles). The model only guesses.
  bot.callbackQuery(/^sv:(\d+):(\w+)$/, async (ctx) => {
    const it = await load(ctx);
    if (!it || !(STANCES as readonly string[]).includes(ctx.match[2])) return;
    it.stance = ctx.match[2];
    await updateItem(it.id, { stance: it.stance });
    await ctx.answerCallbackQuery(tr(ctx.user.lang).card.saved);
    await edit(ctx, it, "edit");
  });
  bot.callbackQuery(/^vt:(\d+):(\w+)$/, async (ctx) => {
    const it = await load(ctx);
    const v = ctx.match[2];
    if (!it || !(VALUE_IN as readonly string[]).includes(v)) return;
    it.value_in = it.value_in?.includes(v) ? it.value_in.filter((x) => x !== v) : [...(it.value_in ?? []), v];
    await updateItem(it.id, { value_in: it.value_in });
    await ctx.answerCallbackQuery(tr(ctx.user.lang).card.saved);
    await edit(ctx, it, "edit");
  });

  bot.callbackQuery(/^fa:(\d+)$/, async (ctx) => {
    const it = await load(ctx);
    if (!it) return;
    await ctx.answerCallbackQuery(tr(ctx.user.lang).card.formatRunning);
    const msg = ctx.callbackQuery.message!;
    void formatInBackground(ctx.api, it, ctx.user, msg.chat.id, msg.message_id);
  });

  bot.callbackQuery(/^en:(\d+)$/, async (ctx) => {
    const it = await load(ctx);
    if (!it) return;
    if (!it.raw_meta?.en) {
      await ctx.answerCallbackQuery(tr(ctx.user.lang).card.translating);
      const en = await translateCard({ title: it.title ?? "", summary: it.summary ?? "", structured: it.structured ?? {}, why_me: it.why_me ?? undefined });
      it.raw_meta = { ...it.raw_meta, en };
      await updateItem(it.id, { raw_meta: it.raw_meta });
    } else {
      await ctx.answerCallbackQuery();
    }
    await edit(ctx, it, "en");
  });

  bot.callbackQuery(/^tr:(\d+)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    const it = await load(ctx);
    if (!it) return;
    if (!it.raw_text) return ctx.answerCallbackQuery(d.card.noTranscript);
    await ctx.answerCallbackQuery();
    const reply = { reply_parameters: { message_id: ctx.callbackQuery.message!.message_id } };
    if (it.raw_text.length <= TRANSCRIPT_INLINE_MAX) {
      await ctx.reply(`${d.card.transcriptTitle}\n\n${it.raw_text}`, reply);
    } else {
      await ctx.replyWithDocument(new InputFile(Buffer.from(it.raw_text, "utf8"), `transcript-${it.id}.txt`), { caption: `📜 ${cut(it.title ?? "", 900)}`, ...reply });
    }
  });
}
