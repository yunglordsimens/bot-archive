// Dev only (mock.html): fake Telegram WebApp + fake Edge Function, to look at the Mini App in a normal browser.
const light = location.search.includes("theme=light");
const theme: Record<string, string> = light
  ? { bg_color: "#ffffff", secondary_bg_color: "#f1f1f4", text_color: "#000000", hint_color: "#8e8e93", button_color: "#2481cc", button_text_color: "#ffffff", section_separator_color: "#e5e5ea" }
  : { bg_color: "#18222d", secondary_bg_color: "#131a22", text_color: "#ffffff", hint_color: "#b1c3d5", button_color: "#2ea6ff", button_text_color: "#ffffff", section_separator_color: "#213040" };
for (const [k, v] of Object.entries(theme)) document.documentElement.style.setProperty(`--tg-theme-${k.replace(/_/g, "-")}`, v);

const log = (...a: unknown[]) => console.log("[tg]", ...a);
const back = new Set<() => void>();
(window as any).Telegram = {
  WebApp: {
    initData: "mock", initDataUnsafe: { user: { id: 1, first_name: "Masha", username: "masha" } },
    themeParams: theme, colorScheme: light ? "light" : "dark",
    ready() {}, expand() {}, isVersionAtLeast: () => true, onEvent() {}, offEvent() {},
    setHeaderColor: (c: string) => log("header", c), setBackgroundColor: (c: string) => log("background", c), setBottomBarColor: (c: string) => log("bottom bar", c),
    openLink: (u: string) => log("openLink", u), openTelegramLink: (u: string) => log("openTelegramLink", u),
    BackButton: { show: () => log("back shown"), hide: () => log("back hidden"), onClick: (f: () => void) => back.add(f), offClick: (f: () => void) => back.delete(f) },
    HapticFeedback: { impactOccurred() {} },
  },
};
(window as any).tgBack = () => back.forEach((f) => f()); // press Telegram's Back button from the console / tests

const frame = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${c}"/></svg>`)}`;
const rows = [
  { id: 465, title: "Conversion Loop System (CLS) for Brand Marketing", author: "brandlab", theme: "hooks & marketing", project: ["personal brand", "sites for sale"], content_type: "tip", input_kind: "video", origin: "telegram", stance: "like", value_in: ["info"], preview: frame("#7a4b2a") },
  { id: 466, title: "Building Automated Business Systems Instead of Basic Website", author: null, theme: "money & business ideas", project: ["sites for sale"], content_type: "idea", input_kind: "video", origin: "telegram", stance: "replicate", value_in: ["info", "format"], preview: frame("#2a4b7a") },
  { id: 452, title: "7 Rules of Sales Psychology", author: "salesguy", theme: "hooks & marketing", project: ["Lock in / money"], content_type: "tip", input_kind: "tiktok", origin: "tiktok", stance: "like", value_in: ["info"], preview: null },
].map((r) => ({ created_at: "2026-10-24T09:03:30Z", summary: "", for_blog: false, status: "ok", published_at: null, ...r }));
let displayName: string | null = null;

const realFetch = window.fetch.bind(window);
window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (!String(url).includes("/functions/v1/archive")) return realFetch(url, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const ok = (x: unknown) => new Response(JSON.stringify(x), { headers: { "Content-Type": "application/json" } });
  switch (body.action) {
    case "init":
      return ok({ user: { name: "owner", display_name: displayName, lang: "ru", projects: null }, search: true, facets: {
        total: 288, blog: 2, counts: {
          project: { "Lock in / money": 61, "personal brand": 48, "sites for sale": 40, "health & daily": 22, misc: 30 },
          theme: { "hooks & marketing": 80, "money & business ideas": 55, "design references": 42, recipes: 12, misc: 20 },
          type: { tip: 120, idea: 60, reference: 50, funny: 20, other: 38 }, source: { tiktok: 190, video: 18, instagram: 40, link: 40 },
          stance: { like: 200, replicate: 40, anti_example: 8 }, value_in: { info: 220, format: 60, visual: 40 },
        } } });
    case "name":
      displayName = String(body.value ?? "").trim() || null;
      return ok({ display_name: displayName });
    case "feed": {
      const f = body.filters ?? {};
      const items = rows.filter((r) => (!f.project || r.project.includes(f.project)) && (!f.theme || r.theme === f.theme));
      return ok({ items, more: false, semantic: false });
    }
    case "item": {
      const r = rows.find((x) => x.id === body.id)!;
      return ok({ item: { ...r, occurred_at: null, caption: "Описание из-под видео", why_me: "Пересобрать воронку для сайтов на продажу.", why_tags: ["strategy"],
        visual_description: "Девушка говорит в камеру", comments_note: null, hook: null, my_note: null, tags: ["маркетинг"], structured: { points: ["Пункт один", "Пункт два"] },
        raw_text: "Транскрипт…", archive_link: "https://t.me/c/4427399044/1010", source_url: r.origin === "tiktok" ? "https://www.tiktok.com/@salesguy/video/1" : null,
        raw_meta: { author: r.author ? { name: "Sales Guy", handle: r.author, followers: 12345 } : undefined } } });
    }
  }
  return ok({});
}) as typeof fetch;
