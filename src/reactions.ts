import type { Api } from "grammy";

// Status of an item = a reaction on the user's own message (SPEC §6.0: the chat stays clean).
// Telegram only lets bots use its standard reaction set, so ✅/⚠️ are not possible.
export const REACT = { working: "👀", done: "👌", error: "🤷", repeat: "🤝" } as const;

export async function react(api: Api, chatId: number, messageId: number, emoji: (typeof REACT)[keyof typeof REACT]) {
  await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }]).catch((e) => console.warn("reaction failed", e?.description ?? e));
}
