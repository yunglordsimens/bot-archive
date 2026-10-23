import type { Context } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { tr, type Lang } from "./i18n/index.js";
import type { Profile } from "./gemini.js";

// SPEC §5.4: each user has their own language, archive channel, directions and topics.
export type User = {
  id: number;
  telegram_user_id: number;
  name: string | null;
  lang: Lang;
  archive_channel_id: number | null;
  projects: Record<string, string> | null; // direction → hint for the model; null = defaults for the language
  themes: string[] | null;                 // null = defaults for the language
  is_admin: boolean;
  notify: boolean; // one line with a link to the post after saving (otherwise only reactions and errors)
};

const TTL = 60_000;
const cache = new Map<number, { u: User; at: number }>(); // by telegram id

function remember(u: User) {
  cache.set(u.telegram_user_id, { u, at: Date.now() });
  return u;
}

export async function getUserByTg(tgId: number): Promise<User | undefined> {
  const c = cache.get(tgId);
  if (c && Date.now() - c.at < TTL) return c.u;
  const { data } = await db.from("users").select().eq("telegram_user_id", tgId).maybeSingle();
  return data ? remember(data as User) : undefined;
}

export async function getUserById(id: number): Promise<User> {
  for (const { u, at } of cache.values()) if (u.id === id && Date.now() - at < TTL) return u;
  const { data, error } = await db.from("users").select().eq("id", id).single();
  if (error) throw error;
  return remember(data as User);
}

export async function updateUser(u: User, patch: Partial<User>): Promise<User> {
  const { data, error } = await db.from("users").update(patch).eq("id", u.id).select().single();
  if (error) throw error;
  return remember(data as User);
}

export async function addUser(tgId: number, lang: Lang, addedBy: number): Promise<User | undefined> {
  const { data, error } = await db.from("users").insert({ telegram_user_id: tgId, lang, added_by: addedBy }).select().single();
  if (error) return undefined; // already exists
  return remember(data as User);
}

export async function listUsers(): Promise<User[]> {
  const { data } = await db.from("users").select().order("id");
  return (data ?? []) as User[];
}

// The owner from .env is always an admin user (first start creates the row).
export async function ensureOwner(): Promise<User> {
  const u = await getUserByTg(config.ownerId);
  if (u) return u;
  const { data, error } = await db.from("users").insert({ telegram_user_id: config.ownerId, lang: "ru", is_admin: true, name: "owner" }).select().single();
  if (error) throw error;
  return remember(data as User);
}

export const userProjects = (u: User): Record<string, string> =>
  u.projects ?? Object.fromEntries(tr(u.lang).defaultProjects.map((p) => [p, ""]));
export const userThemes = (u: User): string[] => u.themes ?? tr(u.lang).defaultThemes;
// The last entry of each list is the "misc" bucket.
export const miscProject = (u: User) => Object.keys(userProjects(u)).at(-1)!;
export const miscTheme = (u: User) => userThemes(u).at(-1)!;

// What Gemini needs to know about the user: output language and their own lists.
export const profileOf = (u: User): Profile => ({
  lang: u.lang, language: tr(u.lang).geminiLanguage, themes: userThemes(u), projects: userProjects(u),
});

// grammY context with the user attached by the access middleware.
export type Ctx = Context & { user: User };
