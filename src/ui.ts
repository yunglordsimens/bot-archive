import { InlineKeyboard, Keyboard, type Api, type Bot, type Context } from "grammy";
import { config, THEMES, TYPES } from "./config.js";
import { db, type Item } from "./db.js";
import { archiveState } from "./archive.js";
import { esc, listLine, plural } from "./format.js";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const SAVED = ["ok", "pending_media"];
const startedAt = new Date();

export const BTN = { recent: "🕘 Последние", themes: "🗂 Темы", types: "🏷 Типы", status: "📊 Статус", help: "❓ Помощь" };

export const mainKeyboard = new Keyboard()
  .text(BTN.recent).text(BTN.themes).text(BTN.types).row()
  .text(BTN.status).text(BTN.help)
  .resized().persistent();

const HELP = `<b>Что кидать</b>
🎵 тикток, ▶️ youtube, 📸 reels, 🔗 любую ссылку
🖼 скрины — по одному или альбомом до 10
🎙 голосовые, ⭕️ кружочки, 📝 текст, ↪️ пересланное

<b>Что происходит</b>
Бот отвечает «принято», потом строка меняется: ⬇️ скачиваю → 🧠 разбираю → итог.
Итог: тип · заголовок · тема · ссылка на оригинал в канале-архиве.
Если не получилось — под сообщением будет кнопка 🔁 Повторить.

<b>Кнопки внизу</b>
${BTN.recent} — 10 последних записей
${BTN.themes} / ${BTN.types} — записи по теме или типу
${BTN.status} — работает ли бот, канал, очередь, ошибки`;

async function itemsList(title: string, filter: (q: any) => any, limit = 20) {
  const { data } = await filter(db.from("items").select().in("status", SAVED)).order("id", { ascending: false }).limit(limit);
  const items = (data ?? []) as Item[];
  return `<b>${title}</b>\n${items.map(listLine).join("\n") || "пока пусто"}`;
}

async function countBy(column: "theme" | "content_type") {
  const { data } = await db.from("items").select(column).in("status", SAVED).limit(10000);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Record<string, string>[]) counts.set(r[column], (counts.get(r[column]) ?? 0) + 1);
  return counts;
}

async function themesMenu() {
  const counts = await countBy("theme");
  const kb = new InlineKeyboard();
  THEMES.forEach((t, i) => kb.text(`${t} · ${counts.get(t) ?? 0}`, `th:${i}`).row());
  return kb;
}

async function typesMenu() {
  const counts = await countBy("content_type");
  const kb = new InlineKeyboard();
  Object.entries(TYPES).forEach(([k, v], i) => {
    kb.text(`${v.emoji} ${v.ru} · ${counts.get(k) ?? 0}`, `ty:${k}`);
    if (i % 2) kb.row();
  });
  return kb;
}

function uptime() {
  const min = Math.floor((Date.now() - startedAt.getTime()) / 60000);
  const time = startedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `с ${time} (${min >= 60 ? `${Math.floor(min / 60)} ч ` : ""}${min % 60} мин)`;
}

async function statusMessage(api: Api, botId: number) {
  const statuses = ["ok", "pending_media", "queued", "processing", "failed"] as const;
  const counts = await Promise.all(statuses.map(async (s) => {
    const { count } = await db.from("items").select("id", { count: "exact", head: true }).eq("status", s);
    return count ?? 0;
  }));
  const c = Object.fromEntries(statuses.map((s, i) => [s, counts[i]])) as Record<(typeof statuses)[number], number>;
  const archive = await archiveState(api, botId);
  const { data: last } = await db.from("items").select("title, created_at").in("status", SAVED).order("id", { ascending: false }).limit(1).maybeSingle();

  const lines = [
    `<b>📊 Статус</b>`,
    `🟢 бот работает ${uptime()}`,
    archive.ok ? `🗄 канал-архив: ${esc(archive.title ?? "")} ✓` : `⚠️ канал-архив ${archive.problem}`,
    `🧠 модель: ${config.geminiModel}`,
    ``,
    `📦 сохранено: ${c.ok + c.pending_media}`,
    c.queued || c.processing ? `⏳ в очереди: ${c.queued} · в работе: ${c.processing}` : `⏳ очередь пустая`,
  ];
  if (c.pending_media) lines.push(`🎞 без видео (повтор раз в сутки): ${c.pending_media}`);
  if (c.failed) lines.push(`❌ с ошибкой: ${c.failed}`);
  if (last) lines.push(``, `🕘 последняя: ${esc(last.title ?? "")} · ${new Date(last.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);

  const kb = new InlineKeyboard().text("🔄 Обновить", "status");
  if (c.failed) kb.text(`🔁 Повторить ошибки (${c.failed})`, "retryall");
  return { text: lines.join("\n"), kb };
}

async function requeue(ids?: number[]) {
  let q = db.from("items").update({ status: "queued", attempts: 0, error: null, updated_at: new Date().toISOString() });
  q = ids ? q.in("id", ids).in("status", ["failed", "pending_media"]) : q.eq("status", "failed");
  const { data, error } = await q.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export function registerUi(bot: Bot) {
  const showStatus = async (ctx: Context) => {
    const s = await statusMessage(ctx.api, ctx.me.id);
    await ctx.reply(s.text, { ...html, reply_markup: s.kb });
  };
  const showRecent = async (ctx: Context) => ctx.reply(await itemsList("🕘 Последние", (q) => q, 10), html);
  const showThemes = async (ctx: Context) => ctx.reply("🗂 Темы — выбери:", { reply_markup: await themesMenu() });
  const showTypes = async (ctx: Context) => ctx.reply("🏷 Типы — выбери:", { reply_markup: await typesMenu() });
  const showHelp = (ctx: Context) => ctx.reply(HELP, { ...html, reply_markup: mainKeyboard });

  bot.command("start", (ctx) =>
    ctx.reply("Привет! Кидай сюда ссылки, скрины, голосовые, текст — разберу и сохраню.\nКнопки внизу 👇", { reply_markup: mainKeyboard }));
  bot.command("help", showHelp);
  bot.command("status", showStatus);
  bot.command("recent", showRecent);
  bot.hears(BTN.recent, showRecent);
  bot.hears(BTN.themes, showThemes);
  bot.hears(BTN.types, showTypes);
  bot.hears(BTN.status, showStatus);
  bot.hears(BTN.help, showHelp);

  bot.command("theme", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const theme = q && (THEMES.find((t) => t.startsWith(q)) || THEMES.find((t) => t.includes(q)));
    if (!theme) return showThemes(ctx);
    await ctx.reply(await itemsList(esc(theme), (b) => b.eq("theme", theme)), html);
  });

  bot.command("type", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const type = q && Object.keys(TYPES).find((k) => k.startsWith(q) || TYPES[k].ru.startsWith(q));
    if (!type) return showTypes(ctx);
    await ctx.reply(await itemsList(`${TYPES[type].emoji} ${TYPES[type].ru}`, (b) => b.eq("content_type", type)), html);
  });

  // Inline buttons: open a theme/type in place, with a "back" button.
  bot.callbackQuery(/^th:(\d+)$/, async (ctx) => {
    const theme = THEMES[Number(ctx.match[1])];
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await itemsList(`🗂 ${esc(theme)}`, (b) => b.eq("theme", theme)),
      { ...html, reply_markup: new InlineKeyboard().text("← Темы", "themes") });
  });
  bot.callbackQuery(/^ty:(\w+)$/, async (ctx) => {
    const t = TYPES[ctx.match[1]];
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await itemsList(`${t.emoji} ${t.ru}`, (b) => b.eq("content_type", ctx.match[1])),
      { ...html, reply_markup: new InlineKeyboard().text("← Типы", "types") });
  });
  bot.callbackQuery("themes", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🗂 Темы — выбери:", { reply_markup: await themesMenu() });
  });
  bot.callbackQuery("types", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🏷 Типы — выбери:", { reply_markup: await typesMenu() });
  });

  bot.callbackQuery("status", async (ctx) => {
    const s = await statusMessage(ctx.api, ctx.me.id);
    await ctx.answerCallbackQuery("обновлено");
    await ctx.editMessageText(s.text, { ...html, reply_markup: s.kb }).catch(() => {});
  });

  bot.callbackQuery(/^retry:(\d+)$/, async (ctx) => {
    const n = await requeue([Number(ctx.match[1])]);
    await ctx.answerCallbackQuery(n ? "повторяю" : "уже не в ошибке");
    if (n) await ctx.editMessageText("🔁 повторяю…").catch(() => {});
  });
  bot.callbackQuery("retryall", async (ctx) => {
    const n = await requeue();
    await ctx.answerCallbackQuery(`повторяю ${n}`);
    await ctx.reply(`🔁 ${plural(n, "запись", "записи", "записей")} снова в очереди`);
  });
}
