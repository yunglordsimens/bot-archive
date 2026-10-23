import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, tr, type Dict } from "../../src/i18n/index.ts";
import { ApiError, call, initData, tg, type Facets, type Feed, type Filters, type Full, type Init, type Row } from "./api.ts";
import { strings, type S } from "./strings.ts";

type FilterKey = keyof S["filters"];
const FILTER_KEYS: FilterKey[] = ["project", "theme", "type", "value_in", "stance", "source"];

// Same rule as the bot (format.ts sourceLabel) and the SQL feed.
const sourceKey = (r: Pick<Row, "input_kind" | "origin">) => (r.input_kind === "link" && r.origin && r.origin !== "other" ? r.origin : r.input_kind);

function label(d: Dict, k: FilterKey, v: string): string {
  if (k === "type") return d.types[v as keyof Dict["types"]] ?? v;
  if (k === "source") return d.sources[v] ?? v;
  if (k === "stance") return (d.stance as Record<string, string>)[v] ?? v;
  if (k === "value_in") return (d.value as Record<string, string>)[v] ?? v;
  return v;
}

const isTgLink = (u: string) => /^https:\/\/t\.me\//.test(u);
function open(url: string) {
  if (tg && isTgLink(url)) tg.openTelegramLink(url);
  else if (tg) tg.openLink(url);
  else window.open(url, "_blank");
}

export function App() {
  const [init, setInit] = useState<Init>();
  const [error, setError] = useState<string>();
  const lang = init?.user.lang ?? tg?.initDataUnsafe?.user?.language_code ?? "ru";
  const s = strings(lang);
  const d = tr(lang);

  const load = useCallback(() => {
    setError(undefined);
    call<Init>("init").then(setInit, (e) => setError(e instanceof ApiError ? e.code : "network"));
  }, []);
  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#0d0d0e");
    tg?.setBackgroundColor?.("#0d0d0e");
    if (initData) load();
  }, [load]);

  if (!initData) return <Message text={s.openInTelegram} />;
  if (error) {
    const text = error === "not_allowed" ? s.notAllowed : error === "no_bot_id" ? s.noBotId : error === "auth" ? s.authFailed : s.failed;
    return <Message text={text} action={error === "network" || error.startsWith("http") ? { label: s.retry, run: load } : undefined} />;
  }
  if (!init) return <div className="center muted">…</div>;
  return <Archive init={init} s={s} d={d} reloadFacets={load} />;
}

function Message({ text, action }: { text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="center">
      <p className="message">{text}</p>
      {action && <button className="btn" onClick={action.run}>{action.label}</button>}
    </div>
  );
}

function Archive({ init, s, d, reloadFacets }: { init: Init; s: S; d: Dict; reloadFacets: () => void }) {
  const [tab, setTab] = useState<"feed" | "topics">("feed");
  const [filters, setFilters] = useState<Filters>({});
  const [openId, setOpenId] = useState<number>();
  const [blogMarks, setBlogMarks] = useState<Record<number, boolean>>({}); // toggled in the card, reflected in the feed

  // Telegram's Back button closes the card.
  useEffect(() => {
    if (!tg?.BackButton) return;
    const back = () => setOpenId(undefined);
    if (openId) {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    } else tg.BackButton.hide();
    return () => tg.BackButton.offClick(back);
  }, [openId]);

  const pick = (k: FilterKey, v: string) => {
    setFilters({ [k]: v });
    setTab("feed");
  };

  return (
    <>
      <div style={{ display: openId ? "none" : undefined }}>
        {tab === "feed"
          ? <FeedView s={s} d={d} facets={init.facets} filters={filters} setFilters={setFilters} onOpen={setOpenId} blogMarks={blogMarks} />
          : <TopicsView s={s} facets={init.facets} onPick={pick} />}
        <nav className="tabs">
          <button className={tab === "feed" ? "on" : ""} onClick={() => setTab("feed")}>{s.feed}</button>
          <button className={tab === "topics" ? "on" : ""} onClick={() => setTab("topics")}>{s.topics}</button>
        </nav>
      </div>
      {openId && (
        <ItemView id={openId} s={s} d={d} onTag={(k, v) => { setOpenId(undefined); pick(k, v); }}
          onBlog={(v) => { setBlogMarks((m) => ({ ...m, [openId]: v })); reloadFacets(); }} />
      )}
    </>
  );
}

function FeedView({ s, d, facets, filters, setFilters, onOpen, blogMarks }: {
  s: S; d: Dict; facets: Facets; filters: Filters; setFilters: (f: Filters) => void; onOpen: (id: number) => void; blogMarks: Record<number, boolean>;
}) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // debounced
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<FilterKey>();
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback((offset: number) => {
    const my = ++seq.current;
    setLoading(true);
    setFailed(false);
    call<Feed>("feed", { filters, q: query, offset })
      .then((r) => {
        if (my !== seq.current) return;
        setRows((old) => (offset ? [...old, ...r.items] : r.items));
        setMore(r.more);
      }, () => my === seq.current && setFailed(true))
      .finally(() => my === seq.current && setLoading(false));
  }, [filters, query]);

  useEffect(() => {
    setRows([]);
    fetchPage(0);
    window.scrollTo(0, 0);
  }, [fetchPage]);

  // Next page when the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more || loading || !end.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && fetchPage(rows.length), { rootMargin: "400px" });
    io.observe(end.current);
    return () => io.disconnect();
  }, [more, loading, rows.length, fetchPage]);

  const active = FILTER_KEYS.filter((k) => filters[k]);
  return (
    <main className="page">
      <header className="head">
        <h1>{s.title}</h1>
        <span className="muted">{s.items(facets.total)}</span>
      </header>
      <div className="search">
        <input type="search" value={q} placeholder={s.search} enterKeyHint="search"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setQuery(q.trim()), (e.target as HTMLInputElement).blur())} />
        {q && <button className="clear" onClick={() => setQ("")} aria-label="×">×</button>}
      </div>
      <div className="chips">
        {FILTER_KEYS.filter((k) => Object.keys(facets.counts[k] ?? {}).length > 1 || filters[k]).map((k) => (
          <button key={k} className={`chip ${filters[k] ? "on" : ""}`} onClick={() => setSheet(k)}>
            {filters[k] ? label(d, k, filters[k]!) : s.filters[k]}
          </button>
        ))}
        {facets.blog > 0 || filters.blog ? (
          <button className={`chip ${filters.blog ? "on" : ""}`} onClick={() => setFilters({ ...filters, blog: !filters.blog })}>{s.blog}</button>
        ) : null}
        {(active.length > 0 || filters.blog) && <button className="chip ghost" onClick={() => setFilters({})}>{s.reset}</button>}
      </div>

      {rows.map((r) => <RowView key={r.id} r={{ ...r, for_blog: blogMarks[r.id] ?? r.for_blog }} d={d} onOpen={onOpen} />)}
      {loading && <p className="muted pad">{query ? s.searching : "…"}</p>}
      {!loading && failed && <p className="muted pad">{s.failed} <button className="link" onClick={() => fetchPage(rows.length)}>{s.retry}</button></p>}
      {!loading && !failed && !rows.length && <p className="muted pad">{s.nothing}</p>}
      <div ref={end} />

      {sheet && (
        <Sheet title={s.filters[sheet]} onClose={() => setSheet(undefined)}>
          <button className={`opt ${!filters[sheet] ? "on" : ""}`} onClick={() => { setFilters({ ...filters, [sheet]: undefined }); setSheet(undefined); }}>
            <span>{s.all}</span>
          </button>
          {Object.entries(facets.counts[sheet] ?? {}).sort((a, b) => b[1] - a[1]).map(([v, n]) => (
            <button key={v} className={`opt ${filters[sheet] === v ? "on" : ""}`} onClick={() => { setFilters({ ...filters, [sheet]: v }); setSheet(undefined); }}>
              <span>{label(d, sheet, v)}</span><span className="muted">{n}</span>
            </button>
          ))}
        </Sheet>
      )}
    </main>
  );
}

function RowView({ r, d, onOpen }: { r: Row; d: Dict; onOpen: (id: number) => void }) {
  const tags = [r.theme, ...(r.project ?? [])].filter(Boolean).join(" · ");
  return (
    <button className="row" onClick={() => onOpen(r.id)}>
      <Thumb src={r.preview} fallback={d.sources[sourceKey(r)]?.split(" ")[0] ?? "•"} />
      <div className="row-text">
        <div className="row-title">{r.title ?? r.summary?.slice(0, 80) ?? "—"}</div>
        <div className="row-meta muted">
          {r.author && <span>@{r.author.replace(/^@/, "")} · </span>}
          {fmtDate(d, r.created_at)}{r.for_blog && " · ★"}
        </div>
        {tags && <div className="row-tags">{tags}</div>}
      </div>
    </button>
  );
}

function Thumb({ src, fallback, big }: { src: string | null; fallback: string; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img className={big ? "hero" : "thumb"} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return big ? null : <div className="thumb empty">{fallback}</div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{title}</div>
        <div className="sheet-list">{children}</div>
      </div>
    </div>
  );
}

function TopicsView({ s, facets, onPick }: { s: S; facets: Facets; onPick: (k: FilterKey, v: string) => void }) {
  const group = (k: "project" | "theme", title: string) => {
    const list = Object.entries(facets.counts[k] ?? {}).sort((a, b) => b[1] - a[1]);
    if (!list.length) return null;
    return (
      <section className="topics">
        <h2>{title}</h2>
        {list.map(([v, n]) => (
          <button key={v} className="topic" onClick={() => onPick(k, v)}>
            <span>{v}</span><span className="muted">{n}</span>
          </button>
        ))}
      </section>
    );
  };
  return (
    <main className="page">
      <header className="head"><h1>{s.topics}</h1></header>
      {group("project", s.projects)}
      {group("theme", s.themes)}
    </main>
  );
}

function ItemView({ id, s, d, onTag, onBlog }: { id: number; s: S; d: Dict; onTag: (k: FilterKey, v: string) => void; onBlog: (v: boolean) => void }) {
  const [it, setIt] = useState<Full>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    call<{ item: Full }>("item", { id }).then((r) => setIt(r.item), () => setFailed(true));
  }, [id]);

  const toggleBlog = async () => {
    if (!it || busy) return;
    setBusy(true);
    tg?.HapticFeedback?.impactOccurred?.("light");
    try {
      const r = await call<{ for_blog: boolean }>("blog", { id, value: !it.for_blog });
      setIt({ ...it, for_blog: r.for_blog });
      onBlog(r.for_blog);
    } finally {
      setBusy(false);
    }
  };

  const chips = useMemo(() => {
    if (!it) return [];
    const c: [FilterKey, string][] = [];
    if (it.content_type) c.push(["type", it.content_type]);
    if (it.theme) c.push(["theme", it.theme]);
    for (const p of it.project ?? []) c.push(["project", p]);
    for (const v of it.value_in ?? []) c.push(["value_in", v]);
    if (it.stance) c.push(["stance", it.stance]);
    return c;
  }, [it]);

  if (failed) return <main className="page"><p className="muted pad">{s.failed}</p></main>;
  if (!it) return <main className="page"><p className="muted pad">…</p></main>;
  const st = it.structured ?? {};
  const published = it.raw_meta?.published_at ?? it.occurred_at;
  const hook = it.hook ? Object.entries(d.card.hook).filter(([k]) => it.hook![k]) : [];
  const en = it.raw_meta?.en;

  return (
    <main className="page item">
      <Thumb src={it.preview} fallback="" big />
      <h1 className="item-title">{it.title ?? "—"}</h1>
      <div className="muted meta">
        {d.sources[sourceKey(it)] ?? ""}
        {it.author && <> · {it.raw_meta?.author_url ? <button className="link" onClick={() => open(it.raw_meta!.author_url!)}>@{it.author.replace(/^@/, "")}</button> : `@${it.author.replace(/^@/, "")}`}</>}
        {published && <> · 📅 {fmtDate(d, published, true)}</>}
        {" · "}🗄 {fmtDate(d, it.created_at, true)}
      </div>
      <div className="actions">
        {it.source_url && <button className="btn" onClick={() => open(it.source_url!)}>{s.original}</button>}
        {it.archive_link && <button className="btn" onClick={() => open(it.archive_link!)}>{s.inChannel}</button>}
        <button className={`btn ${it.for_blog ? "on" : ""}`} onClick={toggleBlog} disabled={busy}>{it.for_blog ? s.inBlog : s.toBlog}</button>
      </div>
      <div className="chips wrap">
        {chips.map(([k, v]) => <button key={k + v} className="chip" onClick={() => onTag(k, v)}>{label(d, k, v)}</button>)}
      </div>

      <Section title={s.summary} text={it.summary} />
      <Section title={`💭 ${d.card.why}`} text={it.why_me} />
      <List title={d.card.points} items={st.points} />
      <List title={d.card.ingredients} items={st.ingredients} />
      <List title={d.card.steps} items={st.steps} ordered />
      {st.lists?.map((l, i) => <List key={i} title={l.title} items={l.items} />)}
      <Section title={`👁 ${d.card.inFrame}`} text={it.visual_description} />
      {hook.length > 0 && (
        <Fold title={`🎬 ${s.format}`}>
          {hook.map(([k, t]) => <p key={k}><span className="muted">{t}:</span> {it.hook![k]}</p>)}
        </Fold>
      )}
      <Section title={`💬 ${d.card.comments}`} text={it.comments_note} />
      {en && en.summary && (
        <Fold title={`🇬🇧 ${s.en}`}>
          <p><b>{en.title}</b></p>
          <p>{en.summary}</p>
          {en.why_me && <p>💭 {en.why_me}</p>}
        </Fold>
      )}
      {it.caption && <Fold title={`📝 ${s.description}`}><p className="pre">{it.caption}</p></Fold>}
      {it.raw_text && <Fold title={`📜 ${s.transcript}`}><p className="pre">{it.raw_text}</p></Fold>}
      {it.tags?.length > 0 && <p className="muted tags">#{it.tags.join(" #")}</p>}
    </main>
  );
}

function Section({ title, text }: { title: string; text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <section className="sec">
      <h3>{title}</h3>
      <p className="pre">{text}</p>
    </section>
  );
}

function List({ title, items, ordered }: { title: string; items?: string[]; ordered?: boolean }) {
  if (!items?.length) return null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <section className="sec">
      <h3>{title}</h3>
      <Tag>{items.map((x, i) => <li key={i}>{x}</li>)}</Tag>
    </section>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="sec fold">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
