import type { Dict } from "./types.js";

export const en: Dict = {
  code: "en",
  langName: "English",
  flag: "🇬🇧",
  locale: "en-GB",
  geminiLanguage: "English",

  types: { tip: "tip", recipe: "recipe", idea: "idea", funny: "funny", reference: "reference", other: "other" },
  sources: {
    tiktok: "🎵 tiktok", youtube: "▶️ youtube", instagram: "📸 reels", link: "🔗 link", text: "📝 text", forwarded: "↪️ forwarded",
    screenshot: "🖼 screenshot", voice: "🎙 voice", audio: "🎧 audio", video: "🎬 video", video_note: "⭕️ video note", document: "📄 file", profile: "👤 profile",
  },
  stance: {
    like: "❤️ like", dislike: "👎 dislike", anti_example: "🚫 anti-example", replicate: "🎯 want to replicate",
    format_idea: "🧪 format idea", seen_before: "👀 seen before", example: "🔖 example", interesting: "🤔 interesting",
  },
  value: { info: "📚 info", visual: "🖼 visual", audio: "🎧 audio", format: "🎬 format", meta: "🧠 meta" },
  whyTags: { asset: "🧱 asset", strategy: "♟ strategy", ofst: "📰 OFST", content: "🎬 for content", interesting: "🤔 interesting" },
  defaultThemes: ["typography & fonts", "design references", "hooks & marketing", "money & business ideas", "code & tools", "study", "recipes", "funny", "misc"],
  defaultProjects: ["work", "study", "business ideas", "creative", "health & home", "misc"],

  forms: {
    points: { one: "point", other: "points" },
    steps: { one: "step", other: "steps" },
    screens: { one: "screenshot", other: "screenshots" },
    items: { one: "item", other: "items" },
  },

  btn: { recent: "🕘 Recent", projects: "🧭 Areas", themes: "🗂 Topics", types: "🏷 Types", status: "📊 Status", help: "❓ Help" },
  accepted: "received",
  tooBig: (limit) => `too big (>${limit}) — can't process`,
  tooBigN: (n, limit) => `${n} too big (>${limit})`,
  units: { mb: "MB", gb: "GB" },
  dbDown: (hint) => `❌ not saved: database unavailable (${hint})`,
  dbBadKey: "wrong SUPABASE_SERVICE_ROLE_KEY in .env",
  unknownCommand: "unknown command — see /help",

  stage: {
    download: "⬇️ downloading…", read: "🔎 reading…", think: "🧠 analysing…", thinkVideo: "🧠 analysing the video…", thinkImages: "🧠 analysing the images…",
    noVideo: "🧠 video didn't download, analysing the caption…", format: "🎬 analysing the format…",
    retryIn: (reason, min) => `⏳ ${reason} — retrying in ${min} min`,
  },
  pendingNote: "⏳ the video didn't download — link and caption saved, will retry in a day",
  inArchive: "🗄 in archive",
  dup: (date, times) => `♻️ <b>repeat</b> — already saved ${date}${times && times > 2 ? ` · sent ${times} times now` : ""}`,
  stillProcessing: "still processing…",
  errors: {
    overloaded: "Gemini is overloaded", quota: "Gemini rate limit", key: "Gemini key doesn't work", channel: "archive channel unavailable",
    json: "the model returned an unreadable answer", network: "no connection", unknown: "unknown error", other: (e) => `error: ${e}`,
  },
  failed: (reason) => `⚠️ couldn't analyse — ${reason}\nlink saved · tap 🔁 or /retry`,
  noPost: (reason) => `⚠️ saved, but there is no post in the archive channel — ${reason}`,
  noChannel: "archive channel not connected: add the bot as an admin to a private channel",
  batch: { already: (n) => `${n} already saved`, notParsed: (n) => `${n} not analysed`, saved: "saved", failedList: (r) => `⚠️ not analysed: ${r} · /retry`, noPost: (n) => `⚠️ ${n} without a channel post` },

  card: {
    more: "📖 More", less: "🔼 Less", transcript: "📜 Transcript", retry: "🔁 Retry", repost: "📤 Post to channel", reposted: "📤 posted to the channel", repostFailed: (e) => `⚠️ couldn't post: ${e}`, edit: "✏️ Correct",
    formatShow: "🎬 Format", formatRun: "🎬 Analyse format", back: "← Back",
    points: "Key points", ingredients: "Ingredients", steps: "Steps", why: "Why me", inFrame: "In the frame", move: "Trick",
    comments: "In the comments", similar: "similar to", moreItems: (n) => `… ${n} more`, tooLong: "(full text — in “Transcript”)",
    notFound: "item not found", translating: "translating…", noTranscript: "no transcript", transcriptTitle: "📜 Transcript",
    saved: "saved", formatRunning: "analysing the format… ~a minute", formatFailed: (e) => `⚠️ couldn't analyse the format: ${e}`,
    videoUnavailable: "video unavailable", editTitle: "✏️ Correct", stanceLbl: "Attitude", valueLbl: "Value", formatTitle: "🎬 Format analysis",
    hook: {
      first_seconds: "First seconds", looks_accidental: "Looks accidental", probably_deliberate: "Probably deliberate", how_hidden: "How it's hidden",
      mismatch: "What doesn't fit", visual: "Visual", audio: "Audio", text_on_screen: "On-screen text", emotion: "Intended reaction", format: "Format",
      edit: "Editing", why_it_works: "Why it works", reusable_move: "Trick to reuse",
    },
  },
  post: { source: "source", why: "Why me", followers: (n) => `${n} followers`, company: "🏢 company", person: "🙂 person", description: "Original description" },

  ui: {
    start: "Hi! Send me links, screenshots, voice messages, text — I'll analyse and save them.\nButtons below 👇",
    startNoChannel: "To keep the originals, create a private channel and add me there as an admin who can post.",
    help: `<b>What to send</b>
🎵 tiktok, ▶️ youtube, 📸 reels, 🔗 any link, 👤 profile
🖼 screenshots — one by one or an album of up to 10
🎙 voice, ⭕️ video notes, 📝 text, ↪️ forwarded messages

<b>Hints in the caption</b> (beat the bot's guess)
“for the sound”, “format”, “anti-example”, “want the same”, “profile”

<b>What happens</b>
The bot reacts to your message: 👀 working → 👌 done, 🤷 error.
Everything saved lives in the archive channel: the post, the card as a reply, the transcript.
The chat only gets errors (short). A line with a link to the post after each save — via /notify.

<b>Archive</b> — the “Archive” button left of the message field: feed, filters, search by meaning and words, topics.

<b>Commands</b> — /retry retry errors · /resort re-sort · /notify notifications · /lang language
Also: /status — bot and queue · /reprocess — update old items · /projects — your areas`,
    chooseThemes: "🗂 Topics — pick one:", chooseTypes: "🏷 Types — pick one:", chooseProjects: "🧭 Areas — pick one:",
    backThemes: "← Topics", backTypes: "← Types", backProjects: "← Areas",
    empty: "nothing yet", recentTitle: "🕘 Recent", statusTitle: "📊 Status",
    running: (time, h, m) => `🟢 bot running since ${time} (${h ? `${h} h ` : ""}${m} min)`,
    channelOk: (t) => `🗄 archive channel: ${t} ✓`, channelBad: (p) => `⚠️ archive channel ${p}`, model: "🧠 model",
    saved: "📦 saved", queue: (q, p) => `⏳ queued: ${q} · in progress: ${p}`, queueEmpty: "⏳ queue is empty",
    pending: "🎞 without video (retried daily)", failedN: (n) => `❌ with errors: ${n} — reason in the card, retry: /retry`,
    last: "🕘 latest", refresh: "🔄 Refresh", retryN: (n) => `🔁 Retry (${n})`, updated: "updated",
    retrying: "🔁 retrying…", retryingShort: "retrying", notFailed: "not failed anymore",
    requeued: (n) => `🔁 ${n} back in the queue`, nothingToRetry: "nothing to retry — no errors",
  },
  channel: {
    connected: (t) => `🗄 archive channel connected: ${t}`,
    pressStart: "Send /start to the bot in a private chat — replies go there.",
    disconnected: (t) => `⚠️ the bot is no longer an admin in “${t}” — archive channel disconnected`,
    notConnected: "not connected: add the bot as an admin to a private channel",
    notAdmin: "— the bot isn't an admin there or can't post",
    unavailable: "unavailable — remove the bot from the channel admins and add it again",
  },
  lang: { choose: "Choose a language:", set: "Language: English 🇬🇧" },
  notify: {
    choose: "Send a line with a link to the post into the chat after each save?",
    on: "🔔 Send", off: "🔕 Don't send",
    isOn: "🔔 On: after saving I'll send a line with a link to the post.",
    isOff: "🔕 Off: the chat only gets reactions and errors, everything else is in the archive channel.",
  },
  pause: {
    on: "⏸ paused: new items are saved, downloaded and posted to the channel as originals (😴 on the message), nothing goes to Gemini. Continue: /resume",
    off: (n) => `▶️ resumed: ${n} queued for analysis`,
    already: "already paused — continue: /resume", notPaused: "not paused",
    usage: "/pause or /resume — for yourself; owner: /pause <telegram_id> — for another user",
    noUser: "no such user — see /users",
    status: (n) => `⏸ paused — waiting for analysis: ${n} · /resume`,
  },
  projects: {
    current: (l) => `🧭 Your areas:\n${l}\n\nChange: /projects work, study, hobby, misc`,
    set: (l) => `✅ Areas updated:\n${l}\n\nNew items will use them; old ones after /reprocess all.`,
  },
  admin: {
    usage: "/adduser <telegram_id> [ru|cs|en|vi]",
    added: (id, l) => `✅ user ${id} added (language ${l}). They should open the bot, press /start, then add the bot as an admin to their own private channel.`,
    exists: "this user already exists",
    list: "👥 Users",
  },
  reprocess: {
    running: "already running — wait for the report",
    allDone: "all items are already in the new format. Force: /reprocess all",
    start: (n) => `🔄 reprocessing ${n}… takes a couple of minutes, the report will come here`,
    progress: (i, n) => `🔄 reprocessing ${i}/${n}…`,
    done: (ok, n) => `✅ <b>reprocessed: ${ok} of ${n}</b>`,
    edited: (n) => `✏️ channel posts rewritten: ${n}`,
    reposted: (n) => `📤 <b>posted again</b> (the old post couldn't be edited or didn't exist): ${n}`,
    failed: (n) => `⚠️ <b>failed</b>: ${n}`,
  },
  resort: {
    usage: (l) => `Describe how to re-sort — any language, several instructions at once: split, merge, rename, translate all names, add a topic, “pull X out of everything”, “suggest yourself”. For example:
<code>/resort split “health & home” into stomach, head, sport, food</code>

Now:
${l}`,
    thinking: "🧠 thinking about the structure…",
    counting: (i, n) => `📦 counting how many items move… ${i}/${n}`,
    proposalTitle: "New structure", changesTitle: "What changes",
    moved: (n, t) => `Moving: ${n} of ${t} items`, renamedOnly: (n) => `new name only: ${n}`, lost: (l) => `no new place for: ${l} — their items get sorted by meaning`,
    confirm: "Apply? Items get re-sorted, channel post captions get updated.",
    apply: "✅ Apply", cancel: "✖️ Cancel", cancelled: "cancelled, nothing changed", expired: "the proposal expired — send /resort again",
    failed: (r) => `⚠️ didn't work: ${r}
Try again or word it differently.`,
    emptyLists: "the model returned an empty list", running: "re-sorting is already running — wait for the report",
    progress: (i, n) => `🔀 re-sorting ${i}/${n}…`,
    done: (c, n) => `✅ <b>Done</b>: ${c} of ${n} items changed, channel post captions updated.`,
  },
  menuButton: "Archive",
  commands: {
    pause: "pause: no Gemini, only save", resume: "continue analysis",
    retry: "retry errors and items without video", resort: "re-sort: describe how you want it",
    reprocess: "bring old items and posts to the current format",
    lang: "language", notify: "a line with a link to the post after saving", help: "how to use",
  },
};
