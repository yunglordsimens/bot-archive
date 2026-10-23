// Tiny in-memory PostgREST stand-in for offline tests: eq / neq / in / cs filters, limit, count, insert, update, single.
import { createServer } from "node:http";

export type Row = Record<string, any>;
export const tables: Record<string, Row[]> = { users: [], items: [], settings: [] };
let nextId = 1000;

function matches(row: Row, params: URLSearchParams) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    const cell = row[k];
    if (op === "eq" && String(cell) !== val) return false;
    if (op === "neq" && String(cell) === val) return false;
    if (op === "in" && !val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(cell))) return false;
    if (op === "cs" && !val.replace(/^\{|\}$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).every((x) => (cell ?? []).includes(x))) return false;
    if (op === "is" && val === "null" && cell != null) return false;
  }
  return true;
}

export async function startFakeSupabase(): Promise<string> {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const name = url.pathname.split("/").pop()!;
      res.setHeader("Content-Type", "application/json");
      if (url.pathname.includes("/rpc/")) return res.end("[]");
      const table = (tables[name] ??= []);
      const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      let rows = table.filter((r) => matches(r, url.searchParams));
      if (req.method === "POST") {
        const input = [JSON.parse(body)].flat().map((r: Row) => ({ id: nextId++, created_at: new Date().toISOString(), ...r }));
        table.push(...input);
        rows = input;
        res.statusCode = 201;
      } else if (req.method === "PATCH") {
        const patch = JSON.parse(body);
        for (const r of rows) Object.assign(r, patch);
      }
      const limit = Number(url.searchParams.get("limit") ?? 0);
      if (limit) rows = rows.slice(0, limit);
      res.setHeader("Content-Range", `0-${Math.max(rows.length - 1, 0)}/${rows.length}`);
      if (req.method === "HEAD") return res.end();
      if (single) {
        if (!rows.length) { res.statusCode = 406; return res.end(JSON.stringify({ code: "PGRST116", message: "no rows" })); }
        return res.end(JSON.stringify(rows[0]));
      }
      res.end(JSON.stringify(rows));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(srv.address() as any).port}`;
}
