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
  whyTags: { asset: "🧱 zdroj", strategy: "♟ strategie", ofst: "📰 OFST", content: "🎬 na obsah", interesting: "🤔 zajímavé" },
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
  tooBig: (limit) => `příliš velké (>${limit}) — nejde zpracovat`,
  tooBigN: (n, limit) => `${n} příliš velké (>${limit})`,
  units: { mb: "MB", gb: "GB" },
  dbDown: (hint) => `❌ neuloženo: databáze není dostupná (${hint})`,
  dbBadKey: "špatný SUPABASE_SERVICE_ROLE_KEY v .env",
  unknownCommand: "neznámý příkaz — seznam v /help",

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
  noPost: (reason) => `⚠️ uloženo, ale v archivním kanálu chybí příspěvek — ${reason}`,
  noChannel: "archivní kanál není připojen: přidej bota jako admina do soukromého kanálu",
  batch: { already: (n) => `${n} už bylo`, notParsed: (n) => `${n} nerozebráno`, saved: "uloženo", failedList: (r) => `⚠️ nerozebráno: ${r} · /retry`, noPost: (n) => `⚠️ ${n} bez příspěvku v kanálu` },

  card: {
    more: "📖 Víc", less: "🔼 Méně", transcript: "📜 Přepis", retry: "🔁 Znovu", repost: "📤 Zveřejnit v kanálu", reposted: "📤 zveřejněno v kanálu", repostFailed: (e) => `⚠️ nepodařilo se zveřejnit: ${e}`, edit: "✏️ Opravit",
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
    help: `<b>Co posílat</b>
🎵 tiktok, ▶️ youtube, 📸 reels, 🔗 jakýkoli odkaz, 👤 profil
🖼 snímky — po jednom nebo album až 10
🎙 hlasovky, ⭕️ videozprávy, 📝 text, ↪️ přeposlané zprávy

<b>Nápovědy v popisku</b> (mají přednost před odhadem bota)
„kvůli zvuku“, „formát“, „antipříklad“, „chci taky“, „profil“

<b>Co se děje</b>
Bot dá na tvou zprávu reakci: 👀 zpracovává se → 👌 hotovo, 🤷 chyba.
Všechno uložené je v archivním kanálu: příspěvek, karta v odpovědi, přepis.
Do chatu chodí jen chyby (stručně). Řádek s odkazem na příspěvek po každém uložení — přes /notify.

<b>Archiv</b> — tlačítko „Archiv“ vlevo od pole pro zprávu: přehled, filtry, hledání podle smyslu i slov, témata.

<b>Příkazy</b> — /retry zopakovat chyby · /resort přetřídit · /notify oznámení · /lang jazyk
Také: /status — bot a fronta · /reprocess — aktualizovat staré záznamy · /projects — moje oblasti`,
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
  notify: {
    choose: "Posílat do chatu řádek s odkazem na příspěvek po každém uložení?",
    on: "🔔 Posílat", off: "🔕 Neposílat",
    isOn: "🔔 Zapnuto: po uložení pošlu řádek s odkazem na příspěvek.",
    isOff: "🔕 Vypnuto: v chatu jen reakce a chyby, všechno ostatní je v archivním kanálu.",
  },
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
  resort: {
    usage: (l) => `Popiš slovy, jak přetřídit — v jakémkoli jazyce, klidně víc pokynů najednou: rozdělit, sloučit, přejmenovat, přeložit všechny názvy, přidat téma, „vytáhni X ze všeho“, „navrhni sám“. Například:
<code>/resort rozděl „studium“ na „UMPRUM“ a „státnice“</code>

Teď:
${l}`,
    thinking: "🧠 přemýšlím o struktuře…",
    counting: (i, n) => `📦 počítám, kolik záznamů se přesune… ${i}/${n}`,
    proposalTitle: "Nová struktura", changesTitle: "Co se mění",
    moved: (n, t) => `Přesune se: ${n} z ${t} záznamů`, renamedOnly: (n) => `jen nový název: ${n}`, lost: (l) => `bez nového místa: ${l} — jejich záznamy se rozřadí podle smyslu`,
    confirm: "Použít? Záznamy se přetřídí, popisky příspěvků v kanálu se aktualizují.",
    apply: "✅ Použít", cancel: "✖️ Zrušit", cancelled: "zrušeno, nic se nezměnilo", expired: "návrh už neplatí — pošli /resort znovu",
    failed: (r) => `⚠️ nepovedlo se: ${r}
Zkus to znovu nebo jinak.`,
    emptyLists: "model vrátil prázdný seznam", running: "přetřídění už běží — počkej na zprávu",
    progress: (i, n) => `🔀 přetřiďuji ${i}/${n}…`,
    done: (c, n) => `✅ <b>Hotovo</b>: změněno ${c} z ${n} záznamů, popisky v kanálu aktualizovány.`,
  },
  menuButton: "Archiv",
  commands: {
    retry: "zopakovat chyby a záznamy bez videa", resort: "přetřídit: popiš slovy, jak chceš",
    reprocess: "převést staré záznamy a příspěvky na nový formát",
    lang: "jazyk", notify: "řádek s odkazem na příspěvek po uložení", help: "jak používat",
  },
};
