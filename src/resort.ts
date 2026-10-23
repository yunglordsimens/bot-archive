import { InlineKeyboard, type Api, type Bot } from "grammy";
import { db, updateItem, type Item } from "./db.js";
import { proposeStructure, resortBatch, type Structure } from "./gemini.js";
import { rewritePost } from "./channel.js";
import { esc } from "./format.js";
import { plural, tr } from "./i18n/index.js";
import { getUserById, profileOf, updateUser, userProjects, userThemes, type Ctx, type User } from "./users.js";

// /resort <how I want it> (SPEC §5.0): describe the new structure in words → the bot proposes the lists →
// after ✅ it re-sorts every saved item by its saved gist (no downloads, cheap) and refreshes the channel post headers.

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const proposals = new Map<number, Structure>(); // user id → proposal waiting for ✅
const running = new Set<number>();
const BATCH = 25;

const current = (u: User): Structure => ({
  projects: Object.entries(userProjects(u)).map(([name, hint]) => ({ name, hint })),
  themes: userThemes(u),
});
const listText = (s: Structure) =>
  `🧭 ${s.projects.map((p) => esc(p.name)).join(" · ")}\n🗂 ${s.themes.map(esc).join(" · ")}`;

async function run(api: Api, u: User, chatId: number) {
  const d = tr(u.lang);
  const { data } = await db.from("items").select().eq("user_id", u.id).in("status", ["ok", "pending_media"]).order("id");
  const items = (data ?? []) as Item[];
  const msg = await api.sendMessage(chatId, d.resort.start(plural(d, items.length, d.forms.items)));
  const p = profileOf(u);
  let changed = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    let sorted;
    try {
      sorted = await resortBatch(chunk.map((it) => ({ id: it.id, title: it.title, summary: it.summary, tags: it.tags ?? [] })), p);
    } catch (e) {
      console.warn("resort batch failed", e);
      failed += chunk.length;
      continue;
    }
    for (const it of chunk) {
      const s = sorted.find((x) => x.id === it.id);
      if (!s) { failed++; continue; }
      const project = [...new Set(s.project.filter((x) => x in p.projects))];
      const theme = p.themes.includes(s.theme) ? s.theme : p.themes.at(-1)!;
      if (theme === it.theme && project.join("\n") === (it.project ?? []).join("\n")) continue;
      await updateItem(it.id, { project, theme });
      changed++;
      if (it.archive_link) {
        await rewritePost(api, { ...it, project, theme }, u, true).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200)); // channel edit limits
      }
    }
    await api.editMessageText(chatId, msg.message_id, d.resort.progress(Math.min(i + BATCH, items.length), items.length)).catch(() => {});
  }
  await api.editMessageText(chatId, msg.message_id, d.resort.done(changed, items.length, failed), html).catch(() => {});
}

export function registerResort(bot: Bot<Ctx>) {
  bot.command("resort", async (ctx) => {
    const d = tr(ctx.user.lang);
    const want = ctx.match.trim();
    if (!want) return ctx.reply(d.resort.usage(listText(current(ctx.user))), html);
    if (running.has(ctx.user.id)) return ctx.reply(d.resort.running);
    const wait = await ctx.reply(d.resort.thinking);
    try {
      const s = await proposeStructure(want, current(ctx.user), d.geminiLanguage);
      if (!s.projects.length || !s.themes.length) throw new Error("empty lists");
      proposals.set(ctx.user.id, s);
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, d.resort.proposal(listText(s)), {
        ...html, reply_markup: new InlineKeyboard().text(d.resort.apply, "resort:ok").text(d.resort.cancel, "resort:no"),
      });
    } catch (e) {
      console.warn("resort proposal failed", e);
      await ctx.api.editMessageText(ctx.chat.id, wait.message_id, d.resort.failed);
    }
  });

  bot.callbackQuery(/^resort:(ok|no)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    const s = proposals.get(ctx.user.id);
    proposals.delete(ctx.user.id);
    if (ctx.match[1] === "no" || !s) {
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(s ? d.resort.cancelled : d.resort.expired).catch(() => {});
    }
    if (running.has(ctx.user.id)) return ctx.answerCallbackQuery(d.resort.running);
    await ctx.answerCallbackQuery();
    const u = await updateUser(ctx.user, { projects: Object.fromEntries(s.projects.map((p) => [p.name, p.hint])), themes: s.themes });
    await ctx.editMessageText(d.resort.applied(listText(s)), html).catch(() => {});
    running.add(u.id);
    void run(ctx.api, await getUserById(u.id), ctx.chat!.id)
      .catch((e) => console.error("resort failed", e))
      .finally(() => running.delete(u.id));
  });
}
