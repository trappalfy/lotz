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
| Цена свободного участка | 7000 токенов на ступени 0 (`BASE_PRICE_TOKENS=7000`, в программе `7000 × 10^decimals`), фиксируется навсегда; вся доска первой продажей ≈232.8 млн токенов, около 23% саплая |
| Модерация картинок | локальная модель в индексере и при загрузке (DECISIONS B11) |
| Закрытие | upgrade authority остаётся у `9PeMBb…`; `wind-down` закрывает всё и возвращает SOL (раздел «Закрыть Lotz») |
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
3. **SOL на `9PeMBb…`: 4.6 SOL** (нужно 4.49, плюс небольшой запас). Всё, кроме комиссий, возвращается при
   закрытии Lotz (раздел «Закрыть Lotz»). Цифры измерены на локальном валидаторе тем же файлом программы; аренда в
   mainnet считается так же:
   - 3.243 — деплой программы: аренда аккаунта программы (465 КБ) и комиссии. Буфер деплоя отдельных денег не
     требует: при деплое загрузчик переносит его баланс в аккаунт программы. Проверено: деплой прошёл с кошелька, на
     котором было ровно столько, сколько стоит аренда;
   - 1.214 — 100 шардов доски (по 0.0121);
   - 0.025 — lookup table;
   - 0.0065 — конфиг и два хранилища (лок и возвраты);
   - меньше 0.001 — комиссии запуска (около 20 транзакций).

   Если деплой прервётся, недописанный буфер держит около 3.24 SOL. Их возвращает команда
   `solana program close --buffers` (шаг 2).

> Админ, treasury и upgrade authority — один и тот же кошелёк, и upgrade authority остаётся у него (так можно вернуть
> SOL при закрытии). Его ключ полностью управляет программой, а значит, и локом. Не подписывайте этим кошельком
> ничего на сторонних сайтах и храните `keys/admin.json` только на этом компьютере.

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
4. База — Neon, создаётся напрямую на neon.tech (интеграция Vercel не нужна): проект `lotz`, регион AWS US East 1
   (N. Virginia). Строки подключения — кнопка **Connect**: с **Connection pooling** (хост с `-pooler`) в
   `DATABASE_URL` для сайта, без него в `DATABASE_URL_UNPOOLED` для индексера (ему нужен LISTEN). Обе вносит в
   сервисы `pnpm --filter @lotz/ops` по `.env.mainnet`.
   Тариф: индексер держит соединение постоянно, поэтому база не засыпает: около 180 CU-часов в месяц при 0.25 CU.
   Free даёт 100 CU-часов на проект, их хватит недели на две. До открытия покупок перейти на Launch
   (около $0.106 за CU-час, то есть примерно $20 в месяц).
5. **Settings → Functions → Region:** Washington, D.C. (`iad1`), рядом с базой.
6. **Settings → Environment Variables** (Production), см. таблицу ниже. Обязательно
   `ENABLE_EXPERIMENTAL_COREPACK=1`, чтобы Vercel ставил пакеты той же версией pnpm (12.14.0).
7. **Settings → Domains:** `lotz.fun`. До этого в переменных должен быть `SITE_ACCESS_KEY` (раздел «Сайт закрыт до
   запуска»), чтобы по домену посторонние видели пустую страницу.
8. Желательно: **Firewall → Rate limiting** — правило на `/api/upload` и `/api/rpc` (например, 60 запросов в
   минуту с одного IP). В коде лимиты тоже есть, но на уровне Vercel они срабатывают раньше.

### 1.4 Railway: индексер

1. **New Project → Deploy from GitHub repo →** `trappalfy/lotz`. Railway сам заводит по сервису на каждый пакет
   монорепозитория; нужен только индексер.
2. Устройство проекта описано в `.railway/railway.ts` (формат Railway вместо устаревшего `railway.json`, который
   перестаёт работать 1 декабря 2026): один сервис `@lotz/indexer`, сборка по `apps/indexer/Dockerfile`, проверка
   `/health`, одна реплика в регионе `us-east4-eqdc4a` (Virginia, рядом с Neon), домен `live.lotz.fun`.
   Применить: `railway link` (проект, сервис `@lotz/indexer`), затем `railway config plan` и `railway config apply`.
   Всё, чего нет в файле, `apply` из проекта удаляет. SDK для файла ставится отдельно: `cd .railway && npm install`.
   В этом файле регион пишется только ID (`us-east4-eqdc4a`). Псевдоним `us-east` записывается как есть, и
   сборки встают в очередь навсегда.
3. Переменные в файл не входят (секреты не попадают в репозиторий). Их вносит
   `pnpm --filter @lotz/ops hosting --apply` из `.env.mainnet`: в Vercel через API, в Railway через CLI. Там же
   регистрируется домен `live.lotz.fun`: Railway выдаёт CNAME для Cloudflare (DNS only). `DATABASE_URL` у индексера —
   **прямое** соединение Neon, без пулера: ему нужен `LISTEN`.
4. Индексер сам создаёт таблицы в базе (миграции). До деплоя программы он просто ждёт; `/health` отвечает сразу.

### 1.5 Webhook Helius (необязательно, ускоряет обновления)

Helius → **Webhooks → New**: тип *raw*, адрес аккаунта `LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa`, URL
`https://live.lotz.fun/webhooks/helius`, Authorization header = `HELIUS_WEBHOOK_SECRET`.

## Сайт закрыт до запуска

Пока в Vercel задан `SITE_ACCESS_KEY`, весь сайт (страницы, API, файлы) отвечает посторонним пустой страницей со
звездой и словом Lotz, код 404 и `noindex`. Ключ лежит в `.env.mainnet`, там же готовая ссылка для входа
`https://lotz.fun/?access=<ключ>`. Открыть её нужно один раз в каждом браузере (и в браузере кошелька на телефоне):
браузер получает cookie на год, ключ из адреса убирается. Для адреса `*.vercel.app` cookie отдельная: в ссылке
замените домен.

Открыть сайт всем: очистить `SITE_ACCESS_KEY` в `.env.mainnet`, удалить переменную в Vercel (Settings → Environment
Variables) и сделать Redeploy. Закрыть снова: задать новый ключ и Redeploy. Старые cookie после смены ключа не
действуют.

Индексер (`live.lotz.fun`) и картинки (`cdn.lotz.fun`) этим ключом не закрыты: это данные без страниц сайта.

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
покажет стоимость, цену участка (7000 токенов) и какую долю саплая займёт вся доска. `TOKEN_PRICE_USD` необязателен:
он только добавляет к плану суммы в долларах.

```sh
RPC_URL="<RPC_URL>" PROGRAM_ID=LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa \
TOKEN_MINT=<адрес минта> TREASURY=9PeMBb8kkpRDwRDEQYREgQkqkJKKmbMx1wXzFmoyHNcM \
ADMIN_KEYPAIR=keys/admin.json BASE_PRICE_TOKENS=7000 \
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

## Шаг 5. Upgrade authority: оставить

Чтобы при закрытии вернуть SOL, право обновления программы должно остаться у `9PeMBb…`: закрыть программу может
только оно. Поэтому `--final` не делаем. Сайт честно показывает `upgradeable` (бриф §11).

Если когда-нибудь решите сделать программу неизменяемой, это одна команда, но после неё SOL из аккаунта программы
(~3.24) уже не вернуть никогда:

```sh
solana program set-upgrade-authority LotzPiCxGrRhn8of391L6gPNTMnWXNwUdKyuiSoJaaa --final \
  --keypair keys/admin.json --url "<RPC_URL>"
```

---

## Закрыть Lotz и вернуть SOL

Одна команда, сначала без `--execute` (только показывает план и сколько вернётся):

```sh
pnpm --filter @lotz/ops wind-down              # план
pnpm --filter @lotz/ops wind-down --execute    # закрыть; попросит ввести CLOSE
```

Что она делает, по порядку (порядок закреплён в программе):

1. ставит покупки на паузу и отправляет на treasury все недели лока, у которых прошёл год;
2. переводит доску в состояние «retired» навсегда: покупки и снятие паузы больше невозможны;
3. отправляет прежним владельцам их невыплаченные возвраты и закрывает все объявления: аренда каждого объявления
   уходит его владельцу;
4. закрывает записи недель, 100 шардов, пустые хранилища и конфиг: аренда уходит на `9PeMBb…`;
5. отключает и закрывает lookup table (между этими шагами сеть требует подождать ~3.5 минуты);
6. закрывает саму программу: её аренда уходит на `9PeMBb…`.

Возвращается всё, что было внесено при запуске (~4.49 SOL), минус комиссии (меньше 0.01 SOL). На локальном
валидаторе это проверено тестом целиком, вместе с закрытием программы.

**Если в локе ещё есть токены.** Ни одна из этих инструкций не может вывести токены из лока раньше срока. Поэтому
команда остановится и скажет дату последней разблокировки. Два варианта:
- подождать эту дату (год после последней недели с покупками): тогда всё уйдёт на treasury, и закроется всё;
- закрыть сразу с `--strand-locked`: ещё не разблокированные токены останутся в локе навсегда (их никто не сможет
  забрать, в том числе treasury), а остальное закроется и SOL вернутся так же.

Если команда прервётся, её можно просто запустить снова: каждый шаг сначала проверяет, что уже сделано.

После закрытия сайт перестанет работать: выключите проекты в Vercel и Railway.

## Цифры для постов

Сколько процентов supply токена лежит в локе:

- **на сайте:** раздел The Lock, под «In the lock now»;
- **JSON для ботов:** `https://lotz.fun/api/lock` (`sharePercent`, `lockedNow`, `supply`, ссылка на картинку `card`);
- **картинка 1200×675 для X:** `https://cdn.lotz.fun/share/lock.png`; индексер перерисовывает её в течение минуты после изменения цифр;
- **прямо из блокчейна, с готовым текстом поста:** `pnpm --filter @lotz/ops lock-stats` (заодно сверяет баланс хранилища лока со счётчиками программы).

Доля считается от общего supply минта и всегда округляется вниз. Токены, которые ждут возврата прежним владельцам,
в неё не входят.

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
| `SITE_ACCESS_KEY` | ✓ | | до запуска: сайт закрыт для всех без ключа; удалить, чтобы открыть |
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
- [ ] Neon на тарифе Launch (на Free база остановится, когда кончатся 100 CU-часов месяца).
- [ ] Когда решите открыть сайт: `SITE_ACCESS_KEY` удалён в Vercel и в `.env.mainnet`, Redeploy, сайт открывается
      в приватном окне.
- [ ] Тестовая загрузка картинки проходит (это заодно проверит R2 и модель модерации на Vercel).
