import { GoogleGenAI, Type, type Part } from "@google/genai";
import { config } from "./config.js";
import type { CardText, Hook, Structured } from "./db.js";
import { STANCES, VALUE_IN } from "./hints.js";

const ai = new GoogleGenAI({ apiKey: config.geminiKey });

export type Analysis = {
  title: string;
  summary: string;
  content_type: string;
  kind: string;
  theme: string;
  project: string[];
  why_me: string;
  tags: string[];
  structured: Structured;
  raw_text: string;
  visual_description: string;
  value_in: string[];
  stance: string;
  comments_note: string;
  entity: string;
  language: string[];
};

// Who the analysis is for: output language and the user's own lists (SPEC §5.4).
export type Profile = { lang: string; language: string; themes: string[]; projects: Record<string, string> };

function schemaFor(p: Profile) {
  return {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: `Short title, 3–8 words, in ${p.language}` },
      summary: { type: Type.STRING, description: `The gist in 3–5 lines, in ${p.language}` },
      content_type: { type: Type.STRING, enum: ["tip", "recipe", "idea", "funny", "reference", "other"] },
      kind: { type: Type.STRING, description: `What it is by form: video, meme, tweet, note, receipt, chat screenshot, article, voice message… (in ${p.language})` },
      theme: { type: Type.STRING, enum: p.themes },
      why_me: { type: Type.STRING, description: `Why it matters to the user: 1–2 sentences, how it helps in their life areas. Concrete. In ${p.language}` },
      project: { type: Type.ARRAY, items: { type: Type.STRING, enum: Object.keys(p.projects) }, description: "User's life areas this belongs to; 1–3" },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: `3–7 free tags, lowercase, in ${p.language}` },
      structured: {
        type: Type.OBJECT,
        properties: {
          points: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Points of a tip/idea" },
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } },
          lists: {
            type: Type.ARRAY,
            description: "Enumerations in the content: films, books, places, tools, products, apps, fonts…",
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: `List name in ${p.language}: “Films”, “Places in Prague”…` },
                items: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["title", "items"],
            },
          },
        },
      },
      raw_text: { type: Type.STRING, description: "Transcript: verbatim what is said (+ on-screen text), in the original language. No retelling, no picture description" },
      visual_description: { type: Type.STRING, description: `What is in the frame: who, where, actions, editing. Short; detailed if there is little speech or the value is visual. In ${p.language}` },
      value_in: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...VALUE_IN] }, description: "Where the value is: info / visual / audio / format / meta; several allowed" },
      stance: { type: Type.STRING, enum: [...STANCES], description: "Guess of the user's attitude" },
      comments_note: { type: Type.STRING, description: `Useful bits from the comments (clarifications, links, author replies, debate) in one line, in ${p.language}; empty if nothing` },
      entity: { type: Type.STRING, enum: ["person", "company", "none"], description: "For profiles: person or company; otherwise none" },
      language: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Languages in the content, ISO codes: ru, uk, cs, en…" },
    },
    required: ["title", "summary", "content_type", "kind", "theme", "project", "why_me", "tags", "structured", "raw_text", "visual_description", "value_in", "stance", "comments_note", "entity", "language"],
  };
}

function systemFor(p: Profile) {
  return `You analyse saved content for a personal archive. Input can be a video (with sound), an image, audio, text or a web page.
Speech and text may mix Russian, Ukrainian, Czech, English, Vietnamese and other languages.
- Write title, summary, why_me, kind, tags, visual_description, comments_note and list titles in ${p.language}. raw_text stays in the original language.
- Take the gist from both speech and on-screen text. If the sound is only music, take it from the picture and captions.
- content_type: tip, recipe, idea, funny, reference (visual reference), other.
- For tips fill structured.points.
- Build a recipe from everything together: speech, on-screen text and the description under the video. structured.ingredients with amounts, structured.steps in order.
- If the content enumerates things (films, books, places, tools, products, apps, fonts…), put each enumeration into structured.lists: { title, items }. Names as in the original, with a short note if needed.
- Three different fields, don't mix them:
  · content_type — WHAT it is by form;
  · theme — what it is ABOUT (exactly one from the list);
  · project — which of the user's LIFE AREAS it belongs to: one or more (usually 1–2), strictly from the list; if none fits — the last one.
  The user's life areas:
${Object.entries(p.projects).map(([k, v]) => `  · ${k}${v ? ` — ${v}` : ""}`).join("\n")}
- Three different texts, don't mix: raw_text — transcript (speech + on-screen text; NOT the description under the video, NOT comments), summary — the gist in your words, visual_description — what is seen in the frame.
- value_in — where the value is: info, visual (picture), audio (sound, track, voice), format (how it's made, a trick), meta (hooked on a meta level). Several allowed.
- stance — the user's attitude: like, dislike, anti_example, replicate (want to repeat it), format_idea, seen_before; for profiles also example, interesting. If the user gave a hint — use it, it beats your guess.
- comments_note — only if the comments contain something useful (clarification, link, full recipe, author's reply, a real debate); otherwise an empty string.
- Profile (an account of a person or company): summary — who it is, what and in which format they post, visual style; why_me — how it is an example or anti-example for the user; entity — person / company.
- why_me — how it helps the user in their life areas, 1–2 sentences, concrete (what to do, where to apply). If it's just for mood — say so.
- Don't invent anything: if there is little data (e.g. only a caption), say so in the summary.`;
}

export function textPart(text: string): Part {
  return { text };
}

// Inline for small files, Gemini File API for larger ones.
export async function mediaPart(buf: Buffer, mimeType: string): Promise<Part> {
  if (buf.length < 15 * 1024 * 1024) {
    return { inlineData: { mimeType, data: buf.toString("base64") } };
  }
  let file = await ai.files.upload({ file: new Blob([new Uint8Array(buf)], { type: mimeType }), config: { mimeType } });
  for (let i = 0; i < 60 && file.state === "PROCESSING"; i++) {
    await sleep(2000);
    file = await ai.files.get({ name: file.name! });
  }
  if (file.state !== "ACTIVE") throw new Error(`Gemini file state ${file.state}`);
  return { fileData: { fileUri: file.uri!, mimeType } };
}

export function urlPart(url: string, mimeType = "video/*"): Part {
  return { fileData: { fileUri: url, mimeType } };
}

// Single entry point for the model — swap the model here.
async function generate(parts: Part[], system: string, responseSchema: object): Promise<string> {
  const models = [config.geminiModel, ...config.geminiFallbackModels];
  let lastErr: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { systemInstruction: system, responseMimeType: "application/json", responseSchema },
        });
        return res.text ?? "";
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.code;
        if (status === 429 || status === 500 || status === 503) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        if (status === 404) break; // model gone → try fallback
        throw e;
      }
    }
  }
  throw lastErr;
}

// Models sometimes return a literal "\\n" inside strings — turn it into a real line break everywhere.
function fixNewlines<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\\n/g, "\n") as T;
  if (Array.isArray(v)) return v.map(fixNewlines) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fixNewlines(x)])) as T;
  return v;
}

function validate(raw: string, p: Profile): Analysis {
  const a = fixNewlines(JSON.parse(raw) as Analysis);
  if (!a.summary || !a.title) throw new Error("empty summary/title");
  if (!["tip", "recipe", "idea", "funny", "reference", "other"].includes(a.content_type)) a.content_type = "other";
  if (!p.themes.includes(a.theme)) a.theme = p.themes.at(-1)!;
  a.project = [...new Set((a.project ?? []).filter((x) => x in p.projects))];
  if (!a.project.length) a.project = [Object.keys(p.projects).at(-1)!];
  a.tags = (a.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  a.structured ??= {};
  a.raw_text ??= "";
  a.why_me ??= "";
  a.visual_description ??= "";
  a.value_in = [...new Set((a.value_in ?? []).filter((v) => (VALUE_IN as readonly string[]).includes(v)))];
  if (!(STANCES as readonly string[]).includes(a.stance)) a.stance = "like";
  a.comments_note = (a.comments_note ?? "").trim();
  a.entity ??= "none";
  a.language ??= [];
  return a;
}

// Analyse content for a user; one retry on invalid JSON.
export async function analyze(parts: Part[], p: Profile): Promise<Analysis> {
  const run = async () => validate(await generate(parts, systemFor(p), schemaFor(p)), p);
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof SyntaxError) && !(e instanceof Error && e.message.startsWith("empty"))) throw e;
    return run();
  }
}

const listSchema = { type: Type.ARRAY, items: { type: Type.STRING } };
const cardSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    why_me: { type: Type.STRING },
    structured: {
      type: Type.OBJECT,
      properties: {
        points: listSchema, ingredients: listSchema, steps: listSchema,
        lists: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, items: listSchema }, required: ["title", "items"] } },
      },
    },
  },
  required: ["title", "summary", "structured"],
};

// On-demand English version of a card (the "EN" button).
export async function translateCard(card: CardText): Promise<CardText> {
  const system = "Translate this archive card into natural English. Keep the same JSON structure and the same number of items. " +
    "For films, books, places and products use their official English names when they exist.";
  return fixNewlines(JSON.parse(await generate([textPart(JSON.stringify(card))], system, cardSchema)) as CardText);
}

// Deep format analysis (SPEC §3.9) — only when value_in says the form matters, on a caption hint, or by button.
const hookFields: Record<keyof Hook, string> = {
  looks_accidental: "что в ролике выглядит случайным, естественным, «просто так получилось»",
  probably_deliberate: "какое решение, вероятно, за этим стоит и зачем (гипотеза)",
  how_hidden: "чем замаскирована продуманность: небрежная съёмка, «живой» тон, оговорки, бытовой фон…",
  first_seconds: "что происходит в первые 1–3 сек: кадр, первая фраза, первый звук",
  visual: "кто в кадре, внешность, одежда, место, предметы, композиция, свет",
  audio: "голос (интонация, темп, акцент), музыка/трек, звуковые эффекты, тишина",
  text_on_screen: "надписи, субтитры, их стиль",
  mismatch: "что с чем НЕ вяжется (образ vs тема, звук vs картинка, ожидание vs реальность)",
  emotion: "какая реакция задумана: удивление, смех, раздражение, «чё?», зависть…",
  format: "тип ролика: монолог в камеру, POV, скетч, до/после, ответ на коммент…",
  edit: "монтаж: темп склеек, зумы, перебивки, длина",
  why_it_works: "1–2 предложения: почему это останавливает скролл",
  reusable_move: "скрытое решение в общем виде, без привязки к этому видео: как сделать так же, чтобы тоже выглядело случайным",
};
const hookSchema = {
  type: Type.OBJECT,
  properties: Object.fromEntries(Object.entries(hookFields).map(([k, d]) => [k, { type: Type.STRING, description: d }])),
  required: Object.keys(hookFields),
};
const HOOK_SYSTEM = `Разбери, как сделано это видео (или пост). Главное — решения, которые выглядят случайными или естественными, но, скорее всего, продуманы: странный кастинг, «неудачный» свет, оговорка, будто бы случайный предмет в кадре, снято «как на телефон».
Цепочка: что кажется случайностью → какое решение за этим, вероятно, стоит → как это решение спрятано.
Первые 1–3 секунды разбери отдельно. Это гипотезы — формулируй «скорее всего», «похоже на», не как факты.
Запрещены общие места вроде «яркий визуал привлекает внимание», «эмоциональный контент вовлекает» — только конкретные детали этого ролика.`;

export async function analyzeFormat(parts: Part[], language: string): Promise<Hook> {
  return fixNewlines(JSON.parse(await generate(parts, `${HOOK_SYSTEM}\nWrite every field in ${language}.`, hookSchema)) as Hook);
}

export async function embed(text: string): Promise<number[]> {
  const res = await ai.models.embedContent({
    model: config.embedModel,
    contents: text.slice(0, 8000),
    config: { outputDimensionality: config.embedDims },
  });
  const v = res.embeddings?.[0]?.values;
  if (!v || v.length !== config.embedDims) throw new Error("bad embedding");
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
