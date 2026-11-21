# Решения владельца

Состояние на 2026-11-21. В mainnet ничего не отправлялось.

## Решено

| # | Вопрос | Решение |
|---|---|---|
| Q3 | Treasury | `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`: обычный кошелёк, в mainnet принадлежит System Program, программа его примет. |
| Q4 | Ключ админа | Тот же кошелёк `9PeMBb…`, без смены (ротации). Ключ для деплоя и запуска импортируется в `keys/admin.json` (`pnpm --filter @lotz/ops import-key`). |
| Q5 | Адрес программы | `LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa`, ключ в `keys/lotz-program.json` (в git не попадает). Прописан в программе, `Anchor.toml` и IDL. |
| Q7 | Ссылки | Исходники: `https://github.com/trappalfy/lotz`. X: ждём ссылку (в `.env` пока пусто). |
| Q8 | Хостинг | Vercel (сайт), Neon через Vercel (Postgres), Railway (индексер), Cloudflare R2 (картинки), Helius (RPC). Порядок действий — в [DEPLOY.md](DEPLOY.md). |
| Q9 | Git | Репозиторий `github.com/trappalfy/lotz`, первый коммит сделан. |
| Q2 | `BASE_PRICE` | $5 за свободный участок по курсу токена в момент запуска (`BASE_PRICE_USD=5`, `TOKEN_PRICE_USD`); в токенах округляется до трёх значащих цифр и фиксируется навсегда. |
| Q10 | Модерация | Локальная модель (nsfwjs) при загрузке и в индексере, см. DECISIONS B11. Модераторы в `/admin` по-прежнему решают последними. |

## Открыто

| # | Вопрос | Что нужно |
|---|---|---|
| Q1 | Минт токена | Адрес, в самом конце. Пробный запуск `launch` проверит freeze authority и расширения Token-2022. |
| Q6 | SOL на запуск | Около 7.2 SOL на `9PeMBb…`, из них в итоге уйдёт около 4.2 (DEPLOY, шаг 0). |
| Q11 | Домен | Например, `lotz.fun` (он уже нарисован на OG-картинке), плюс поддомены `cdn.` (R2) и `live.` (индексер). |
