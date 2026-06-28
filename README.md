# Headless Lineage 2 Client — тестирование LLM по многофазному промту

Этот репозиторий — песочница для проверки того, насколько хорошо современные LLM справляются с реализацией сложного сетевого клиента по одному длинному self-contained промпту.

Цель проекта — получить работающий **headless-клиент Lineage 2** (хроника HighFive, протокол `267`) на **Node.js 24.15.0 + TypeScript**, который без участия человека:

1. Подключается к **Login Server**, проходит аутентификацию по логину/паролю и забирает сессионные ключи.
2. Подключается к **Game Server**, используя эти ключи, выбирает персонажа по слоту и входит в игровой мир.
3. Печатает в консоль `IN_GAME`.
4. Поддерживает соединение, отвечая на серверные пинги.

Стек: Node.js, TypeScript, собственная реализация Blowfish + RSA + XOR-шифрование игрового потока. Никаких веб-фреймворков, баз данных и игровой логики (бой, движение, инвентарь) — только автологин.

## Что находится в репозитории

- [PLANE.md](PLANE.md) — **Единый промпт для LLM** на английском. Содержит полную спецификацию протокола, карту опкодов, reusable-реализации криптографии, FSM по фазам и troubleshooting.
- [.env](.env) — Шаблон конфигурации: IP/порт серверов, логин, пароль, ID игрового сервера, слот персонажа, протокол.
- [`src/`](src/) — Исходный код клиента. **Генерируется LLM по фазам** на основе [PLANE.md](PLANE.md); в начальном состоянии отсутствует.
- [`README.md`](README.md) — Этот файл — вводное описание и инструкция по пофазной работе с LLM.

## Архитектура фаз

Клиент в [PLANE.md](PLANE.md) разбит на **четыре независимые фазы**. Управление фазами происходит через переменную окружения `PHASE` (читает напрямую `index.ts`):

| Переменная                   | Что запускается                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| `PHASE=1`                    | Только PHASE 1                                                     |
| `PHASE=2`                    | Только PHASE 2                                                     |
| `PHASE=3`                    | Только PHASE 3                                                     |
| `PHASE=4`                    | Только PHASE 4                                                     |
| `PHASE=full` (или не задана) | Полная цепочка: PHASE 1 → PHASE 2 → PHASE 4. PHASE 3 пропускается. |
| `PHASE=0`                    | То же, что и `full`.                                               |

### PHASE 1 — Setup & Config

**Цель:** проект собирается, конфигурация загружается и валидируется.

**Что реализуется:**

- структура `src/`,
- `package.json` + `tsconfig.json`,
- `config.ts` — загрузка и валидация `.env`,
- `index.ts` — точка входа и dispatch по `process.env.PHASE`,
- проверка `npx tsc --noEmit`.

**Критерий готовности:** `PHASE=1 npm run dev` печатает загруженный конфиг, `tsc` без ошибок.

### PHASE 2 — Login Server

**Цель:** аутентификация на логин-сервере и получение сессионных ключей + адреса игрового сервера.

**Вход:** валидированный конфиг из PHASE 1.

**Что реализуется:**

- `Connection.ts` — TCP + реассембли пакетов по `[uint16LE size][opcode][payload]`,
- `PacketReader.ts` / `PacketWriter.ts`,
- криптография логин-сервера: `Blowfish.ts`, `NewCrypt.ts`, `ScrambledRsaKey.ts`, `RsaCrypt.ts`, `LoginCrypt.ts`,
- `LoginClient.ts` — FSM: `WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK`,
- `DebugTools.ts` — самопроверки и отчёт фазы.

**Выход:** `loginOkId1`, `loginOkId2`, `playOkId1`, `playOkId2`, `gameHost`, `gamePort`.

**Критерий готовности:** достигнут `PlayOk`, получены 4 session id и адрес игрового сервера.

### PHASE 3 — Game Auth & Character (standalone)

**Цель:** подключение к игровому серверу и выбор персонажа.

**Вход:** 4 session id + `gameHost`/`gamePort` из PHASE 2.

**Что реализуется:**

- `GameCrypt.ts` — 16-байтовое скользящее XOR для игрового потока,
- `GameClient.ts` для PHASE 3 — FSM: `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED`,
- отправка `ProtocolVersion`, `AuthRequest`, `CharacterSelected`.

**Выход:** открытое игровое соединение в состоянии `WAIT_USER_INFO`.

**Важно:** эта фаза **не используется в полной цепочке** (`PHASE=full`). Она нужна только как отдельная точка входа для отладки аутентификации на игровом сервере.

### PHASE 4 — Enter World & Keepalive

**Цель:** войти в мир и удерживать соединение.

**Вход:** 4 session id + `gameHost`/`gamePort` из PHASE 2. PHASE 4 открывает **новое** игровое соединение, не переиспользуя PHASE 3.

**Что реализуется:**

- полный игровой FSM: `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME`,
- отправка `RequestKeyMapping` (`0xD0 0x0021`) и `EnterWorld` (`0x11` + 104 нулевых байт),
- обработка `UserInfo` с печатью `IN_GAME`,
- ответ на `NetPingRequest` (`0xD3` или `0xFE 0x00D3`) пакетом `NetPing` (`0xA8`).

**Критерий готовности:** в консоли появляется `IN_GAME`, клиент отвечает на пинги и держит соединение 60 секунд.

## Как последовательно писать промты для LLM

Работа с LLM ведётся **по одной фазе за раз**. Это позволяет локализовать ошибки и не перегружать контекст модели сразу всей реализацией.

### Шаг 0. Подготовка

1. Убедитесь, что в `.env` заполнены реальные значения для вашего сервера.
2. Убедитесь, что [PLANE.md](PLANE.md) целиком помещается в контекст модели.

### Шаг 1. Первый промпт — полный контекст

Отправьте LLM сообщение следующего вида:

```text
Ты получишь один большой файл PLANE.md. Это техническое задание на headless Lineage 2 клиент.
Не приступай к коду сразу. Сначала внимательно изучи файл, особенно разделы:
- HARD CONSTRAINTS
- OPCODE MAP
- REUSABLE CODE — COPY VERBATIM
- PHASES
- TROUBLESHOOTING

После этого я буду запрашивать реализацию по фазам: PHASE 1, PHASE 2, PHASE 3 (опционально), PHASE 4.
Каждая фаза должна заканчиваться рабочим отчётом в формате:
=== PHASE <n> REPORT ===
status: PASS | FAIL
self-tests: <passed>/<total>
state-path: ...
artifacts: ...
notes: ...
```

Затем вставьте содержимое [PLANE.md](PLANE.md).

### Шаг 2. Пофазная реализация

Для каждой фазы используйте один из следующих промптов.

#### PHASE 1

```text
Реализуй PHASE 1 — Setup & Config.

Требования:
- Создай структуру проекта из PLANE.md.
- Напиши package.json, tsconfig.json, .env.example.
- Напиши config.ts: загрузка .env через dotenv, parseInt для чисел, чёткая ошибка при отсутствии обязательных значений.
- Напиши index.ts: точка входа, читает process.env.PHASE напрямую, выводит загруженный конфиг.
- Добавь скрипты dev/typecheck/build.
- Запусти npx tsc --noEmit и убедись, что ошибок нет.
- Выведи PHASE 1 REPORT в формате из PLANE.md.

Запуск: PHASE=1 npm run dev
```

#### PHASE 2

```text
Реализуй PHASE 2 — Login Server.

Требования:
- Используй reusable-код из PLANE.md (PacketReader, PacketWriter, Connection, Blowfish, NewCrypt, ScrambledRsaKey, RsaCrypt, LoginCrypt) — копируй дословно.
- Напиши LoginClient.ts с FSM из PLANE.md.
- Перед сокетным вводом-выводом запусти runCryptoSelfTests().
- Логируй каждый переход состояния через logState.
- При LoginFail / PlayFail выводи FAIL.
- Выведи PHASE 2 REPORT с артефактами: loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort.

Запуск: PHASE=2 npm run dev
```

#### PHASE 3 (опционально)

```text
Реализуй PHASE 3 — Game Auth & Character.

Требования:
- Используй 4 session id и gameHost/gamePort из PHASE 2 (вставь их как входные данные или передай через артефакты PHASE 2).
- Реализуй GameCrypt.ts и интегрируй его в GameClient.ts.
- FSM: WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED.
- Проверь charCount >= 1.
- Выведи PHASE 3 REPORT.

Запуск: PHASE=3 npm run dev
```

#### PHASE 4

```text
Реализуй PHASE 4 — Enter World & Keepalive.

Требования:
- Открой новое игровое соединение, используя артефакты PHASE 2.
- FSM: WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME.
- При получении UserInfo напечатай IN_GAME.
- Отвечай на каждый NetPingRequest (0xD3 или 0xFE 0x00D3) пакетом NetPing (0xA8).
- Держи соединение 60 секунд, затем корректно закрой сокет.
- Выведи PHASE 4 REPORT.

Запуск: PHASE=4 npm run dev
```

### Шаг 3. Полная цепочка

После успешной отладки отдельных фаз запустите:

```bash
npm run dev
```

Это эквивалентно `PHASE=full` и выполняет: PHASE 1 → PHASE 2 → PHASE 4. PHASE 3 пропускается.

## Запуск

```bash
# 1. Установка зависимостей (появится после PHASE 1)
npm install

# 2. Проверить/заполнить .env
#    L2_LOGIN_IP, L2_LOGIN_PORT, L2_GAME_PORT,
#    L2_USERNAME, L2_PASSWORD,
#    L2_SERVER_ID, L2_CHAR_SLOT, L2_PROTOCOL

# 3. Запуск по фазам
PHASE=1 npm run dev
PHASE=2 npm run dev
PHASE=3 npm run dev   # опционально
PHASE=4 npm run dev

# 4. Полная цепочка
npm run dev
```

## Definition of Done

Проект считается успешно реализованным, если:

- `npx tsc --noEmit` не выдаёт ошибок.
- `PHASE=1 npm run dev` печатает валидный конфиг.
- `PHASE=2 npm run dev` доходит до `PlayOk` и возвращает 4 session id.
- `PHASE=4 npm run dev` (или просто `npm run dev`) печатает `IN_GAME`.
- Клиент остаётся подключённым не менее 60 секунд, отвечая на серверные пинги.

## Советы

- **Не меняйте опкоды** — в [PLANE.md](PLANE.md) используется собственная карта HighFive, не «учебная».
- **Копируйте reusable-код дословно** — алгоритмы Blowfish, RSA, XOR описаны именно в том виде, в котором их ожидает сервер.
- **Honor the crypt flag:** игра включает XOR-шифрование только если `CryptInit` прислал `encryptionFlag !== 0`.
- **Connection.send()** сам добавляет 2-байтовый little-endian префикс длины; не добавляйте его повторно.
- **EnterWorld** требует предварительного `RequestKeyMapping` (`0xD0 0x0021`) и ровно 104 нулевых байта после опкода `0x11`.
- Если сервер пропускает `CharSelected` и сразу шлёт `UserInfo` — обработайте это; не отправляйте `EnterWorld` дважды.

## Лицензия

Проект создаётся в образовательных/исследовательских целях для тестирования возможностей LLM. Используйте ответственно и только на серверах, где у вас есть разрешение.
