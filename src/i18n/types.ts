// Shape of a translation file. Every language must fill all of it (the compiler checks).
export type Lang = "ru" | "cs" | "en" | "vi";
export type Forms = { one: string; few?: string; many?: string; other: string };
type Fn1 = (a: string | number) => string;

export type Dict = {
  code: Lang;
  langName: string;
  flag: string;
  locale: string;          // for dates
  geminiLanguage: string;  // language name Gemini writes summaries in

  types: Record<"tip" | "recipe" | "idea" | "funny" | "reference" | "other", string>;
  sources: Record<string, string>;
  stance: Record<string, string>;
  value: Record<string, string>;
  defaultThemes: string[];   // last one = "misc"
  defaultProjects: string[]; // last one = "misc"

  forms: { points: Forms; steps: Forms; screens: Forms; items: Forms };

  btn: { recent: string; projects: string; themes: string; types: string; status: string; help: string };
  accepted: string;
  tooBig: string;
  tooBigN: Fn1;
  dbDown: Fn1;
  dbBadKey: string;

  stage: {
    download: string; read: string; think: string; thinkVideo: string; thinkImages: string; noVideo: string; format: string;
    retryIn: (reason: string, min: number) => string;
  };
  pendingNote: string;
  inArchive: string;
  dup: (date: string, times?: number) => string;
  stillProcessing: string;
  errors: { overloaded: string; quota: string; key: string; channel: string; json: string; network: string; unknown: string; other: Fn1 };
  failed: Fn1;
  batch: { already: Fn1; notParsed: Fn1; saved: string; failedList: Fn1 };

  card: {
    more: string; less: string; transcript: string; retry: string; edit: string; formatShow: string; formatRun: string; back: string;
    points: string; ingredients: string; steps: string; why: string; inFrame: string; move: string; comments: string; similar: string;
    moreItems: Fn1; tooLong: string; notFound: string; translating: string; noTranscript: string; transcriptTitle: string; saved: string;
    formatRunning: string; formatFailed: Fn1; videoUnavailable: string; editTitle: string; stanceLbl: string; valueLbl: string; formatTitle: string;
    hook: Record<
      "first_seconds" | "looks_accidental" | "probably_deliberate" | "how_hidden" | "mismatch" | "visual" | "audio" |
      "text_on_screen" | "emotion" | "format" | "edit" | "why_it_works" | "reusable_move", string>;
  };
  post: { source: string; why: string; followers: Fn1; company: string; person: string; description: string };

  ui: {
    start: string; startNoChannel: string; help: (b: Dict["btn"]) => string;
    chooseThemes: string; chooseTypes: string; chooseProjects: string; backThemes: string; backTypes: string; backProjects: string;
    empty: string; recentTitle: string; statusTitle: string; running: (time: string, h: number, m: number) => string;
    channelOk: Fn1; channelBad: Fn1; model: string; saved: string; queue: (q: number, p: number) => string; queueEmpty: string;
    pending: string; failedN: Fn1; last: string; refresh: string; retryN: Fn1; updated: string;
    retrying: string; retryingShort: string; notFailed: string; requeued: Fn1; nothingToRetry: string;
  };
  channel: { connected: Fn1; pressStart: string; disconnected: Fn1; notConnected: string; notAdmin: string; unavailable: string };
  lang: { choose: string; set: string };
  projects: { current: Fn1; set: Fn1 };
  admin: { usage: string; added: (id: number, lang: string) => string; exists: string; list: string };
  reprocess: {
    running: string; allDone: string; start: Fn1; progress: (i: number, n: number) => string;
    done: (ok: number, n: number) => string; edited: Fn1; reposted: Fn1; failed: Fn1;
  };
  commands: Record<"start" | "status" | "recent" | "project" | "theme" | "type" | "retry" | "reprocess" | "projects" | "lang" | "help", string>;
};
