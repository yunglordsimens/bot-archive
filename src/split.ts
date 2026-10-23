// Long text → several Telegram messages, cut only between paragraphs / list items / sentences. Never "…".
// Blocks are HTML where tags stay inside one line (headers on their own line), so splitting between lines or at spaces is safe.

export const MESSAGE_MAX = 4000; // Telegram allows 4096; keep a margin for entities

function splitLong(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // Prefer a line break, then the end of a sentence, then a space; hard cut only for a single giant word.
    let at = window.lastIndexOf("\n");
    if (at < limit * 0.5) at = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? ")) + 1;
    if (at < limit * 0.5) at = window.lastIndexOf(" ");
    if (at <= 0) at = limit;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitMessages(blocks: string[], limit = MESSAGE_MAX): string[] {
  const parts = blocks.filter(Boolean).flatMap((b) => {
    if (b.length <= limit) return [b];
    // A long block (e.g. a long list): pack its lines, then split any single huge line.
    return packLines(b.split("\n").flatMap((l) => splitLong(l, limit)), limit, "\n");
  });
  return packLines(parts, limit, "\n\n");
}

function packLines(units: string[], limit: number, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if (!cur) cur = u;
    else if (cur.length + sep.length + u.length <= limit) cur += sep + u;
    else {
      out.push(cur);
      cur = u;
    }
  }
  if (cur) out.push(cur);
  return out;
}
