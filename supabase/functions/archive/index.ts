// Mini App «Архив» API (SPEC §6.0). The only door to the data for the Mini App:
// checks Telegram initData, finds the user in `users`, returns only their items.
// Service role key lives only here (SUPABASE_SERVICE_ROLE_KEY is set by Supabase itself).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const EMBED_MODEL = Deno.env.get("GEMINI_EMBED_MODEL") ?? "gemini-embedding-2";
const TG_PUBLIC_KEY = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"; // Telegram's Ed25519 key for initData
const MAX_AGE = 7 * 24 * 3600; // seconds; the Mini App can stay open for a while
const PAGE = 30;
const SIGNED_TTL = 24 * 3600;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const b64 = (s: string) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

let botId: string | undefined;
async function getBotId() {
  if (botId) return botId;
  const { data } = await db.from("settings").select("value").eq("key", "bot_id").maybeSingle();
  return (botId = data?.value);
}

// Third-party validation: Ed25519 signature over "<bot_id>:WebAppData\n<sorted key=value>" (no bot token needed).
async function verify(initData: string): Promise<number | null> {
  const id = await getBotId();
  if (!id || !initData) return null;
  const params = new URLSearchParams(initData);
  const signature = params.get("signature");
  const authDate = Number(params.get("auth_date"));
  if (!signature || !authDate || Date.now() / 1000 - authDate > MAX_AGE) return null;
  const pairs: string[] = [];
  params.forEach((v, k) => { if (k !== "hash" && k !== "signature") pairs.push(`${k}=${v}`); });
  const key = await crypto.subtle.importKey("raw", hex(TG_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64(signature), new TextEncoder().encode(`${id}:WebAppData\n${pairs.sort().join("\n")}`));
  if (!ok) return null;
  try {
    return JSON.parse(params.get("user") ?? "{}").id ?? null;
  } catch {
    return null;
  }
}

async function embed(text: string): Promise<number[] | null> {
  if (!GEMINI_KEY) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 1536 }),
  });
  if (!res.ok) return void console.warn("embed failed", res.status, await res.text()), null;
  return (await res.json()).embedding?.values ?? null;
}

async function signed(paths: (string | null)[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (!list.length) return {};
  const { data } = await db.storage.from("previews").createSignedUrls(list, SIGNED_TTL);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

const FILTERS = ["project", "theme", "type", "value_in", "stance", "source", "blog"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const tgId = await verify(body.initData ?? "");
  if (!tgId) return json({ error: (await getBotId()) ? "auth" : "no_bot_id" }, 401);
  const { data: user } = await db.from("users").select("id, name, display_name, lang, projects, archive_channel_id").eq("telegram_user_id", tgId).maybeSingle();
  if (!user) return json({ error: "not_allowed" }, 403);

  switch (body.action) {
    case "init": {
      const { data: facets, error } = await db.rpc("archive_facets", { uid: user.id });
      if (error) return json({ error: error.message }, 500);
      return json({ user: { name: user.name, display_name: user.display_name, lang: user.lang, projects: user.projects ? Object.keys(user.projects) : null }, facets, search: !!GEMINI_KEY });
    }

    // The header name (SPEC §8); empty = back to the name from Telegram.
    case "name": {
      const name = typeof body.value === "string" ? body.value.trim().slice(0, 40) : "";
      const { error } = await db.from("users").update({ display_name: name || null }).eq("id", user.id);
      if (error) return json({ error: error.message }, 500);
      return json({ display_name: name || null });
    }

    case "feed": {
      const f: Record<string, unknown> = {};
      for (const k of FILTERS) if (body.filters?.[k] != null && body.filters[k] !== "") f[k] = body.filters[k];
      const q = typeof body.q === "string" ? body.q.trim().slice(0, 200) : "";
      const qvec = q ? await embed(q) : null;
      const { data, error } = await db.rpc("archive_feed", {
        uid: user.id, f, q: q || null, qvec: qvec ? JSON.stringify(qvec) : null,
        lim: q ? 60 : PAGE + 1, off: q ? 0 : Math.max(0, Number(body.offset) || 0),
      });
      if (error) return json({ error: error.message }, 500);
      let rows = (data ?? []) as Record<string, any>[];
      let more = false;
      if (q) {
        // Meaning-only matches: keep the ones close to the best one (absolute similarity varies with query length).
        const best = Math.max(0, ...rows.filter((r) => !r.word_hit).map((r) => r.similarity ?? 0));
        rows = rows.filter((r) => r.word_hit || (r.similarity ?? 0) >= best - 0.08).slice(0, 40);
      } else {
        more = rows.length > PAGE;
        rows = rows.slice(0, PAGE);
      }
      const urls = await signed(rows.map((r) => r.preview_path));
      return json({ items: rows.map((r) => ({ ...r, preview: urls[r.preview_path] ?? null })), more, semantic: !!qvec });
    }

    case "item": {
      const { data: it } = await db.from("items")
        .select("id, created_at, occurred_at, input_kind, origin, source_url, status, author, caption, title, summary, content_type, theme, project, why_me, why_tags, visual_description, value_in, stance, comments_note, hook, my_note, tags, structured, raw_text, archive_link, raw_meta, for_blog, preview_path, language")
        .eq("user_id", user.id).eq("id", Number(body.id)).maybeSingle();
      if (!it) return json({ error: "not_found" }, 404);
      const urls = await signed([it.preview_path]);
      return json({ item: { ...it, preview: urls[it.preview_path] ?? null } });
    }

    case "blog": {
      const { data, error } = await db.from("items").update({ for_blog: !!body.value, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("id", Number(body.id)).select("id, for_blog").maybeSingle();
      if (error || !data) return json({ error: error?.message ?? "not_found" }, 404);
      return json(data);
    }
  }
  return json({ error: "action" }, 400);
});
