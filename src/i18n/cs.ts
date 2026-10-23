import type { Dict } from "./types.js";

export const cs: Dict = {
  code: "cs",
  langName: "Čeština",
  flag: "🇨🇿",
  locale: "cs-CZ",
  geminiLanguage: "Czech",

  types: { tip: "tip", recipe: "recept", idea: "nápad", funny: "vtipné", reference: "reference", other: "jiné" },
  sources: {
    tiktok: "🎵 tiktok", youtube: "▶️ youtube", instagram: "📸 reels", link: "🔗 odkaz", text: "📝 text", forwarded: "↪️ přeposláno",
    screenshot: "🖼 snímek", voice: "🎙 hlasovka", audio: "🎧 audio", video: "🎬 video", video_note: "⭕️ videozpráva", document: "📄 soubor", profile: "👤 profil",
  },
  stance: {
    like: "❤️ líbí se", dislike: "👎 nelíbí se", anti_example: "🚫 antipříklad", replicate: "🎯 chci zopakovat",
    format_idea: "🧪 nápad na formát", seen_before: "👀 už jsem viděl(a)", example: "🔖 příklad", interesting: "🤔 zajímavé",
  },
  value: { info: "📚 info", visual: "🖼 obraz", audio: "🎧 zvuk", format: "🎬 formát", meta: "🧠 meta" },
  defaultThemes: ["typografie a písma", "designové reference", "háčky a marketing", "peníze a byznys nápady", "kód a nástroje", "studium", "recepty", "vtipné", "různé"],
  defaultProjects: ["práce", "škola", "podnikání", "tvorba", "zdraví a domácnost", "různé"],

  forms: {
    points: { one: "bod", few: "body", many: "bodu", other: "bodů" },
    steps: { one: "krok", few: "kroky", many: "kroku", other: "kroků" },
    screens: { one: "snímek", few: "snímky", many: "snímku", other: "snímků" },
    items: { one: "záznam", few: "záznamy", many: "záznamu", other: "záznamů" },
  },

  btn: { recent: "🕘 Poslední", projects: "🧭 Oblasti", themes: "🗂 Témata", types: "🏷 Typy", status: "📊 Stav", help: "❓ Nápověda" },
  accepted: "přijato",
  tooBig: "příliš velké (>20 MB) — nejde zpracovat",
  tooBigN: (n) => `${n} příliš velké (>20 MB)`,
  dbDown: (hint) => `❌ neuloženo: databáze není dostupná (${hint})`,
  dbBadKey: "špatný SUPABASE_SERVICE_ROLE_KEY v .env",

  stage: {
    download: "⬇️ stahuji…", read: "🔎 čtu…", think: "🧠 rozebírám…", thinkVideo: "🧠 rozebírám video…", thinkImages: "🧠 rozebírám obrázky…",
    noVideo: "🧠 video se nestáhlo, rozebírám popisek…", format: "🎬 rozebírám formát…",
    retryIn: (reason, min) => `⏳ ${reason} — zkusím znovu za ${min} min`,
  },
  pendingNote: "⏳ video se nestáhlo — odkaz a popisek jsou uložené, zkusím to znovu za den",
  inArchive: "🗄 v archivu",
  dup: (date, times) => `♻️ <b>opakování</b> — už uloženo ${date}${times && times > 2 ? ` · posíláš už po ${times}.` : ""}`,
  stillProcessing: "ještě se zpracovává…",
  errors: {
    overloaded: "Gemini je přetížené", quota: "limit požadavků Gemini", key: "klíč Gemini nefunguje", channel: "archivní kanál není dostupný",
    json: "model vrátil nesrozumitelnou odpověď", network: "není spojení", unknown: "neznámá chyba", other: (e) => `chyba: ${e}`,
  },
  failed: (reason) => `⚠️ nepodařilo se rozebrat — ${reason}\nodkaz je uložený · klepni na 🔁 nebo /retry`,
  batch: { already: (n) => `${n} už bylo`, notParsed: (n) => `${n} nerozebráno`, saved: "uloženo", failedList: (r) => `⚠️ nerozebráno: ${r} · /retry` },

  card: {
    more: "📖 Víc", less: "🔼 Méně", transcript: "📜 Přepis", retry: "🔁 Znovu", edit: "✏️ Opravit",
    formatShow: "🎬 Formát", formatRun: "🎬 Rozebrat formát", back: "← Zpět",
    points: "Body", ingredients: "Suroviny", steps: "Postup", why: "Proč pro mě", inFrame: "V záběru", move: "Trik",
    comments: "V komentářích", similar: "podobné jako", moreItems: (n) => `… a dalších ${n}`, tooLong: "(celé znění — v „Přepisu“)",
    notFound: "záznam nenalezen", translating: "překládám…", noTranscript: "přepis chybí", transcriptTitle: "📜 Přepis",
    saved: "uloženo", formatRunning: "rozebírám formát… asi minutu", formatFailed: (e) => `⚠️ formát se nepodařilo rozebrat: ${e}`,
    videoUnavailable: "video není dostupné", editTitle: "✏️ Opravit", stanceLbl: "Postoj", valueLbl: "Hodnota", formatTitle: "🎬 Rozbor formátu",
    hook: {
      first_seconds: "První sekundy", looks_accidental: "Vypadá náhodně", probably_deliberate: "Nejspíš záměr", how_hidden: "Jak je to schované",
      mismatch: "Co k sobě nesedí", visual: "Obraz", audio: "Zvuk", text_on_screen: "Text na obrazovce", emotion: "Zamýšlená reakce", format: "Formát",
      edit: "Střih", why_it_works: "Proč to funguje", reusable_move: "Trik pro sebe",
    },
  },
  post: { source: "zdroj", why: "Proč pro mě", followers: (n) => `${n} sledujících`, company: "🏢 firma", person: "🙂 člověk", description: "Popisek pod videem" },

  ui: {
    start: "Ahoj! Posílej sem odkazy, snímky obrazovky, hlasovky, text — rozeberu a uložím.\nTlačítka dole 👇",
    startNoChannel: "Aby se ukládaly originály, vytvoř soukromý kanál a přidej mě tam jako admina s právem publikovat.",
    help: (b) => `<b>Co posílat</b>
🎵 tiktok, ▶️ youtube, 📸 reels, 🔗 jakýkoli odkaz, 👤 profil
🖼 snímky — po jednom nebo album až 10
🎙 hlasovky, ⭕️ videozprávy, 📝 text, ↪️ přeposlané zprávy

<b>Nápovědy v popisku</b> (mají přednost před odhadem bota)
„kvůli zvuku“, „formát“, „antipříklad“, „chci taky“, „profil“

<b>Co se děje</b>
Bot odpoví „přijato“, pak se řádek mění: ⬇️ stahuji → 🧠 rozebírám → výsledek.
Když je Gemini přetížené, bot to za pár minut zkusí znovu. Nevyšlo to — 🔁 nebo /retry.

<b>Tlačítka dole</b>
${b.recent} — posledních 10 záznamů
${b.projects} — podle oblasti života
${b.themes} / ${b.types} — podle tématu (o čem) nebo typu (co to je)
${b.status} — bot, kanál, fronta, chyby

/retry — zopakovat chyby · /reprocess — aktualizovat staré záznamy
/projects — tvoje oblasti · /lang — jazyk`,
    chooseThemes: "🗂 Témata — vyber:", chooseTypes: "🏷 Typy — vyber:", chooseProjects: "🧭 Oblasti — vyber:",
    backThemes: "← Témata", backTypes: "← Typy", backProjects: "← Oblasti",
    empty: "zatím nic", recentTitle: "🕘 Poslední", statusTitle: "📊 Stav",
    running: (time, h, m) => `🟢 bot běží od ${time} (${h ? `${h} h ` : ""}${m} min)`,
    channelOk: (t) => `🗄 archivní kanál: ${t} ✓`, channelBad: (p) => `⚠️ archivní kanál ${p}`, model: "🧠 model",
    saved: "📦 uloženo", queue: (q, p) => `⏳ ve frontě: ${q} · zpracovává se: ${p}`, queueEmpty: "⏳ fronta je prázdná",
    pending: "🎞 bez videa (zkouší se denně)", failedN: (n) => `❌ s chybou: ${n} — důvod je v kartě, zopakovat: /retry`,
    last: "🕘 poslední", refresh: "🔄 Obnovit", retryN: (n) => `🔁 Zopakovat (${n})`, updated: "obnoveno",
    retrying: "🔁 zkouším znovu…", retryingShort: "zkouším znovu", notFailed: "už není v chybě",
    requeued: (n) => `🔁 ${n} znovu ve frontě`, nothingToRetry: "není co opakovat — žádné chyby",
  },
  channel: {
    connected: (t) => `🗄 archivní kanál připojen: ${t}`,
    pressStart: "Napiš botovi /start v soukromém chatu — tam budou chodit odpovědi.",
    disconnected: (t) => `⚠️ bot už není adminem v „${t}“ — archivní kanál odpojen`,
    notConnected: "není připojen: přidej bota jako admina do soukromého kanálu",
    notAdmin: "— bot tam není admin nebo nemůže publikovat",
    unavailable: "není dostupný — odeber bota z adminů kanálu a přidej ho znovu",
  },
  lang: { choose: "Vyber jazyk:", set: "Jazyk: čeština 🇨🇿" },
  projects: {
    current: (l) => `🧭 Tvoje oblasti:\n${l}\n\nZměnit: /projects práce, škola, koníčky, různé`,
    set: (l) => `✅ Oblasti aktualizovány:\n${l}\n\nNové záznamy se podle nich roztřídí; staré po /reprocess all.`,
  },
  admin: {
    usage: "/adduser <telegram_id> [ru|cs|en|vi]",
    added: (id, l) => `✅ uživatel ${id} přidán (jazyk ${l}). Ať otevře bota, dá /start a pak přidá bota jako admina do svého soukromého kanálu.`,
    exists: "tento uživatel už existuje",
    list: "👥 Uživatelé",
  },
  reprocess: {
    running: "už to běží — počkej na zprávu",
    allDone: "všechny záznamy už jsou v novém formátu. Vynutit: /reprocess all",
    start: (n) => `🔄 znovu zpracovávám ${n}… zabere to pár minut, zprávu pošlu sem`,
    progress: (i, n) => `🔄 zpracovávám ${i}/${n}…`,
    done: (ok, n) => `✅ <b>zpracováno: ${ok} z ${n}</b>`,
    edited: (n) => `✏️ přepsané příspěvky v kanálu: ${n}`,
    reposted: (n) => `📤 <b>zveřejněno znovu</b> (starý příspěvek nešel upravit nebo neexistoval): ${n}`,
    failed: (n) => `⚠️ <b>nepovedlo se</b>: ${n}`,
  },
  commands: {
    start: "zobrazit tlačítka", status: "stav bota, kanálu a fronty", recent: "posledních 10 záznamů",
    project: "záznamy podle oblasti", theme: "záznamy podle tématu", type: "záznamy podle typu", retry: "zopakovat chyby a záznamy bez videa",
    reprocess: "aktualizovat staré záznamy na nový formát", projects: "moje oblasti", lang: "jazyk", help: "jak používat",
  },
};
