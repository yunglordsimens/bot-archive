import { GoogleGenAI, Type, type Part } from "@google/genai";
import { config, PROJECTS, THEMES, TYPES } from "./config.js";
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
    raw_text: { type: Type.STRING, description: "Транскрипт: дословно, что говорят (+ текст на экране), на языке оригинала. Без пересказа и без описания картинки" },
    visual_description: { type: Type.STRING, description: "Что в кадре: кто, где, действия, монтаж. Коротко; подробно — если речи мало или ценность в картинке" },
    value_in: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...VALUE_IN] }, description: "Где ценность: info / visual / audio / format / meta; можно несколько" },
    stance: { type: Type.STRING, enum: [...STANCES], description: "Догадка об отношении пользователя" },
    comments_note: { type: Type.STRING, description: "Полезное из комментариев (уточнения, ссылки, ответы автора, спор) одной строкой; пусто, если ничего" },
    entity: { type: Type.STRING, enum: ["person", "company", "none"], description: "Для профилей: человек или компания; иначе none" },
    language: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Языки в контенте, ISO-коды: ru, uk, cs, en…" },
  },
  required: ["title", "summary", "content_type", "kind", "theme", "project", "why_me", "tags", "structured", "raw_text", "visual_description", "value_in", "stance", "comments_note", "entity", "language"],
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
- Три разных текста, не смешивай: raw_text — транскрипт (что говорят + надписи в кадре; описание под видео и комментарии туда НЕ включай), summary — суть своими словами, visual_description — что видно в кадре.
- value_in — где ценность: info (информация), visual (картинка), audio (звук, трек, голос), format (как сделано, приём), meta (зацепило на мета-уровне). Можно несколько.
- stance — отношение пользователя: like, dislike, anti_example (как не надо), replicate (хочу повторить), format_idea (идея для формата), seen_before (уже видела такое); для профилей ещё example, interesting. Если пользователь дал подсказку — бери её, она главнее твоей догадки.
- comments_note — только если в комментариях есть что-то полезное (уточнение, ссылка, рецепт целиком, ответ автора, спор по сути); иначе пустая строка.
- Профиль (аккаунт человека или компании): summary — кто это, о чём и в каком формате контент, визуальный стиль; why_me — чем это пример или антипример для пользователя; entity — person / company.
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
  a.visual_description ??= "";
  a.value_in = [...new Set((a.value_in ?? []).filter((v) => (VALUE_IN as readonly string[]).includes(v)))];
  if (!(STANCES as readonly string[]).includes(a.stance)) a.stance = "like";
  a.comments_note = (a.comments_note ?? "").trim();
  a.entity ??= "none";
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
Запрещены общие места вроде «яркий визуал привлекает внимание», «эмоциональный контент вовлекает» — только конкретные детали этого ролика. Пиши по-русски.`;

export async function analyzeFormat(parts: Part[]): Promise<Hook> {
  return JSON.parse(await generate(parts, HOOK_SYSTEM, hookSchema)) as Hook;
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
