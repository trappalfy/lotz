# Запуск Lotz в mainnet

Всё, что касается mainnet, делает владелец (бриф §11). Скрипты в репозитории сами ничего не отправляют:
`launch` без `--execute` только показывает план, а с `--execute` просит ввести слово `LAUNCH`.

## Что уже решено

| Что | Значение |
|---|---|
| Адрес программы | `LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa` (ключ: `keys/lotz-program.json`, не в git) |
| Treasury | `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM` (обычный кошелёк, проверен в mainnet) |
| Админ и upgrade authority | `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM` (тот же кошелёк) |
| Модераторы (`ADMIN_WALLET`) | `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM`, можно добавить другие через запятую |
| Исходники (`NEXT_PUBLIC_SOURCE_URL`) | `https://github.com/trappalfy/lotz` |
| Цена свободного участка | $5 по курсу токена в момент запуска; в токенах фиксируется навсегда, округляется до трёх значащих цифр |
| Модерация картинок | локальная модель в индексере и при загрузке (DECISIONS B11) |
| Хостинг | Vercel (сайт), Neon через Vercel (Postgres), Railway (индексер), Cloudflare R2 (картинки), Helius (RPC) |

Ещё нужно: адрес минта токена (в самом конце), ссылка на X, домен.

## Где хранить ключи

Все значения для mainnet лежат в одном файле `.env.mainnet` в корне репозитория. Он в `.gitignore`, в git не
попадёт. Разделы, помеченные `YOU`, заполняет владелец; остальное уже вписано или генерируется. Проверка ниже
сверяет каждое значение с настоящим сервисом и не выводит ни одного секрета:

```sh
pnpm --filter @lotz/ops check-mainnet
```

Она ничего не отправляет в блокчейн. Единственная запись — крошечный тестовый файл в R2, который сразу удаляется.

## Как устроено

```
браузер ──▶ Vercel: сайт и API (короткие запросы)  ──▶ Neon Postgres (через пулер)
   │                                                        ▲
   └──────▶ Railway: индексер ──────────────────────────────┘ (прямое соединение)
            /stream — живые обновления для браузеров
            слушает программу через Helius, рисует доску, проверяет картинки
            картинки и рендеры доски ──▶ Cloudflare R2 ──▶ CDN-домен
```

Индексер нельзя запустить на Vercel. Он круглосуточно слушает блокчейн, держит доску 4000×4000 в памяти и
открытые соединения со всеми зрителями, а функции Vercel живут секунды или минуты. Поэтому для индексера нужен один
постоянно работающий контейнер. Сайт и API на Vercel работают как обычно.

---

## Шаг 0. Ключи и SOL

1. **Сохраните копию `keys/lotz-program.json`** в надёжное место вне репозитория. Файл нужен один раз, для
   первого деплоя. До деплоя он секретный: с ним кто угодно может занять этот адрес.
2. **Ключ админа.** Деплой и запуск подписываются файлом. Экспортируйте приватный ключ кошелька `9PeMBb…`
   (Phantom: Settings → аккаунт → Show private key) и сохраните его командой ниже. Ввод скрыт, ключ попадает только в
   файл, а команда проверит, что ключ именно от этого адреса:
   ```sh
   pnpm --filter @lotz/ops import-key keys/admin.json 9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM
   ```
3. **SOL на `9PeMBb…`: около 7.2 SOL.** В итоге уйдёт около 4.2 SOL:
   - ~2.95 — аренда аккаунта программы (остаётся в нём);
   - ~2.95 — временный буфер при деплое (возвращается сразу после деплоя);
   - ~1.2 — 100 шардов доски;
   - ~0.03 — lookup table, конфиг и хранилища;
   - ~0.05 — комиссии (около 430 транзакций деплоя).

> Админ, treasury и upgrade authority — один и тот же кошелёк. Пока у программы есть upgrade authority, его ключ
> полностью управляет программой, а значит, и локом. Не подписывайте этим кошельком ничего на сторонних сайтах до
> шага 5. После шага 5 у админа останется только пауза покупок.

## Шаг 1. Сервисы (можно сделать заранее, до токена)

### 1.1 Helius (RPC)

1. Зарегистрируйтесь на dashboard.helius.dev и откройте раздел **API Keys**.
2. Сохраните для шагов 1.3 и 1.4:
   - `RPC_URL` = `https://mainnet.helius-rpc.com/?api-key=<ключ>`;
   - `RPC_WS_URL` = `wss://mainnet.helius-rpc.com/?api-key=<ключ>`.

### 1.2 Домен и Cloudflare R2 (картинки)

1. Подключите домен (например, `lotz.fun`) к Cloudflare: DNS должен быть в Cloudflare.
2. **R2 → Create bucket**, например `lotz-media`.
3. В бакете: **Settings → Custom Domains → Connect domain**, например `cdn.lotz.fun`.
4. **R2 → Manage API tokens → Create API token**, права *Object Read & Write* только на этот бакет. Сохраните:
   - Access Key ID → `STORAGE_S3_ACCESS_KEY_ID`;
   - Secret Access Key → `STORAGE_S3_SECRET_ACCESS_KEY`;
   - endpoint `https://<account_id>.r2.cloudflarestorage.com` → `STORAGE_S3_ENDPOINT`.

### 1.3 Vercel: сайт и база

1. **Add New → Project → Import** репозитория `trappalfy/lotz`.
2. **Root Directory:** `apps/web`. Framework определится сам (Next.js). Команды сборки и установки оставьте по
   умолчанию.
3. **Settings → General → Node.js Version:** 24.x.
4. **Storage → Create Database → Neon (Postgres)**, регион `us-east-1` (Washington), подключить к проекту.
   Vercel сам добавит переменные. Сайт использует `DATABASE_URL` (соединение через пулер). Прямое соединение
   (`DATABASE_URL_UNPOOLED` — проверьте точное имя во вкладке Environment Variables) понадобится индексеру.
5. **Settings → Functions → Region:** Washington, D.C. (`iad1`), рядом с базой.
6. **Settings → Environment Variables** (Production), см. таблицу ниже. Обязательно
   `ENABLE_EXPERIMENTAL_COREPACK=1`, чтобы Vercel ставил пакеты той же версией pnpm (12.14.0).
7. **Settings → Domains:** `lotz.fun`.
8. Желательно: **Firewall → Rate limiting** — правило на `/api/upload` и `/api/rpc` (например, 60 запросов в
   минуту с одного IP). В коде лимиты тоже есть, но на уровне Vercel они срабатывают раньше.

### 1.4 Railway: индексер

1. **New Project → Deploy from GitHub repo →** `trappalfy/lotz`.
2. В настройках сервиса: Root Directory пустой (корень репозитория), сборка по Dockerfile:
   переменная `RAILWAY_DOCKERFILE_PATH=apps/indexer/Dockerfile`.
3. **Variables:** см. таблицу ниже. `DATABASE_URL` здесь — **прямое** соединение Neon, без пулера: индексеру
   нужен `LISTEN`.
4. **Settings → Networking:** публичный домен. Лучше свой, например `live.lotz.fun` (CNAME в Cloudflare). Порт
   Railway передаёт сам через `PORT`.
5. **Health check path:** `/health`.
6. **Ровно одна реплика**, памяти не меньше 1 ГБ (доска в памяти занимает 64 МБ, модель модерации около 300 МБ).
7. После запуска индексер сам создаст таблицы в базе (миграции). До деплоя программы он просто ждёт.

### 1.5 Webhook Helius (необязательно, ускоряет обновления)

Helius → **Webhooks → New**: тип *raw*, адрес аккаунта `LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa`, URL
`https://live.lotz.fun/webhooks/helius`, Authorization header = `HELIUS_WEBHOOK_SECRET`.

## Шаг 2. Деплой программы

```sh
anchor build && pnpm idl            # сборка с адресом LotzPiCx…
pnpm test:anchor                    # все тесты зелёные
solana program deploy target/deploy/lotz.so \
  --program-id keys/lotz-program.json \
  --keypair keys/admin.json --upgrade-authority keys/admin.json \
  --url "<RPC_URL из Helius>" --with-compute-unit-price 10000 --max-sign-attempts 50 --use-rpc
```

Если деплой прервался, повторите ту же команду. Буфер, оставшийся от прерванной попытки, возвращает SOL:
`solana program close --buffers --keypair keys/admin.json --url <RPC_URL>`.

## Шаг 3. Запуск: initialize, шарды, lookup table (когда есть токен)

Сначала пробный запуск. Он проверит минт (freeze authority, расширения Token-2022), treasury и upgrade authority,
покажет стоимость и цену участка в токенах и долларах ($5 по курсу `TOKEN_PRICE_USD`, курс возьмите с DexScreener или
Jupiter прямо перед запуском):

```sh
RPC_URL="<RPC_URL>" PROGRAM_ID=LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa \
TOKEN_MINT=<адрес минта> TREASURY=9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM \
ADMIN_KEYPAIR=keys/admin.json BASE_PRICE_USD=5 TOKEN_PRICE_USD=<цена токена в $ сейчас> \
TIER_SIZE=1000 TIER_MULT_BPS=12500 MAX_RECT=10 START_PAUSED=true PRIORITY_FEE_MICROLAMPORTS=10000 \
pnpm --filter @lotz/ops launch
```

Затем та же команда с `-- --execute`. Скрипт выведет адрес lookup table: впишите его в `LOOKUP_TABLE` на Vercel
и пересоберите сайт (**Deployments → Redeploy**). Повторный запуск безопасен: сделанные шаги пропускаются.

## Шаг 4. Открыть покупки

Пройдите чек-лист ниже, затем:

```sh
RPC_URL="<RPC_URL>" PROGRAM_ID=LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa TOKEN_MINT=<минт> \
TREASURY=9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM ADMIN_KEYPAIR=keys/admin.json \
pnpm --filter @lotz/ops pause false
```

## Шаг 5. Убрать или передать upgrade authority

Когда решите, что программа финальная:

```sh
solana program set-upgrade-authority LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa --final \
  --keypair keys/admin.json --url "<RPC_URL>"
```

Сайт сам покажет `immutable` (он читает аккаунт ProgramData). Если хотите сохранить возможность исправлений,
вместо `--final` передайте право обновления в мультисиг Squads (`--new-upgrade-authority <vault>
--skip-new-upgrade-authority-signer-check`). После этого удалите `keys/admin.json` с компьютера.

---

## Переменные окружения

| Переменная | Vercel (сайт) | Railway (индексер) | Значение |
|---|:-:|:-:|---|
| `RPC_URL` | ✓ | ✓ | Helius, `https://mainnet.helius-rpc.com/?api-key=…` |
| `RPC_WS_URL` | | ✓ | Helius, `wss://mainnet.helius-rpc.com/?api-key=…` |
| `PROGRAM_ID` | ✓ | ✓ | `LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa` |
| `LOOKUP_TABLE` | ✓ | | из вывода шага 3 |
| `NEXT_PUBLIC_CLUSTER` | ✓ | | `mainnet-beta` |
| `PRIORITY_FEE_MICROLAMPORTS` | ✓ | | `10000` (приоритетная комиссия для покупок) |
| `ADMIN_WALLET` | ✓ | | `9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM` |
| `DATABASE_URL` | ✓ (через пулер, добавит Vercel) | ✓ (прямое) | Neon |
| `STORAGE_DRIVER` | ✓ | ✓ | `s3` |
| `STORAGE_PUBLIC_URL` | ✓ | ✓ | `https://cdn.lotz.fun` |
| `STORAGE_S3_ENDPOINT` | ✓ | ✓ | `https://<account_id>.r2.cloudflarestorage.com` |
| `STORAGE_S3_REGION` | ✓ | ✓ | `auto` |
| `STORAGE_S3_BUCKET` | ✓ | ✓ | `lotz-media` |
| `STORAGE_S3_ACCESS_KEY_ID` | ✓ | ✓ | из R2 |
| `STORAGE_S3_SECRET_ACCESS_KEY` | ✓ | ✓ | из R2 |
| `NEXT_PUBLIC_SITE_URL` | ✓ | | `https://lotz.fun` |
| `SESSION_SECRET` | ✓ | | `openssl rand -hex 32` |
| `NEXT_PUBLIC_X_URL` | ✓ | | `https://x.com/<аккаунт>` |
| `NEXT_PUBLIC_SOURCE_URL` | ✓ | | `https://github.com/trappalfy/lotz` |
| `STREAM_URL` | ✓ | | `https://live.lotz.fun/stream` |
| `NSFW_FILTER` | ✓ | ✓ | `on` |
| `ENABLE_EXPERIMENTAL_COREPACK` | ✓ | | `1` |
| `INDEXER_HOST` | | ✓ | `0.0.0.0` (уже задано в Dockerfile) |
| `HELIUS_WEBHOOK_SECRET` | | ✓ | `openssl rand -hex 32`, тот же, что в webhook Helius |

Переменные `NEXT_PUBLIC_*` попадают в сборку. После их изменения нужен Redeploy.

## Чек-лист перед открытием покупок

- [ ] `pnpm test:anchor`, `pnpm -r test` и `pnpm --filter @lotz/web e2e` (на локальном стенде) зелёные.
- [ ] Пробный запуск `launch` с настоящим минтом прошёл без предупреждений.
- [ ] `https://live.lotz.fun/health` отвечает `{"ok":true}`, в логах Railway есть `initial sync done`.
- [ ] Сайт с телефона: доска, Buy lots, панель покупки, `/me`.
- [ ] `prefers-reduced-motion` выключает вспышки и мигание.
- [ ] Каждая ссылка объявления открывает модалку выхода с доменом.
- [ ] Раздел The Lock показывает верные адреса и `upgradeable`/`immutable`.
- [ ] Вход в `/admin` кошельком `9PeMBb…`, блокировка тестового домена скрывает и возвращает объявление.
- [ ] Тестовая загрузка картинки проходит (это заодно проверит R2 и модель модерации на Vercel).
