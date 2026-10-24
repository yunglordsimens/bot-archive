// All data goes through the Supabase Edge Function `archive`, which checks Telegram initData (SPEC §6.0).
const API = import.meta.env.VITE_API_URL ?? "https://fjkjqkqzkjjuusonbyep.supabase.co/functions/v1/archive";

export const tg = (window as any).Telegram?.WebApp;
export const initData: string = tg?.initData ?? "";

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData, action, ...params }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `http_${res.status}`);
  return body as T;
}

export type Filters = Partial<Record<"project" | "theme" | "type" | "value_in" | "stance" | "source", string>> & { blog?: boolean };
export type Facets = { total: number; blog: number; counts: Partial<Record<keyof Omit<Filters, "blog">, Record<string, number>>> };
export type Init = { user: { name: string | null; display_name: string | null; lang: string; projects: string[] | null }; facets: Facets; search: boolean };

export type Row = {
  id: number; created_at: string; title: string | null; author: string | null; summary: string | null; theme: string | null;
  project: string[]; content_type: string | null; input_kind: string; origin: string | null; stance: string | null; value_in: string[];
  for_blog: boolean; preview: string | null; status: string; published_at: string | null;
};
export type Feed = { items: Row[]; more: boolean; semantic: boolean };

type List = { title: string; items: string[] };
export type Full = Row & {
  occurred_at: string | null; source_url: string | null; caption: string | null; why_me: string | null; why_tags?: string[]; visual_description: string | null;
  comments_note: string | null; hook: Record<string, string> | null; my_note: string | null; tags: string[];
  structured: { points?: string[]; ingredients?: string[]; steps?: string[]; lists?: List[] } | null;
  raw_text: string | null; archive_link: string | null;
  raw_meta: { en?: { title: string; summary: string; why_me?: string; structured?: Full["structured"] }; author_url?: string; author?: { name?: string; handle?: string; url?: string; followers?: number }; transcript_link?: string; published_at?: string } | null;
};
