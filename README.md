# bot-archive

Telegram-бот-архив (MVP): ссылка / скрин / голосовое → «принято» → Gemini достаёт суть → ответ редактируется на итог.
Стек: Node 22 + grammY (long polling) · Supabase Postgres + pgvector · Gemini · yt-dlp + gallery-dl · Railway.

## Деплой на Railway
1. New Project → Deploy from GitHub → этот репозиторий (соберётся по `Dockerfile`).
2. Variables — из `.env.example`:
   - `BOT_TOKEN` — от @BotFather
   - `OWNER_ID` — 585800070
   - `SUPABASE_URL` — https://fjkjqkqzkjjuusonbyep.supabase.co
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys → `service_role` / secret
   - `GEMINI_API_KEY` — Google AI Studio (с привязанной оплатой)
3. Канал-архив: добавить бота админом в приватный канал → бот сам запомнит канал и напишет «канал-архив подключён». (Или задать `ARCHIVE_CHANNEL_ID`.)
4. Шаг 0 — проверка TikTok с IP Railway: `/probe <10 ссылок через пробел>` → по каждой видно, какой путь сработал (yt-dlp / tikwm / gallery-dl / embed / oembed).

Схема БД — `supabase/migrations/` (обе применены к проекту). Имена полей — по SPEC.md §2; отличия, где решил MVP, описаны в `002_align_spec.sql`.

## Как устроено
- `src/bot.ts` — приём, whitelist, альбомы (буфер 1,5 с → один ответ), команды `/recent` `/theme` `/type` `/probe`.
- `src/worker.ts` — очередь в `items.status`: `queued → processing → ok | pending_media | failed | duplicate`; `pending_media` повторяется раз в сутки после `yt-dlp -U` (до 7 раз).
- `src/fetchers.ts` — TikTok: yt-dlp → TikWM → gallery-dl (слайдшоу) → embed → oEmbed; Reels через yt-dlp; YouTube-субтитры; текст страниц.
- `src/gemini.ts` — единственная точка вызова модели (`GEMINI_MODEL` + `GEMINI_FALLBACK_MODELS`), JSON по схеме, эмбеддинг 1536.
- `src/config.ts` — список тем и типов.
