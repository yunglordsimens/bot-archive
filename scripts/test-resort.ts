// Offline test of /resort (item 13): command in backticks, the two requests from the owner, problems and unreadable answers.
// Gemini is replaced by a fake HTTP answer; the plan below is what the model is asked to return.
import assert from "node:assert/strict";
import { startFakeSupabase, tables } from "./fake-supabase.ts";

const OWNER = 585800070;
Object.assign(process.env, { BOT_TOKEN: "1:x", OWNER_ID: String(OWNER), GEMINI_API_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_URL: await startFakeSupabase(), RESORT_EDIT_PAUSE_MS: "0" });

// The owner today: English interface, life areas in Russian, topics = English defaults + Russian leftovers.
const RU_AREAS = { "Lock in / деньги": "заработок", "личный бренд": "", "дропшиппинг": "", "сайты на продажу": "", "арт и портфолио": "", "другой бизнес": "", "здоровье и быт": "здоровье, спорт, еда, дом", "разное": "" };
tables.users.push({ id: 1, telegram_user_id: OWNER, lang: "en", is_admin: true, archive_channel_id: -1001, projects: RU_AREAS, themes: null, name: "owner", notify: false });
const rows: [string, string, string[]][] = [
  ["Ginger tea recipe", "recipes", ["здоровье и быт"]], ["Protein muffin", "рецепты", ["здоровье и быт"]], ["Bloating and gut reset", "misc", ["здоровье и быт"]],
  ["Migraine relief", "разное", ["здоровье и быт"]], ["Leg workout", "misc", ["здоровье и быт", "Lock in / деньги"]], ["Sell to ego, not wallets", "hooks & marketing", ["личный бренд", "дропшиппинг"]],
  ["Cold calling for clients", "money & business ideas", ["Lock in / деньги", "сайты на продажу"]], ["AI automations to sell", "деньги и бизнес-идеи", ["другой бизнес", "Lock in / деньги"]],
  ["Figma plugin", "код и инструменты", ["сайты на продажу"]], ["Funny cat", "funny", ["разное"]], ["Lookbook design", "design references", ["сайты на продажу", "арт и портфолио"]],
];
rows.forEach(([title, theme, project], i) => tables.items.push({ id: i + 1, user_id: 1, status: "ok", title, summary: `${title} — gist`, tags: [], theme, project,
  content_type: "tip", input_kind: "tiktok", origin: "tiktok", archive_link: `https://t.me/c/1001/${i + 10}`, archive_file_ids: ["f"], input: {}, raw_meta: {} }));
tables.items.push({ id: 99, user_id: 1, status: "failed", title: null, summary: null, tags: [], theme: null, project: [], input_kind: "link", input: {}, raw_meta: {} });

// Fake Gemini: the plan for the current request, and sorting by the item title.
let plan: unknown = null;
let rawPlan: string | null = null;
const geminiCalls: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url, init);
  const body = JSON.parse(init.body);
  geminiCalls.push(body);
  const system = body.systemInstruction?.parts?.[0]?.text ?? "";
  let text: string;
  if (system.includes("reorganise")) text = rawPlan ?? JSON.stringify(plan);
  else {
    const qs = JSON.parse(body.contents[0].parts[0].text) as any[];
    text = JSON.stringify(qs.map((q) => {
      const t = q.title.toLowerCase();
      const area = /tea|muffin/.test(t) ? "food" : /gut|bloat/.test(t) ? "stomach" : /migraine/.test(t) ? "head" : /workout/.test(t) ? "sport" : undefined;
      return { id: q.id, ...(q.theme_from && { theme: q.theme_from[0] }), ...(q.projects_from && { projects: area ? [area] : [] }),
        ...(q.overlays && { overlays: /sell|clients|cold calling/.test(t) ? ["sales"] : [] }) };
    }));
  }
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] }), { headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { createBot } = await import("../src/bot.ts");
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: "archive", username: "archive_bot" } as any;
const calls: { method: string; p: any }[] = [];
bot.api.config.use(async (_prev, method, p: any) => {
  calls.push({ method, p });
  return { ok: true, result: ["answerCallbackQuery", "setMyCommands", "editMessageReplyMarkup"].includes(method) ? true : { message_id: 50 + calls.length, chat: { id: p.chat_id } } } as any;
});
bot.catch((e) => { throw e.error; });

let uid = 1;
const update = (message: object) => ({ update_id: uid++, message: { message_id: uid, date: 0, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false, first_name: "u" }, ...message } } as any);
const cmd = (text: string) => update({ text, entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] });
const cb = (data: string) => ({ update_id: uid++, callback_query: { id: String(uid), from: { id: OWNER, is_bot: false, first_name: "u" }, chat_instance: "x", data,
  message: { message_id: 5, date: 0, chat: { id: OWNER, type: "private" }, text: "x" } } } as any);
const texts = () => calls.filter((c) => ["sendMessage", "editMessageText"].includes(c.method)).map((c) => c.p.text as string);
const until = async (what: string, ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), `timeout: ${what}`);
};
const item = (id: number) => tables.items.find((i) => i.id === id)!;
const hasRussian = (s: string) => /[а-яё]/i.test(s);

// --- (a) In backticks, as the owner sent it: translate everything + split health, suggest more ---
plan = {
  projects: [
    { name: "Lock in / money", hint: "income, discipline", from: ["Lock in / деньги"] }, { name: "personal brand", hint: "", from: ["личный бренд"] },
    { name: "dropshipping", hint: "", from: ["дропшиппинг"] }, { name: "websites for sale", hint: "", from: ["сайты на продажу"] },
    { name: "art & portfolio", hint: "", from: ["арт и портфолио"] }, { name: "other business", hint: "", from: ["другой бизнес"] },
    { name: "stomach", hint: "digestion, gut", from: ["здоровье и быт"] }, { name: "head", hint: "headaches, brain, sleep", from: ["здоровье и быт"] },
    { name: "sport", hint: "workouts", from: ["здоровье и быт"] }, { name: "food", hint: "recipes, nutrition", from: ["здоровье и быт"] },
    { name: "skin & body care", hint: "suggested", from: ["здоровье и быт"] }, { name: "home", hint: "suggested", from: ["здоровье и быт"] },
    { name: "misc", hint: "", from: ["разное"] },
  ],
  themes: [
    { name: "typography & fonts", hint: "", from: ["typography & fonts"] }, { name: "design references", hint: "", from: ["design references"] },
    { name: "hooks & marketing", hint: "", from: ["hooks & marketing"] }, { name: "money & business ideas", hint: "", from: ["money & business ideas", "деньги и бизнес-идеи"] },
    { name: "code & tools", hint: "", from: ["code & tools", "код и инструменты"] }, { name: "study", hint: "", from: ["study"] },
    { name: "recipes", hint: "", from: ["recipes", "рецепты"] }, { name: "funny", hint: "", from: ["funny"] }, { name: "misc", hint: "", from: ["misc", "разное"] },
  ],
  changes: ["All names translated to English", "“health & home” split into stomach, head, sport, food", "Suggested: skin & body care, home"],
  problem: "",
};
const ownerText = "`/resort split` Переведи всё на английский \nздоровье и быт раздели: живот, голова, спорт, еда и прделожи если можешь";
const itemsBefore = tables.items.length;
await bot.handleUpdate(update({ text: ownerText, entities: [{ type: "code", offset: 0, length: 14 }] }));
await until("proposal (a)", () => calls.some((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "resort:ok"));
assert.equal(tables.items.length, itemsBefore, "the command must not be saved as an item");
const planReq = geminiCalls[0].contents[0].parts[0].text as string;
assert.match(planReq, /Переведи всё на английский/); assert.match(planReq, /split/);
assert.match(planReq, /"разное"/, "leftover names are given to the model");
const proposal = calls.find((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "resort:ok")!.p.text as string;
assert.match(proposal, /New structure/); assert.match(proposal, /split into stomach/);
assert.match(proposal, /Moving: 5 of 11 items/, proposal); // the 5 health items; everything else is a plain translation
assert.match(proposal, /new name only: 6/, proposal);
assert.ok(geminiCalls.length >= 2 && !JSON.parse(geminiCalls[1].contents[0].parts[0].text).some((q: any) => q.id === 99), "failed items are not sorted");
assert.equal(item(1).project[0], "здоровье и быт", "nothing changes before Apply");
console.log("✓ (a) `/resort …` in backticks works, not saved as an item; proposal: changes + “Moving: 5 of 11”, nothing applied yet");

await bot.handleUpdate(cb("resort:ok"));
await until("apply (a)", () => texts().some((t) => /Done/.test(t)));
const u = tables.users[0];
assert.ok(!Object.keys(u.projects).some(hasRussian) && !u.themes.some(hasRussian), JSON.stringify(u));
for (const it of tables.items.filter((i) => i.status === "ok")) {
  assert.ok(!hasRussian(it.theme) && !it.project.some(hasRussian), `item ${it.id}: ${it.theme} ${it.project}`);
}
assert.deepEqual(item(1).project, ["food"]); assert.equal(item(2).theme, "recipes"); assert.deepEqual(item(3).project, ["stomach"]);
assert.deepEqual(item(4).project, ["head"]); assert.equal(item(4).theme, "misc"); assert.deepEqual(item(5).project.sort(), ["Lock in / money", "sport"]);
assert.equal(item(8).theme, "money & business ideas"); assert.equal(item(9).theme, "code & tools"); assert.deepEqual(item(10).project, ["misc"]);
assert.equal(item(99).theme, null, "unanalysed items untouched");
assert.ok(calls.some((c) => c.method === "editMessageCaption" && /stomach/.test(c.p.caption)), "channel post headers updated");
console.log("✓ (a) after Apply: areas and topics all in English, health split by meaning, leftovers merged, channel headers updated");

// --- (b) "Выдели sales со всего": a cross-cutting area on top ---
plan = {
  projects: [...Object.keys(u.projects).map((name) => ({ name, hint: u.projects[name], from: [name] })).slice(0, -1),
    { name: "sales", hint: "selling, clients, pricing", from: [], overlay: true }, { name: "misc", hint: "", from: ["misc"] }],
  themes: u.themes.map((name: string) => ({ name, hint: "", from: [name] })),
  changes: ["New cross-cutting area “sales” on top of the others"], problem: "",
};
const before = new Map(tables.items.map((i) => [i.id, [...(i.project ?? [])]]));
await bot.handleUpdate(cmd("/resort Выдели sales со всего"));
await until("proposal (b)", () => calls.filter((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "resort:ok").length === 2);
const p2 = calls.filter((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "resort:ok")[1].p.text as string;
assert.match(p2, /Moving: 3 of 11/, p2); assert.match(p2, /sales \+3/); assert.match(p2, /sales ⤴/);
await bot.handleUpdate(cb("resort:ok"));
await until("apply (b)", () => texts().filter((t) => /Done/.test(t)).length === 2);
for (const id of [6, 7, 8]) assert.deepEqual(item(id).project, [...before.get(id)!, "sales"], `item ${id} keeps its areas + sales`);
for (const id of [1, 2, 3, 9, 10]) assert.deepEqual(item(id).project, before.get(id), `item ${id} unchanged`);
assert.ok("sales" in tables.users[0].projects);
console.log("✓ (b) “sales” pulled out of everything: 3 items get it on top of their areas, the rest untouched");

// --- Cancel, problem, unreadable answer, unknown command ---
await bot.handleUpdate(cmd("/resort rename misc to other"));
await until("proposal (c)", () => calls.filter((c) => c.p.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === "resort:ok").length === 3);
const snapshot = JSON.stringify(tables.items);
await bot.handleUpdate(cb("resort:no"));
await until("cancel", () => texts().some((t) => /cancelled/.test(t)));
assert.equal(JSON.stringify(tables.items), snapshot);

plan = { projects: [], themes: [], changes: [], problem: "Not clear which topic to split — name it." };
await bot.handleUpdate(cmd("/resort do something"));
await until("problem", () => texts().some((t) => /didn't work: Not clear which topic/.test(t)));

rawPlan = "Sure! Here is the structure: {projects: …";
const warned: string[] = [];
const warn = console.warn;
console.warn = (...a: any[]) => void warned.push(a.join(" "));
await bot.handleUpdate(cmd("/resort split funny"));
await until("bad json", () => texts().some((t) => /didn't work: the model returned an unreadable answer/.test(t)));
console.warn = warn;
assert.ok(warned.some((w) => w.includes("Sure! Here is the structure")), "raw model answer goes to the log");
console.log("✓ cancel changes nothing; a problem and an unreadable answer give a clear reason, the raw answer goes to the log");

const n = tables.items.length;
await bot.handleUpdate(cmd("/whatever"));
assert.equal(tables.items.length, n);
assert.match(texts().at(-1)!, /unknown command/);
console.log("✓ unknown /command is not saved as an item");
process.exit(0);
