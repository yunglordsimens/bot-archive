import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { Stats } from "./fetchers.js";

export const db = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false },
});

export type Item = {
  id: number;
  user_id: number;
  created_at: string;
  input_kind: string;
  origin: string | null;
  source_url: string | null;
  tg_chat_id: number;
  tg_message_id: number;
  reply_message_id: number | null;
  batch_id: string | null;
  input: ItemInput;
  origin_detail: string | null;
  occurred_at: string | null;
  text_hash: string | null;
  tg_file_id: string | null;
  duplicate_of: number | null;
  status: string;
  attempts: number;
  author: string | null;
  caption: string | null;
  title: string | null;
  summary: string | null;
  content_type: string | null;
  kind: string | null;
  theme: string | null;
  project: string[];
  why_me: string | null;
  visual_description: string | null;
  value_in: string[];
  stance: string | null;
  comments_note: string | null;
  hook: Hook | null;
  my_note: string | null;
  next_retry_at?: string | null;
  tags: string[];
  structured: Structured | null;
  raw_text: string | null;
  archive_file_ids: string[];
  archive_link: string | null;
  raw_meta: RawMeta | null;
  error: string | null;
};

export type ItemInput = {
  text?: string;
  file_id?: string;
  mime?: string;
  file_size?: number;
};

export type NamedList = { title: string; items: string[] };
// Bump when the card/post format changes: /reprocess picks up items below this version.
export const FORMAT_VERSION = 4;

export type Hook = {
  looks_accidental: string; probably_deliberate: string; how_hidden: string; first_seconds: string; visual: string; audio: string;
  text_on_screen: string; mismatch: string; emotion: string; format: string; edit: string; why_it_works: string; reusable_move: string;
};
export type Structured = { points?: string[]; ingredients?: string[]; steps?: string[]; lists?: NamedList[] };
export type Similar = { id: number; summary: string | null; title: string | null; created_at: string; similarity: number };
export type RawMeta = {
  via?: string; log?: string[]; archive_error?: string; similar?: Similar; en?: CardText; stats?: Stats;
  v?: number;                 // FORMAT_VERSION the item was processed with
  transcript_link?: string;   // transcript reply under the channel post
  card_links?: string[];      // text card replies under the channel post (SPEC §5.3a)
  reprocess_log?: string[];
  comments?: string[];        // top comments given to Gemini
  author_url?: string;
  published_at?: string;
  profile?: { followers?: number; following?: number; posts?: number; likes?: number; bio?: string; entity?: string; platform?: string; verified?: boolean };
};
// Card content in one language — used for the English translation.
export type CardText = { title: string; summary: string; structured: Structured; why_me?: string };

export async function insertItem(row: Partial<Item>): Promise<Item> {
  const { data, error } = await db.from("items").insert(row).select().single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(id: number, patch: Record<string, unknown>) {
  const { error } = await db.from("items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function claimItems(n: number): Promise<Item[]> {
  const { data, error } = await db.rpc("claim_items", { n });
  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function findByTextHash(userId: number, hash: string): Promise<Item | null> {
  const { data } = await db
    .from("items")
    .select()
    .eq("user_id", userId)
    .eq("text_hash", hash)
    .in("status", ["ok", "pending_media", "queued", "processing"])
    .limit(1)
    .maybeSingle();
  return data as Item | null;
}

export async function findByHash(userId: number, hash: string, excludeId: number): Promise<Item | null> {
  const { data } = await db
    .from("items")
    .select()
    .eq("user_id", userId)
    .eq("media_hash", hash)
    .eq("status", "ok")
    .neq("id", excludeId)
    .limit(1)
    .maybeSingle();
  return data as Item | null;
}

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const { error } = await db.from("settings").upsert({ key, value });
  if (error) throw error;
}
