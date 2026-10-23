import { GoogleGenAI, Type, type Part } from "@google/genai";
import { config, PROJECTS, THEMES, TYPES } from "./config.js";
import type { CardText, Structured } from "./db.js";

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
  language: string[];
};

const schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Короткий заголовок, 3–8 слов, по-русски" },
    summary: { type: Type.STRING, description: "Суть в 3–5 строк, по-русски" },
    content_type: { type: Type.STRING, enum: Object.keys(TYPES) },
    kind: { type: Type.STRING, description: "Что это по форме: видео, мем, твит, заметка, чек, скрин переписки, статья, голосовое…" },
    theme: { type: Type.STRING, enum: THEMES },
    why_me: { type: Type.STRING, description: "Зачем это мне: 1–2 предложения, как пригодится в моих направлениях. Конкретно, без общих слов" },
    project: { type: Type.ARRAY, items: { type: Type.STRING, enum: Object.keys(PROJECTS) }, description: "Направления жизни, к которым относится запись; 1–3" },
    tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3–7 свободных тегов, строчными, по-русски" },
    structured: {
      type: Type.OBJECT,
      properties: {
        points: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Пункты совета/идеи" },
        ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
        steps: { type: Type.ARRAY, items: { type: Type.STRING } },
        lists: {
          type: Type.ARRAY,
          description: "Перечни из контента: фильмы, книги, места, инструменты, продукты, приложения, шрифты…",
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Название списка по-русски: «Фильмы», «Места в Праге»…" },
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["title", "items"],
          },
        },
      },
    },
    raw_text: { type: Type.STRING, description: "Дословно: что говорят и что написано на экране/картинке, на языке оригинала" },
    language: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Языки в контенте, ISO-коды: ru, uk, cs, en…" },
  },
  required: ["title", "summary", "content_type", "kind", "theme", "project", "why_me", "tags", "structured", "raw_text", "language"],
};

const SYSTEM = `Ты разбираешь сохранённый контент для личного архива. Вход может быть видео (со звуком), картинкой, аудио, текстом или страницей.
Языки речи и текста: русский, украинский, чешский, английский вперемешку.
- Суть бери и из речи, и из текста на экране. Если звук — только музыка, бери суть из картинки и надписей.
- summary, title, tags — по-русски. raw_text — на языке оригинала.
- content_type: tip (совет), recipe (рецепт), idea (идея), funny (смешное), reference (визуальный референс), other.
- Для советов заполни structured.points.
- Рецепт собирай из всего вместе: речь, текст на экране и описание под видео (подпись автора). structured.ingredients — с количествами, structured.steps — по порядку.
- Если в контенте что-то перечисляется (фильмы, книги, места, инструменты, продукты, приложения, шрифты…) — вынеси каждый перечень в structured.lists: { title: название списка, items: элементы }. Названия — как в оригинале, при необходимости с короткой пометкой.
- Три разных поля, не смешивай их:
  · content_type — ЧТО это по форме (совет, рецепт, идея…);
  · theme — О ЧЁМ это (одна тема строго из списка);
  · project — К КАКОМУ НАПРАВЛЕНИЮ ЖИЗНИ пользователя относится: можно несколько (обычно 1–2), строго из списка; если ни к одному — «разное».
  Направления пользователя:
${Object.entries(PROJECTS).map(([k, v]) => `  · ${k}${v ? ` — ${v}` : ""}`).join("\n")}
- why_me — «зачем мне»: как это пригодится пользователю в его направлениях, 1–2 предложения, конкретно (что сделать, где применить). Если это просто для настроения — так и скажи.
- Ничего не выдумывай: если данных мало (например, только подпись), так и скажи в summary.`;

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
async function generate(parts: Part[], system = SYSTEM, responseSchema: object = schema): Promise<string> {
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

function validate(raw: string): Analysis {
  const a = JSON.parse(raw) as Analysis;
  if (!a.summary || !a.title) throw new Error("empty summary/title");
  if (!TYPES[a.content_type]) a.content_type = "other";
  if (!THEMES.includes(a.theme)) a.theme = "разное";
  a.project = [...new Set((a.project ?? []).filter((p) => p in PROJECTS))];
  if (!a.project.length) a.project = ["разное"];
  a.tags = (a.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  a.structured ??= {};
  a.raw_text ??= "";
  a.why_me ??= "";
  a.language ??= [];
  return a;
}

// Analyse content; one retry on invalid JSON.
export async function analyze(parts: Part[]): Promise<Analysis> {
  try {
    return validate(await generate(parts));
  } catch (e) {
    if (!(e instanceof SyntaxError) && !(e instanceof Error && e.message.startsWith("empty"))) throw e;
    return validate(await generate(parts));
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
  return JSON.parse(await generate([textPart(JSON.stringify(card))], system, cardSchema)) as CardText;
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
