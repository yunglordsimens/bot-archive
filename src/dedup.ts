import { createHash } from "node:crypto";

const TRACKING = /^(utm_\w+|si|_t|_r|igsh|igshid|is_from_webapp|sender_device|share_\w+|fbclid|feature|pp)$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Short TikTok links (vm./vt./tiktok.com/t/) differ on every share — follow the redirect to get the video id.
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(4000) });
    return res.url || url;
  } catch {
    return url;
  }
}

// Same video/post → same key, whatever link form or tracking params were shared.
export async function urlKey(raw: string): Promise<string> {
  let u = new URL(raw.trim());
  const host = () => u.hostname.replace(/^(www|m)\./, "");

  if (/(^|\.)tiktok\.com$/.test(host())) {
    if (/^(vm|vt)\./.test(u.hostname) || u.pathname.startsWith("/t/")) u = new URL(await resolveRedirect(u.toString()));
    const id = u.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1];
    if (id) return `tiktok:${id}`;
  }
  if (host() === "youtu.be") return `youtube:${u.pathname.slice(1).split("/")[0]}`;
  if (/(^|\.)youtube\.com$/.test(host())) {
    const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1];
    if (id) return `youtube:${id}`;
  }
  if (/(^|\.)instagram\.com$/.test(host())) {
    const code = u.pathname.match(/^\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/)?.[1];
    if (code) return `instagram:${code}`;
  }

  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = "";
  u.hostname = u.hostname.replace(/^(www|m)\./, "");
  return u.toString().replace(/\/$/, "");
}

export async function urlHash(url: string) {
  return sha(await urlKey(url));
}

export function textHash(text: string) {
  return sha(text.trim().toLowerCase().replace(/\s+/g, " "));
}
