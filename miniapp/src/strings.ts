// Mini App strings. Labels for types, sources, stance, value and card sections come from the bot's dictionaries (src/i18n).
export type S = {
  title: string; feed: string; topics: string; search: string; searching: string; nothing: string; more: string; all: string;
  filters: Record<"project" | "theme" | "type" | "value_in" | "stance" | "source", string>;
  blog: string; inBlog: string; toBlog: string; original: string; inChannel: string; summary: string; en: string;
  description: string; transcript: string; format: string; tags: string; reset: string; byMeaning: string;
  openInTelegram: string; notAllowed: string; noBotId: string; authFailed: string; failed: string; retry: string;
  projects: string; themes: string; items: (n: number) => string;
  source: string; save: string; namePlaceholder: string;
};

const ru: S = {
  source: "Источник", save: "Сохранить", namePlaceholder: "Имя в шапке (пусто — из Telegram)",
  title: "Архив", feed: "Лента", topics: "Темы", search: "Поиск — по смыслу и словам", searching: "ищу…", nothing: "ничего нет", more: "Ещё",
  all: "все", filters: { project: "Направление", theme: "Тема", type: "Тип", value_in: "Ценность", stance: "Отношение", source: "Источник" },
  blog: "В блог", inBlog: "★ в блоге", toBlog: "☆ В блог", original: "Оригинал ↗", inChannel: "В канале ↗", summary: "Суть", en: "English",
  description: "Описание оригинала", transcript: "Транскрипт", format: "Разбор формата", tags: "Теги", reset: "Сбросить", byMeaning: "по смыслу и словам",
  openInTelegram: "Открой архив из Telegram — кнопка «Архив» в чате с ботом.", notAllowed: "Нет доступа: попроси владельца добавить тебя (/adduser).",
  noBotId: "Перезапусти бота на Маке — он ещё не подключил архив.", authFailed: "Не получилось проверить вход. Закрой и открой архив заново.",
  failed: "Не загрузилось.", retry: "Повторить", projects: "Направления", themes: "Темы",
  items: (n) => `${n} ${pl("ru", n, ["запись", "записи", "записей"])}`,
};
const cs: S = {
  source: "Zdroj", save: "Uložit", namePlaceholder: "Jméno v záhlaví (prázdné — z Telegramu)",
  title: "Archiv", feed: "Přehled", topics: "Témata", search: "Hledat — podle smyslu i slov", searching: "hledám…", nothing: "nic tu není", more: "Další",
  all: "vše", filters: { project: "Oblast", theme: "Téma", type: "Typ", value_in: "Hodnota", stance: "Postoj", source: "Zdroj" },
  blog: "Do blogu", inBlog: "★ v blogu", toBlog: "☆ Do blogu", original: "Originál ↗", inChannel: "V kanálu ↗", summary: "Podstata", en: "English",
  description: "Popis originálu", transcript: "Přepis", format: "Rozbor formátu", tags: "Štítky", reset: "Zrušit", byMeaning: "podle smyslu i slov",
  openInTelegram: "Otevři archiv z Telegramu — tlačítko „Archiv“ v chatu s botem.", notAllowed: "Nemáš přístup: požádej majitele (/adduser).",
  noBotId: "Restartuj bota na Macu — archiv ještě nepřipojil.", authFailed: "Přihlášení se nepodařilo ověřit. Zavři a znovu otevři archiv.",
  failed: "Nenačetlo se.", retry: "Zkusit znovu", projects: "Oblasti", themes: "Témata",
  items: (n) => `${n} ${pl("cs", n, ["záznam", "záznamy", "záznamů"])}`,
};
const en: S = {
  source: "Source", save: "Save", namePlaceholder: "Name in the header (empty — from Telegram)",
  title: "Archive", feed: "Feed", topics: "Topics", search: "Search — by meaning and words", searching: "searching…", nothing: "nothing here", more: "More",
  all: "all", filters: { project: "Area", theme: "Topic", type: "Type", value_in: "Value", stance: "Attitude", source: "Source" },
  blog: "For blog", inBlog: "★ in blog", toBlog: "☆ For blog", original: "Original ↗", inChannel: "In channel ↗", summary: "Gist", en: "English",
  description: "Original description", transcript: "Transcript", format: "Format analysis", tags: "Tags", reset: "Reset", byMeaning: "by meaning and words",
  openInTelegram: "Open the archive from Telegram — the “Archive” button in the chat with the bot.", notAllowed: "No access: ask the owner to add you (/adduser).",
  noBotId: "Restart the bot on the Mac — it hasn't connected the archive yet.", authFailed: "Couldn't verify the login. Close and reopen the archive.",
  failed: "Didn't load.", retry: "Retry", projects: "Areas", themes: "Topics",
  items: (n) => `${n} ${n === 1 ? "item" : "items"}`,
};
const vi: S = {
  source: "Nguồn", save: "Lưu", namePlaceholder: "Tên trên đầu trang (trống — lấy từ Telegram)",
  title: "Lưu trữ", feed: "Dòng thời gian", topics: "Chủ đề", search: "Tìm — theo nghĩa và theo từ", searching: "đang tìm…", nothing: "chưa có gì", more: "Thêm",
  all: "tất cả", filters: { project: "Lĩnh vực", theme: "Chủ đề", type: "Loại", value_in: "Giá trị", stance: "Thái độ", source: "Nguồn" },
  blog: "Cho blog", inBlog: "★ trong blog", toBlog: "☆ Cho blog", original: "Bản gốc ↗", inChannel: "Trong kênh ↗", summary: "Ý chính", en: "English",
  description: "Mô tả gốc", transcript: "Bản ghi lời", format: "Phân tích định dạng", tags: "Thẻ", reset: "Bỏ lọc", byMeaning: "theo nghĩa và theo từ",
  openInTelegram: "Mở lưu trữ từ Telegram — nút “Lưu trữ” trong chat với bot.", notAllowed: "Không có quyền: nhờ chủ sở hữu thêm bạn (/adduser).",
  noBotId: "Khởi động lại bot trên Mac — bot chưa kết nối lưu trữ.", authFailed: "Không xác minh được đăng nhập. Đóng và mở lại.",
  failed: "Không tải được.", retry: "Thử lại", projects: "Lĩnh vực", themes: "Chủ đề",
  items: (n) => `${n} mục`,
};

function pl(lang: string, n: number, f: [string, string, string]) {
  const r = new Intl.PluralRules(lang).select(n);
  return r === "one" ? f[0] : r === "few" ? f[1] : f[2];
}

export const STRINGS: Record<string, S> = { ru, cs, en, vi };
export const strings = (lang: string) => STRINGS[lang] ?? ru;
