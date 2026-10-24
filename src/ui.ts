import { InlineKeyboard, type Api, type Bot } from "grammy";
import { config, TYPE_EMOJI } from "./config.js";
import { db, type Item } from "./db.js";
import { archiveChannel, archiveState } from "./archive.js";
import { errorReason, esc, listLine, typeLabel } from "./format.js";
import { republish } from "./worker.js";
import { allButtons, DICTS, LANGS, plural, tr, type Dict, type Lang } from "./i18n/index.js";
import { addUser, listUsers, updateUser, userProjects, userThemes, type Ctx, type User } from "./users.js";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const SAVED = ["ok", "pending_media"];
const TYPES = Object.keys(TYPE_EMOJI);
const startedAt = new Date();

// No persistent keyboard (SPEC §6.0): commands live in the "Menu" button. This removes the old keyboard from the chat.
const removeKeyboard = { remove_keyboard: true as const };

// Every query is limited to the user's own items.
const mine = (u: User) => db.from("items").select().eq("user_id", u.id).in("status", SAVED);

async function itemsList(u: User, title: string, filter: (q: any) => any, limit = 20) {
  const d = tr(u.lang);
  const { data } = await filter(mine(u)).order("id", { ascending: false }).limit(limit);
  const items = (data ?? []) as Item[];
  return `<b>${title}</b>\n${items.map((it) => listLine(d, it)).join("\n") || d.ui.empty}`;
}

async function countBy(u: User, column: "theme" | "content_type" | "project") {
  const { data } = await db.from("items").select(column).eq("user_id", u.id).in("status", SAVED).limit(10000);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Record<string, string | string[]>[]) {
    for (const v of [r[column]].flat()) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

async function projectsMenu(u: User) {
  const counts = await countBy(u, "project");
  const kb = new InlineKeyboard();
  Object.keys(userProjects(u)).forEach((p, i) => {
    kb.text(`${p} · ${counts.get(p) ?? 0}`, `pr:${i}`);
    if (i % 2) kb.row();
  });
  return kb;
}

async function themesMenu(u: User) {
  const counts = await countBy(u, "theme");
  const kb = new InlineKeyboard();
  userThemes(u).forEach((t, i) => kb.text(`${t} · ${counts.get(t) ?? 0}`, `th:${i}`).row());
  return kb;
}

async function typesMenu(u: User) {
  const d = tr(u.lang);
  const counts = await countBy(u, "content_type");
  const kb = new InlineKeyboard();
  TYPES.forEach((k, i) => {
    kb.text(`${typeLabel(d, k)} · ${counts.get(k) ?? 0}`, `ty:${k}`);
    if (i % 2) kb.row();
  });
  return kb;
}

async function statusMessage(api: Api, botId: number, u: User) {
  const d = tr(u.lang);
  const statuses = ["ok", "pending_media", "queued", "processing", "failed"] as const;
  const counts = await Promise.all(statuses.map(async (s) => {
    const { count } = await db.from("items").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("status", s);
    return count ?? 0;
  }));
  const c = Object.fromEntries(statuses.map((s, i) => [s, counts[i]])) as Record<(typeof statuses)[number], number>;
  const archive = await archiveState(api, botId, u);
  const { data: last } = await mine(u).order("id", { ascending: false }).limit(1).maybeSingle();
  const min = Math.floor((Date.now() - startedAt.getTime()) / 60000);
  const time = startedAt.toLocaleTimeString(d.locale, { hour: "2-digit", minute: "2-digit" });

  const lines = [
    `<b>${d.ui.statusTitle}</b>`,
    d.ui.running(time, Math.floor(min / 60), min % 60),
    archive.ok ? d.ui.channelOk(esc(archive.title ?? "")) : d.ui.channelBad(archive.problem ?? ""),
    `${d.ui.model}: ${config.geminiModel}`,
    ``,
    `${d.ui.saved}: ${c.ok + c.pending_media}`,
    c.queued || c.processing ? d.ui.queue(c.queued, c.processing) : d.ui.queueEmpty,
  ];
  if (c.pending_media) lines.push(`${d.ui.pending}: ${c.pending_media}`);
  if (c.failed) lines.push(d.ui.failedN(c.failed));
  if (last) {
    const when = new Date(last.created_at).toLocaleString(d.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    lines.push(``, `${d.ui.last}: ${esc(last.title ?? "")} · ${when}`);
  }
  const kb = new InlineKeyboard().text(d.ui.refresh, "status");
  if (c.failed + c.pending_media) kb.text(d.ui.retryN(c.failed + c.pending_media), "retryall");
  return { text: lines.join("\n"), kb };
}

// Back to the queue: given ids, or every failed + pending_media item of the user.
async function requeue(u: User, ids?: number[]) {
  let q = db.from("items").update({ status: "queued", attempts: 0, next_retry_at: null, updated_at: new Date().toISOString() })
    .eq("user_id", u.id).in("status", ["failed", "pending_media"]);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// Commands menu in the user's language, for this chat only.
export async function setCommands(api: Api, u: User) {
  const d = tr(u.lang);
  await api.setMyCommands(Object.entries(d.commands).map(([command, description]) => ({ command, description })),
    { scope: { type: "chat", chat_id: u.telegram_user_id } }).catch(() => {});
  // The "Menu" button opens the Mini App «Архив», labelled in the user's language.
  if (config.miniappUrl) {
    await api.setChatMenuButton({ chat_id: u.telegram_user_id, menu_button: { type: "web_app", text: d.menuButton, web_app: { url: config.miniappUrl } } })
      .catch((e) => console.warn("menu button failed", e?.description ?? e));
  }
}

export function registerUi(bot: Bot<Ctx>) {
  const showStatus = async (ctx: Ctx) => {
    const s = await statusMessage(ctx.api, ctx.me.id, ctx.user);
    await ctx.reply(s.text, { ...html, reply_markup: s.kb });
  };
  const showRecent = async (ctx: Ctx) => ctx.reply(await itemsList(ctx.user, tr(ctx.user.lang).ui.recentTitle, (q) => q, 10), html);
  const showThemes = async (ctx: Ctx) => ctx.reply(tr(ctx.user.lang).ui.chooseThemes, { reply_markup: await themesMenu(ctx.user) });
  const showTypes = async (ctx: Ctx) => ctx.reply(tr(ctx.user.lang).ui.chooseTypes, { reply_markup: await typesMenu(ctx.user) });
  const showProjects = async (ctx: Ctx) => ctx.reply(tr(ctx.user.lang).ui.chooseProjects, { reply_markup: await projectsMenu(ctx.user) });
  const retryAll = async (ctx: Ctx) => {
    const d = tr(ctx.user.lang);
    const n = await requeue(ctx.user);
    await ctx.reply(n ? d.ui.requeued(plural(d, n, d.forms.items)) : d.ui.nothingToRetry);
  };
  const showHelp = (ctx: Ctx) => ctx.reply(tr(ctx.user.lang).ui.help, { ...html, reply_markup: removeKeyboard });

  bot.command("start", async (ctx) => {
    const d = tr(ctx.user.lang);
    if (!ctx.user.name && ctx.from) ctx.user = await updateUser(ctx.user, { name: [ctx.from.first_name, ctx.from.username && `@${ctx.from.username}`].filter(Boolean).join(" ") });
    await setCommands(ctx.api, ctx.user);
    const noChannel = !(await archiveState(ctx.api, ctx.me.id, ctx.user)).ok;
    await ctx.reply(`${d.ui.start}${noChannel ? `\n\n${d.ui.startNoChannel}` : ""}`, { reply_markup: removeKeyboard });
  });
  bot.command("help", showHelp);
  bot.command("status", showStatus);
  bot.command("recent", showRecent);
  bot.command("retry", retryAll);
  // Old reply-keyboard buttons (until the chat gets /start and the keyboard disappears).
  bot.hears(allButtons("recent"), showRecent);
  bot.hears(allButtons("themes"), showThemes);
  bot.hears(allButtons("projects"), showProjects);
  bot.hears(allButtons("types"), showTypes);
  bot.hears(allButtons("status"), showStatus);
  bot.hears(allButtons("help"), showHelp);

  bot.command("project", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const p = q && Object.keys(userProjects(ctx.user)).find((x) => x.toLowerCase().startsWith(q) || x.toLowerCase().includes(q));
    if (!p) return showProjects(ctx);
    await ctx.reply(await itemsList(ctx.user, `🧭 ${esc(p)}`, (b) => b.contains("project", [p])), html);
  });
  bot.command("theme", async (ctx) => {
    const q = ctx.match.trim().toLowerCase();
    const themes = userThemes(ctx.user);
    const theme = q && (themes.find((t) => t.startsWith(q)) || themes.find((t) => t.includes(q)));
    if (!theme) return showThemes(ctx);
    await ctx.reply(await itemsList(ctx.user, esc(theme), (b) => b.eq("theme", theme)), html);
  });
  bot.command("type", async (ctx) => {
    const d = tr(ctx.user.lang);
    const q = ctx.match.trim().toLowerCase();
    const type = q && TYPES.find((k) => k.startsWith(q) || d.types[k as keyof Dict["types"]].startsWith(q));
    if (!type) return showTypes(ctx);
    await ctx.reply(await itemsList(ctx.user, typeLabel(d, type), (b) => b.eq("content_type", type)), html);
  });

  // Own life areas: /projects a, b, c (the last one is the "misc" bucket).
  bot.command("projects", async (ctx) => {
    const d = tr(ctx.user.lang);
    const list = ctx.match.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return ctx.reply(d.projects.current(Object.keys(userProjects(ctx.user)).map((p) => `• ${p}`).join("\n")));
    const old = userProjects(ctx.user);
    const misc = d.defaultProjects.at(-1)!;
    if (!list.includes(misc)) list.push(misc);
    ctx.user = await updateUser(ctx.user, { projects: Object.fromEntries(list.map((p) => [p, old[p] ?? ""])) });
    await ctx.reply(d.projects.set(list.map((p) => `• ${p}`).join("\n")));
  });

  // Interface language.
  bot.command("lang", async (ctx) => {
    const kb = new InlineKeyboard();
    LANGS.forEach((l) => kb.text(`${DICTS[l].flag} ${DICTS[l].langName}`, `lang:${l}`));
    await ctx.reply(tr(ctx.user.lang).lang.choose, { reply_markup: kb });
  });
  bot.callbackQuery(/^lang:(ru|cs|en|vi)$/, async (ctx) => {
    ctx.user = await updateUser(ctx.user, { lang: ctx.match[1] as Lang });
    const d = tr(ctx.user.lang);
    await ctx.answerCallbackQuery();
    await setCommands(ctx.api, ctx.user);
    await ctx.editMessageText(d.lang.set).catch(() => {});
  });

  // /notify: after saving, one line with a link to the post (off = only reactions and errors in the chat).
  const notifyKb = (d: Dict, on: boolean) => new InlineKeyboard().text(`${on ? "● " : ""}${d.notify.on}`, "notify:on").text(`${on ? "" : "● "}${d.notify.off}`, "notify:off");
  bot.command("notify", async (ctx) => {
    const d = tr(ctx.user.lang);
    await ctx.reply(`${d.notify.choose}\n\n${ctx.user.notify ? d.notify.isOn : d.notify.isOff}`, { reply_markup: notifyKb(d, ctx.user.notify) });
  });
  bot.callbackQuery(/^notify:(on|off)$/, async (ctx) => {
    ctx.user = await updateUser(ctx.user, { notify: ctx.match[1] === "on" });
    const d = tr(ctx.user.lang);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.user.notify ? d.notify.isOn : d.notify.isOff, { reply_markup: notifyKb(d, ctx.user.notify) }).catch(() => {});
  });

  // Admin: add users — only by Telegram id, only the owner/admins.
  bot.command("adduser", async (ctx) => {
    const d = tr(ctx.user.lang);
    if (!ctx.user.is_admin) return;
    const [id, lang] = ctx.match.trim().split(/\s+/);
    if (!/^\d+$/.test(id ?? "")) return ctx.reply(d.admin.usage);
    const l = (LANGS.includes(lang as Lang) ? lang : "cs") as Lang;
    const u = await addUser(Number(id), l, ctx.user.id);
    await ctx.reply(u ? d.admin.added(Number(id), l) : d.admin.exists);
  });
  bot.command("users", async (ctx) => {
    if (!ctx.user.is_admin) return;
    const users = await listUsers();
    const rows = await Promise.all(users.map(async (u) => {
      const { count } = await db.from("items").select("id", { count: "exact", head: true }).eq("user_id", u.id).in("status", SAVED);
      return `• ${u.telegram_user_id} ${esc(u.name ?? "")} · ${DICTS[u.lang].flag} · ${count ?? 0}${u.archive_channel_id ? " · 🗄" : ""}${u.is_admin ? " · admin" : ""}`;
    }));
    await ctx.reply(`<b>${tr(ctx.user.lang).admin.list}</b>\n${rows.join("\n")}`, html);
  });

  // Inline buttons: open a theme/type/area in place, with a "back" button.
  bot.callbackQuery(/^th:(\d+)$/, async (ctx) => {
    const theme = userThemes(ctx.user)[Number(ctx.match[1])];
    await ctx.answerCallbackQuery();
    if (!theme) return;
    await ctx.editMessageText(await itemsList(ctx.user, `🗂 ${esc(theme)}`, (b) => b.eq("theme", theme)),
      { ...html, reply_markup: new InlineKeyboard().text(tr(ctx.user.lang).ui.backThemes, "themes") });
  });
  bot.callbackQuery(/^ty:(\w+)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await itemsList(ctx.user, typeLabel(d, ctx.match[1]), (b) => b.eq("content_type", ctx.match[1])),
      { ...html, reply_markup: new InlineKeyboard().text(d.ui.backTypes, "types") });
  });
  bot.callbackQuery(/^pr:(\d+)$/, async (ctx) => {
    const p = Object.keys(userProjects(ctx.user))[Number(ctx.match[1])];
    await ctx.answerCallbackQuery();
    if (!p) return;
    await ctx.editMessageText(await itemsList(ctx.user, `🧭 ${esc(p)}`, (b) => b.contains("project", [p])),
      { ...html, reply_markup: new InlineKeyboard().text(tr(ctx.user.lang).ui.backProjects, "projects") });
  });
  bot.callbackQuery("projects", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(tr(ctx.user.lang).ui.chooseProjects, { reply_markup: await projectsMenu(ctx.user) });
  });
  bot.callbackQuery("themes", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(tr(ctx.user.lang).ui.chooseThemes, { reply_markup: await themesMenu(ctx.user) });
  });
  bot.callbackQuery("types", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(tr(ctx.user.lang).ui.chooseTypes, { reply_markup: await typesMenu(ctx.user) });
  });

  bot.callbackQuery("status", async (ctx) => {
    const s = await statusMessage(ctx.api, ctx.me.id, ctx.user);
    await ctx.answerCallbackQuery(tr(ctx.user.lang).ui.updated);
    await ctx.editMessageText(s.text, { ...html, reply_markup: s.kb }).catch(() => {});
  });

  bot.callbackQuery(/^retry:(\d+)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    const n = await requeue(ctx.user, [Number(ctx.match[1])]);
    await ctx.answerCallbackQuery(n ? d.ui.retryingShort : d.ui.notFailed);
    if (n) await ctx.editMessageText(d.ui.retrying).catch(() => {});
  });
  // Saved without an archive post → publish it now (in the background: a TikTok may need downloading again).
  bot.callbackQuery(/^repost:(\d+)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    const { data } = await db.from("items").select().eq("id", Number(ctx.match[1])).eq("user_id", ctx.user.id).maybeSingle();
    const it = data as Item | null;
    if (!it) return ctx.answerCallbackQuery(d.card.notFound);
    const done = (link: string) => ctx.editMessageText(`${d.card.reposted} · <a href="${link}">${d.inArchive}</a>`, html).catch(() => {});
    if (it.archive_link) return ctx.answerCallbackQuery().then(() => done(it.archive_link!));
    if (!archiveChannel(ctx.user)) return ctx.answerCallbackQuery({ text: d.noChannel, show_alert: true });
    await ctx.answerCallbackQuery("…");
    void republish(ctx.api, it, ctx.user).then(done, (e) =>
      ctx.reply(d.card.repostFailed(esc(errorReason(d, String((e as Error)?.message ?? e)))), { reply_parameters: { message_id: ctx.msg!.message_id } }).catch(() => {}));
  });
  bot.callbackQuery("retryall", async (ctx) => {
    await ctx.answerCallbackQuery();
    await retryAll(ctx);
  });
}
