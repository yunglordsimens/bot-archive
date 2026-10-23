import { InlineKeyboard, type Api, type Bot } from "grammy";
import { db, updateItem, type Item } from "./db.js";
import { planStructure, sortItems, type Category, type Current, type Plan, type SortAnswer, type SortQuestion } from "./gemini.js";
import { rewritePost } from "./channel.js";
import { errorReason, esc } from "./format.js";
import { tr, type Dict } from "./i18n/index.js";
import { splitMessages } from "./split.js";
import { getUserById, updateUser, userProjects, userThemes, type Ctx, type User } from "./users.js";

// /resort <how I want it> (SPEC §5.0), any wording and language, several instructions at once:
// 1) Gemini returns the full new structure + the list of changes;
// 2) dry run: renames/translations are mapped directly, only splits / new / cross-cutting categories are asked
//    by the saved gist (no video) → "how many items move";
// 3) only after ✅ Apply — the items, the user's lists and the channel post headers are updated.

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const BATCH = 25;
const EDIT_PAUSE = Number(process.env.RESORT_EDIT_PAUSE_MS ?? 1100); // channel edit limits
const LIVE = ["ok", "pending_media"]; // analysed items; new ones are sorted by the new lists anyway

type Assign = { theme: string | null; project: string[] };
type Proposal = { plan: Plan; assign: Map<number, Assign>; at: number };
const proposals = new Map<number, Proposal>(); // user id → proposal waiting for ✅
const running = new Set<number>();

const norm = (s: string) => s.trim().toLowerCase();
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// New categories that take the items of an old name.
const targets = (cats: Category[], old: string) => cats.filter((c) => c.from.some((f) => norm(f) === norm(old))).map((c) => c.name);
const onlyTarget = (cats: Category[], old: string) => {
  const t = targets(cats, old);
  return t.length === 1 ? t[0] : undefined;
};

// Drop duplicates and empty names; the model sometimes repeats a category.
export function cleanPlan(plan: Plan): Plan {
  const dedupe = (cats: Category[]) => {
    const out: Category[] = [];
    for (const c of cats ?? []) {
      const name = c.name?.trim();
      if (!name) continue;
      const same = out.find((o) => norm(o.name) === norm(name));
      if (same) same.from = [...new Set([...same.from, ...(c.from ?? [])])];
      else out.push({ name, hint: c.hint?.trim() ?? "", from: (c.from ?? []).filter(Boolean), overlay: !!c.overlay });
    }
    return out;
  };
  const projects = dedupe(plan.projects);
  // A cross-cutting area can't be the only one: keep at least one regular area (the "misc" bucket is last).
  if (projects.length && projects.every((p) => p.overlay)) projects[projects.length - 1].overlay = false;
  return { projects, themes: dedupe(plan.themes).map((t) => ({ ...t, overlay: false })), changes: plan.changes ?? [], problem: plan.problem?.trim() ?? "" };
}

// What is known from the mapping alone, and what has to be asked.
export function prepare(plan: Plan, items: Pick<Item, "id" | "title" | "summary" | "tags" | "theme" | "project">[]) {
  const areas = plan.projects.filter((c) => !c.overlay);
  const overlays = plan.projects.filter((c) => c.overlay).map((c) => c.name);
  const freshThemes = plan.themes.filter((c) => !c.from.length).map((c) => c.name);
  const freshAreas = areas.filter((c) => !c.from.length).map((c) => c.name);
  const base = new Map<number, { theme?: string; project: string[]; q?: SortQuestion }>();
  for (const it of items) {
    const tt = it.theme ? targets(plan.themes, it.theme) : [];
    let theme: string | undefined;
    let theme_from: string[] | undefined;
    if (tt.length === 1 && !freshThemes.length) theme = tt[0];
    else theme_from = tt.length ? [...new Set([...tt, ...freshThemes])] : plan.themes.map((c) => c.name);

    const fixed = new Set<string>();
    const choose = new Set<string>(freshAreas);
    for (const old of it.project ?? []) {
      const t = targets(areas, old);
      if (t.length === 1) fixed.add(t[0]);
      else (t.length ? t : areas.map((c) => c.name)).forEach((x) => choose.add(x));
    }
    if (!(it.project ?? []).length) areas.forEach((c) => choose.add(c.name));
    fixed.forEach((x) => choose.delete(x));

    const q: SortQuestion | undefined = theme_from || choose.size || overlays.length
      ? { id: it.id, title: it.title, summary: it.summary?.slice(0, 600) ?? null, tags: it.tags ?? [],
          ...(theme_from && { theme_from }), ...(choose.size && { projects_from: [...choose] }), ...(overlays.length && { overlays }) }
      : undefined;
    base.set(it.id, { theme, project: [...fixed], q });
  }
  return base;
}

// Answer (or no answer) → final theme and areas; anything invalid falls back to the mapping or the "misc" bucket.
export function resolve(plan: Plan, b: { theme?: string; project: string[]; q?: SortQuestion }, a: SortAnswer | undefined): Assign {
  const pick = (v: string | undefined, from: string[]) => from.find((x) => v && norm(x) === norm(v));
  const misc = (cats: Category[]) => cats.filter((c) => !c.overlay).at(-1)!.name;
  let theme = b.theme ?? pick(a?.theme, b.q?.theme_from ?? []);
  theme ??= b.q?.theme_from?.length && b.q.theme_from.length < plan.themes.length ? b.q.theme_from[0] : misc(plan.themes);
  const project = [...b.project];
  for (const p of a?.projects ?? []) { const x = pick(p, b.q?.projects_from ?? []); if (x) project.push(x); }
  if (!project.length) project.push(misc(plan.projects));
  for (const o of a?.overlays ?? []) { const x = pick(o, b.q?.overlays ?? []); if (x) project.push(x); }
  return { theme, project: [...new Set(project)] };
}

// "How many items move": compared with plain renaming (a 1:1 rename/translation is not a move).
export function summarize(plan: Plan, items: Pick<Item, "id" | "theme" | "project">[], assign: Map<number, Assign>) {
  let moved = 0;
  let renamed = 0;
  const gained: Record<string, number> = {};
  for (const it of items) {
    const a = assign.get(it.id);
    if (!a) continue;
    const expTheme = it.theme ? onlyTarget(plan.themes, it.theme) : undefined;
    const expProject = (it.project ?? []).map((p) => onlyTarget(plan.projects, p)).filter((x): x is string => !!x);
    const gainedHere = [...(a.theme && a.theme !== expTheme ? [a.theme] : []), ...a.project.filter((p) => !expProject.includes(p))];
    if (gainedHere.length || expProject.some((p) => !a.project.includes(p))) {
      moved++;
      for (const g of gainedHere) gained[g] = (gained[g] ?? 0) + 1;
    } else if (a.theme !== it.theme || !sameSet(a.project, it.project ?? [])) renamed++;
  }
  return { moved, renamed, gained };
}

async function currentOf(u: User, items: Item[]): Promise<Current> {
  const count = (f: (it: Item) => boolean) => items.filter(f).length;
  const projects = Object.entries(userProjects(u)).map(([name, hint]) => ({ name, hint, items: count((it) => (it.project ?? []).includes(name)) }));
  const themes = userThemes(u).map((name) => ({ name, items: count((it) => it.theme === name) }));
  // Leftovers (e.g. names from another interface language) must be mapped too.
  for (const it of items) {
    for (const p of it.project ?? []) if (!projects.some((x) => x.name === p)) projects.push({ name: p, hint: "", items: count((i) => (i.project ?? []).includes(p)) });
    if (it.theme && !themes.some((x) => x.name === it.theme)) themes.push({ name: it.theme, items: count((i) => i.theme === it.theme) });
  }
  return { projects, themes };
}

const loadItems = async (u: User) => {
  const { data, error } = await db.from("items").select()
    .eq("user_id", u.id).in("status", LIVE).order("id");
  if (error) throw error;
  return (data ?? []) as Item[];
};

const names = (cats: Category[]) => cats.map((c) => esc(c.name) + (c.overlay ? " ⤴" : "")).join(" · ");

function proposalText(d: Dict, plan: Plan, s: ReturnType<typeof summarize>, total: number, lost: string[]) {
  const gained = Object.entries(s.gained).sort((a, b) => b[1] - a[1]).map(([n, k]) => `${esc(n)} +${k}`).join(" · ");
  return [
    `<b>${d.resort.proposalTitle}</b>\n🧭 ${names(plan.projects)}\n🗂 ${names(plan.themes)}`,
    plan.changes.length ? `<b>${d.resort.changesTitle}</b>\n${plan.changes.map((c) => `• ${esc(c)}`).join("\n")}` : "",
    lost.length ? `⚠️ ${d.resort.lost(lost.map(esc).join(", "))}` : "",
    `📦 <b>${d.resort.moved(s.moved, total)}</b>${gained ? `\n→ ${gained}` : ""}${s.renamed ? `\n✏️ ${d.resort.renamedOnly(s.renamed)}` : ""}`,
    d.resort.confirm,
  ].filter(Boolean);
}

async function propose(api: Api, u: User, chatId: number, want: string) {
  const d = tr(u.lang);
  const msg = await api.sendMessage(chatId, d.resort.thinking);
  const status = (text: string) => api.editMessageText(chatId, msg.message_id, text, html).catch(() => {});
  let plan: Plan;
  const items = await loadItems(u);
  const current = await currentOf(u, items);
  try {
    plan = cleanPlan(await planStructure(want, current, d.geminiLanguage));
  } catch (e) {
    console.warn("resort: plan failed", e);
    return status(d.resort.failed(esc(errorReason(d, String((e as Error)?.message ?? e)))));
  }
  if (plan.problem) return status(d.resort.failed(esc(plan.problem)));
  if (!plan.projects.length || !plan.themes.length) {
    console.warn("resort: empty lists in the plan", JSON.stringify(plan));
    return status(d.resort.failed(d.resort.emptyLists));
  }

  // Dry run: ask only what the mapping can't answer.
  const base = prepare(plan, items);
  const questions = [...base.values()].map((b) => b.q).filter((q): q is SortQuestion => !!q);
  const hints = Object.fromEntries([...plan.projects, ...plan.themes].filter((c) => c.hint).map((c) => [c.name, c.hint]));
  const answers = new Map<number, SortAnswer>();
  for (let i = 0; i < questions.length; i += BATCH) {
    await status(d.resort.counting(i, questions.length));
    try {
      for (const a of await sortItems(questions.slice(i, i + BATCH), hints)) answers.set(a.id, a);
    } catch (e) {
      console.warn("resort: sorting failed", e);
      return status(d.resort.failed(esc(errorReason(d, String((e as Error)?.message ?? e)))));
    }
  }
  const assign = new Map([...base].map(([id, b]) => [id, resolve(plan, b, answers.get(id))]));
  proposals.set(u.id, { plan, assign, at: Date.now() });

  // Old names the model left without a new place: their items are sorted by meaning — say so.
  const lost = [...current.projects.filter((c) => c.items && !targets(plan.projects, c.name).length),
    ...current.themes.filter((c) => c.items && !targets(plan.themes, c.name).length)].map((c) => c.name);
  const parts = splitMessages(proposalText(d, plan, summarize(plan, items, assign), items.length, lost));
  const kb = new InlineKeyboard().text(d.resort.apply, "resort:ok").text(d.resort.cancel, "resort:no");
  await api.editMessageText(chatId, msg.message_id, parts[0], { ...html, ...(parts.length === 1 && { reply_markup: kb }) });
  for (let i = 1; i < parts.length; i++) await api.sendMessage(chatId, parts[i], { ...html, ...(i === parts.length - 1 && { reply_markup: kb }) });
}

async function apply(api: Api, u: User, chatId: number, p: Proposal) {
  const d = tr(u.lang);
  const items = await loadItems(u);
  const msg = await api.sendMessage(chatId, d.resort.progress(0, items.length));
  let changed = 0;
  for (const [i, it] of items.entries()) {
    // Items saved after the proposal: plain mapping.
    const a = p.assign.get(it.id) ?? resolve(p.plan, prepare(p.plan, [it]).get(it.id)!, undefined);
    if (a.theme !== it.theme || !sameSet(a.project, it.project ?? [])) {
      await updateItem(it.id, { theme: a.theme, project: a.project });
      changed++;
      if (it.archive_link) {
        await rewritePost(api, { ...it, ...a } as Item, u, true).catch(() => {});
        await new Promise((r) => setTimeout(r, EDIT_PAUSE));
      }
    }
    if (i % 20 === 19) await api.editMessageText(chatId, msg.message_id, d.resort.progress(i + 1, items.length)).catch(() => {});
  }
  await api.editMessageText(chatId, msg.message_id, d.resort.done(changed, items.length), html).catch(() => {});
}

export function registerResort(bot: Bot<Ctx>) {
  bot.command("resort", async (ctx) => {
    const d = tr(ctx.user.lang);
    const want = ctx.match.trim();
    if (!want) {
      const u = ctx.user;
      return ctx.reply(d.resort.usage(`🧭 ${Object.keys(userProjects(u)).map(esc).join(" · ")}\n🗂 ${userThemes(u).map(esc).join(" · ")}`), html);
    }
    if (running.has(ctx.user.id)) return ctx.reply(d.resort.running);
    running.add(ctx.user.id);
    void propose(ctx.api, ctx.user, ctx.chat.id, want)
      .catch((e) => console.error("resort proposal failed", e))
      .finally(() => running.delete(ctx.user.id));
  });

  bot.callbackQuery(/^resort:(ok|no)$/, async (ctx) => {
    const d = tr(ctx.user.lang);
    const p = proposals.get(ctx.user.id);
    if (ctx.match[1] === "no" || !p) {
      proposals.delete(ctx.user.id);
      await ctx.answerCallbackQuery();
      return ctx.editMessageReplyMarkup().then(() => ctx.reply(p ? d.resort.cancelled : d.resort.expired)).catch(() => {});
    }
    if (running.has(ctx.user.id)) return ctx.answerCallbackQuery(d.resort.running);
    proposals.delete(ctx.user.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    const u = await updateUser(ctx.user, {
      projects: Object.fromEntries(p.plan.projects.map((c) => [c.name, c.hint])),
      themes: p.plan.themes.map((c) => c.name),
    });
    running.add(u.id);
    void apply(ctx.api, await getUserById(u.id), ctx.chat!.id, p)
      .catch((e) => console.error("resort failed", e))
      .finally(() => running.delete(u.id));
  });
}
