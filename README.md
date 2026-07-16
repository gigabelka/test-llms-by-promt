# Headless Lineage 2 Client — тестирование LLM по многофазному промту

Этот репозиторий — песочница для проверки того, насколько хорошо современные LLM справляются с реализацией сложного сетевого клиента по одному длинному self-contained промпту.

Цель проекта — получить работающий **headless-клиент Lineage 2** (хроника HighFive, протокол `267`) на **Node.js 24.15.0 + TypeScript**, который без участия человека:

1. Подключается к **Login Server**, проходит аутентификацию по логину/паролю и забирает сессионные ключи.
2. Подключается к **Game Server**, используя эти ключи, выбирает персонажа по слоту и входит в игровой мир.
3. Печатает в консоль `IN_GAME`.
4. Поддерживает соединение, отвечая на серверные пинги.

Стек: Node.js, TypeScript, собственная реализация Blowfish + RSA + XOR-шифрование игрового потока. Никаких веб-фреймворков, баз данных и игровой логики (бой, движение, инвентарь) — только автологин.

## Что находится в репозитории

- [PLANE.md](PLANE.md) — **Единый промпт для LLM** на английском. Содержит полную спецификацию для создания клиента: протокол, карту опкодов, reusable-реализации криптографии, FSM логин- и гейм-сервера, диспетчер `PHASE`, формат отчётов и troubleshooting. Описания фаз работы находятся в этом README.
- [.env](.env) — Шаблон конфигурации: IP/порт серверов, логин, пароль, ID игрового сервера, слот персонажа, протокол.
- [`src/`](src/) — Исходный код клиента. **Генерируется LLM по фазам** на основе [PLANE.md](PLANE.md); в начальном состоянии отсутствует.
- [`README.md`](README.md) — Этот файл — вводное описание и инструкция по пофазной работе с LLM.

## Архитектура фаз

Работа разбита на **пять независимых фаз**. Каждая фаза реализуется отдельным промптом (см. ниже) и завершается self-debug отчётом. Управление фазами происходит через переменную окружения `PHASE` (читает напрямую `index.ts`; семантика диспетчера описана в [PLANE.md](PLANE.md), раздел «PHASE dispatcher»):

| Переменная                   | Что запускается                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| `PHASE=1`                    | Только PHASE 1                                                     |
| `PHASE=2`                    | Только PHASE 2                                                     |
| `PHASE=3`                    | Только PHASE 3                                                     |
| `PHASE=4`                    | Только PHASE 4                                                     |
| `PHASE=5`                    | Полная цепочка явно (тот же результат, что и `full`).              |
| `PHASE=full` (или не задана) | Полная цепочка: PHASE 1 → PHASE 2 → PHASE 4. PHASE 3 пропускается. |
| `PHASE=0`                    | То же, что и `full`.                                               |

Каждая фаза печатает стандартный отчёт `=== PHASE <n> REPORT ===` (status, self-tests, state-path, artifacts, notes) — канонический формат описан в [PLANE.md](PLANE.md) в разделе `DebugTools`.

### PHASE 1 — Setup & Config

**Цель:** проект собирается, конфигурация загружается и валидируется.

**Вход:** только `.env`.

**Что реализуется:**

- структура `src/`,
- `package.json` + `tsconfig.json`,
- `config.ts` — загрузка и валидация `.env` (`parseInt` для чисел, понятная ошибка при отсутствии обязательного значения),
- `index.ts` — точка входа и dispatch по `process.env.PHASE` (не по `cfg.phase`),
- проверка `npx tsc --noEmit`.

**Self-debug:** `check('tsc clean', ...)` через `npx tsc --noEmit`; `check('config complete', ...)`.

**Выход:** валидированный объект конфигурации.

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

**Шаги:** подключиться; `decryptInit` → модуль RSA + Blowfish-ключ; `RequestGGAuth` (или пропустить, если сервер сразу шлёт `LoginOk`); `RequestAuthLogin` → `LoginOk`; `RequestServerList` → выбрать `L2_SERVER_ID`; `RequestServerLogin` → `PlayOk`; закрыть соединение.

**Self-debug:** сначала `runLoginCryptoSelfTests()`; чек-лист: `modulus == 128`, `have 4 session ids` (достижение `PlayOk` означает наличие всех четырёх id), `have game host/port`. На `LoginFail`/`PlayFail` — отчёт FAIL. Замечание: в отличие от PHASE 3/4, упавшие `check()` в этой фазе **не останавливают** выполнение.

**Выход:** `loginOkId1`, `loginOkId2`, `playOkId1`, `playOkId2`, `gameHost`, `gamePort`.

**Критерий готовности:** достигнут `PlayOk`, получены 4 session id и адрес игрового сервера.

### PHASE 3 — Game Auth & Character (standalone)

**Цель:** подключение к игровому серверу и выбор персонажа.

**Вход:** 4 session id + `gameHost`/`gamePort` из PHASE 2.

**Что реализуется:**

- `GameCrypt.ts` — 16-байтовое скользящее XOR для игрового потока,
- `GameClient.ts` для PHASE 3 — FSM: `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED`,
- отправка `ProtocolVersion`, `AuthRequest`, `CharacterSelected`.

**Шаги:** подключиться; отправить сырой `ProtocolVersion 0x0E`; прочитать `CryptInit 0x2E` и инициализировать `GameCrypt` по флагу; отправить `AuthRequest 0x2B`; прочитать `CharSelectInfo 0x09` (проверить `charCount >= 1`); отправить `CharacterSelected 0x12`; прочитать `CharSelected 0x0B` (допускать пропуск сразу к `UserInfo`).

**Self-debug:** сначала `runGameCryptoSelfTests()`; чек-лист: `crypt flag honored`, `charCount >= 1`. Любой упавший self-test/`check` останавливает фазу с отчётом FAIL.

**Выход:** открытое игровое соединение в состоянии `WAIT_USER_INFO` (+ живой `gameCrypt`).

**Критерий готовности:** персонаж выбран (или `UserInfo` уже приходит).

**Важно:** эта фаза **не используется в полной цепочке** (`PHASE=full`). Она нужна только как отдельная точка входа для отладки аутентификации на игровом сервере.

### PHASE 4 — Enter World & Keepalive

**Цель:** войти в мир и удерживать соединение.

**Вход:** 4 session id + `gameHost`/`gamePort` из PHASE 2. PHASE 4 открывает **новое** игровое соединение, не переиспользуя PHASE 3.

**Что реализуется:**

- полный игровой FSM: `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME`,
- отправка `RequestKeyMapping` (`0xD0 0x0021`) и `EnterWorld` (`0x11` + 104 нулевых байт),
- обработка `UserInfo` с печатью `IN_GAME`,
- ответ на `NetPingRequest` (`0xD3` или `0xFE 0x00D3`) пакетом `NetPing` (`0xA8`).

**Устойчивость:** допускать до 10 неизвестных пакетов в `WAIT_CHAR_SELECTED` и `WAIT_USER_INFO`; после `IN_GAME` молча отбрасывать все пакеты, кроме пингов. Edge case: если `UserInfo` приходит ещё в `WAIT_CHAR_SELECTED` (сервер пропустил `CharSelected`) — перейти в `WAIT_USER_INFO` и выполнить enter-world-последовательность, но с защитой от повторной отправки `RequestKeyMapping`/`EnterWorld`.

**Self-debug:** сначала `runGameCryptoSelfTests()`; чек-лист: `IN_GAME printed`, `answered >=1 ping`. Любой упавший self-test/`check` останавливает фазу с отчётом FAIL.

**Выход:** живая сессия, отвечающая на пинги.

**Критерий готовности:** в консоли появляется `IN_GAME`, клиент отвечает на пинги и держит соединение 60 секунд без падений (keep-alive-таймер закрывает соединение на отметке 60 с).

### PHASE 5 — Full Chain (Login + Enter World + Keepalive)

**Цель:** полный end-to-end прогон клиента одним запуском.

**Вход:** только `.env`.

**Что реализуется:**

- `runPhase5()` в `index.ts`: последовательно PHASE 1 (конфиг + typecheck) → PHASE 2 (логин-сервер) → PHASE 4 (вход в мир и keepalive),
- `LoginResult` из PHASE 2 передаётся в PHASE 4 напрямую в памяти, без чтения/записи `artifacts/phase-2-output.json`,
- PHASE 3 пропускается — как и при `PHASE=full`,
- диспетчер: `PHASE=full`, `PHASE=0` и `PHASE=5` вызывают `runPhase5()`; фазы 1–4 продолжают работать standalone.

**Self-debug:** `runLoginCryptoSelfTests()` перед логин-сокетом и `runGameCryptoSelfTests()` перед игровым сокетом; переиспользуются отчёты фаз 1, 2 и 4; в конце — итоговый отчёт PHASE 5. Падение любой под-фазы прокидывается наверх — отчёт FAIL.

**Выход:** живая игровая сессия, отвечающая на пинги 60 секунд.

**Критерий готовности:** напечатан `IN_GAME`, пинги отбиваются 60 с, финальный отчёт PHASE 5 — PASS.

## Независимые сессии и передача артефактов

Каждый промпт отправляется LLM в **новой, изолированной сессии**. Поэтому фаза не может автоматически получить результаты предыдущей фазы. Чтобы PHASE 3 и PHASE 4 получили session id и адрес игрового сервера из PHASE 2, используйте один из способов:

1. **Файл артефактов (рекомендуется).** После успешного PHASE 2 LLM сохраняет `artifacts/phase-2-output.json`:

   ```json
   {
     "loginOkId1": 1234567890,
     "loginOkId2": 1234567891,
     "playOkId1": 1234567892,
     "playOkId2": 1234567893,
     "gameHost": "192.168.0.33",
     "gamePort": 7777
   }
   ```

   PHASE 3 и PHASE 4 читают этот файл как входные данные.

2. **Вставка в промпт.** Скопируйте значения из отчёта PHASE 2 и вставьте их в тело промпта PHASE 3/4 вместо ссылки на "артефакты PHASE 2".

Файл `artifacts/phase-2-output.json` не коммитится (добавлен в `.gitignore`).

## Как последовательно писать промты для LLM

Работа с LLM ведётся **по одной фазе за раз**. Это позволяет локализовать ошибки и не перегружать контекст модели сразу всей реализацией.

### Шаг 0. Подготовка

1. Убедитесь, что в `.env` заполнены реальные значения для вашего сервера.
2. Убедитесь, что [PLANE.md](PLANE.md) целиком помещается в контекст модели.

### Шаг 1. Для каждой фазы используйте один из следующих промптов:

#### PHASE 1

```text
PLANE.md
Implement PHASE 1 — Setup & Config.

Requirements:
- Create the project structure from PLANE.md, including `src/game/opcodes.ts` with the HighFive opcode map from PLANE.md.
- Write package.json, tsconfig.json, and .env.example.
- The file `.env` already exists in the repository and contains real credentials. Do NOT overwrite it; only read from it.
- Write config.ts: load .env via dotenv, use parseInt for numbers, throw a clear error if any required value is missing.
- `config.ts` may parse `PHASE` into a numeric field for logging only; do NOT use `cfg.phase` for routing.
- Write index.ts: entry point, read `process.env.PHASE` directly for dispatch, print the loaded config.
- Add dev/typecheck/build scripts.
- Run npx tsc --noEmit and make sure there are no errors.
- Print the PHASE 1 REPORT in the format from PLANE.md.

Run: PHASE=1 npm run dev
```

#### PHASE 2

```text
PLANE.md
Implement PHASE 2 — Login Server.

Requirements:
- Use the reusable code from PLANE.md (PacketReader, PacketWriter, Connection, Blowfish, NewCrypt, ScrambledRsaKey, RsaCrypt, LoginCrypt) — copy it verbatim.
- Write LoginClient.ts with the FSM from PLANE.md: WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK.
- Run crypto self-tests BEFORE any socket I/O, but only the tests that do not require GameCrypt.ts (Blowfish round-trip + any LoginCrypt sanity checks you can add). GameCrypt.ts is implemented later; do not import it in this phase.
- Add the explicit self-test: after unscrambling the modulus, run `check('modulus is 128 bytes', unscrambledModulus.length === 128)`.
- Skipped-GGAuth edge case: if the server sends LoginOk-shaped data before GGAuth, use `ggResponse = 0` and proceed.
- Note: failing `check()` calls in this phase do NOT halt execution (unlike Phase 3/4).
- Log every state transition via logState.
- On LoginFail / PlayFail print FAIL and stop with status FAIL.
- After reaching PlayOk, write the artifacts to artifacts/phase-2-output.json: loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort.
- Print the PHASE 2 REPORT with artifacts: loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort.

Critical byte layouts from PLANE.md (copy verbatim):
- RequestGGAuth: C 0x07 + D sessionId + four D GG constants (0x00000123, 0x00004567, 0x000089AB, 0x0000CDEF) + 19 zero bytes.
- RequestAuthLogin: C 0x00 + b[128] RSA ciphertext + D ggResponse + fixed 43-byte GG block.
- RequestServerList: C 0x05 + D loginOkId1 + D loginOkId2 + D 0x04000000.
- RequestServerLogin: C 0x02 + D loginOkId1 + D loginOkId2 + C serverId.

Run: PHASE=2 npm run dev
```

#### PHASE 3

```text
PLANE.md
Implement PHASE 3 — Game Auth & Character.

Inputs (from PHASE 2 artifacts/phase-2-output.json or pasted inline):
- loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort.

Requirements:
- Implement GameCrypt.ts from PLANE.md and integrate it into GameClient.ts.
- Open a new game connection to gameHost:gamePort.
- Run full crypto self-tests (Blowfish + GameCrypt round-trip) before socket I/O.
- FSM: WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED.
- ProtocolVersion is sent raw; enable GameCrypt only if CryptInit encryptionFlag !== 0.
- AuthRequest key order: playOkId2, playOkId1, loginOkId1, loginOkId2. No trailing language field.
- CharacterSelected: C 0x12 + D L2_CHAR_SLOT + 14 zero bytes.
- Verify charCount >= 1.
- Tolerate a skip from CharSelected to UserInfo: if UserInfo (0x32) arrives while waiting for CharSelected, transition to WAIT_USER_INFO and proceed.
- Add the self-test: `check('crypt flag honored', gameCrypt.isEnabled() === (encryptionFlag !== 0))`.
- If any self-test or check fails, halt the phase and report FAIL.
- The output state is WAIT_USER_INFO.
- Print the PHASE 3 REPORT.

Run: PHASE=3 npm run dev
```

#### PHASE 4

```text
PLANE.md
Implement PHASE 4 — Enter World & Keepalive.

Inputs (from PHASE 2 artifacts/phase-2-output.json or pasted inline):
- loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort.

Requirements:
- Open a new game connection to gameHost:gamePort.
- Run full crypto self-tests (Blowfish + GameCrypt round-trip) before socket I/O.
- FSM: WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME.
- ProtocolVersion is sent raw; enable GameCrypt only if CryptInit encryptionFlag !== 0.
- AuthRequest key order: playOkId2, playOkId1, loginOkId1, loginOkId2. No trailing language field.
- CharacterSelected: C 0x12 + D L2_CHAR_SLOT + 14 zero bytes.
- Send RequestKeyMapping as extended packet: 0xD0 0x0021.
- Send EnterWorld: 0x11 + 104 zero bytes.
- On UserInfo (0x32) print IN_GAME.
- Reply to every NetPingRequest (0xD3 or 0xFE 0x00D3) with NetPing: 0xA8 + D pingId + D 0x00000000 + D 0x00080000.
- Tolerate up to 10 unknown packets in WAIT_CHAR_SELECTED and WAIT_USER_INFO; silently drop all non-ping packets once IN_GAME.
- Edge case: if UserInfo (0x32) arrives while waiting for CharSelected, transition to WAIT_USER_INFO and proceed, but guard RequestKeyMapping and EnterWorld so they are sent at most once.
- Add the self-test: `check('answered >=1 ping', answeredPingCount >= 1)` before the report.
- If any self-test or check fails, halt the phase and report FAIL.
- Keep the connection alive for 60 seconds, then close the socket cleanly.
- Print the PHASE 4 REPORT.

Run: PHASE=4 npm run dev
```

#### PHASE 5

```text
PLANE.md
Implement PHASE 5 — Full End-to-End Run (Login + Enter World + Keepalive).

Inputs (from .env only):

L2_LOGIN_IP, L2_LOGIN_PORT, L2_GAME_PORT, L2_USERNAME, L2_PASSWORD, L2_SERVER_ID, L2_CHAR_SLOT, L2_PROTOCOL.
Requirements:

Implement an async runPhase5() function in src/index.ts that runs the full chain sequentially.
Run the equivalent of Phase 1: print the loaded config, run npx tsc --noEmit, and check('tsc clean', ...). If it fails, halt and print the PHASE 5 REPORT with status: FAIL.
Run runLoginCryptoSelfTests() before any login socket I/O.
Run Phase 2 by calling runLoginPhase(cfg) and capture the returned LoginResult (loginOkId1, loginOkId2, playOkId1, playOkId2, gameHost, gamePort).
Run runGameCryptoSelfTests() before any game socket I/O.
Pass the LoginResult directly as GamePhaseInput to runGamePhase(cfg, input, 4). Do not read or write artifacts/phase-2-output.json in the integrated path.
Phase 3 is not part of the full chain; skip it.
After Phase 4 completes cleanly (IN_GAME printed, keepalive finished), print the PHASE 5 REPORT using the existing report() helper.
The PHASE 5 REPORT should show status: PASS, the state path CONFIG_LOADED -> LOGIN_OK -> IN_GAME, and the session artifacts from LoginResult.
Update the dispatcher in main() so that PHASE=full, PHASE=0, and PHASE=5 all invoke runPhase5().
Keep PHASE=1, PHASE=2, PHASE=3, PHASE=4 working exactly as standalone phases.
If any sub-phase fails, propagate the failure and report FAIL for Phase 5.
Run: PHASE=5 npm run dev
```

### Шаг 3. Полная цепочка

После успешной отладки отдельных фаз запустите:

```bash
npm run dev
```

Это эквивалентно `PHASE=full` и выполняет: PHASE 1 → PHASE 2 → PHASE 4. PHASE 3 пропускается.

## Запуск

### Bash / zsh / Git Bash

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

### PowerShell (Windows)

```powershell
# Запуск по фазам
$env:PHASE=1; npm run dev
$env:PHASE=2; npm run dev
$env:PHASE=3; npm run dev   # опционально
$env:PHASE=4; npm run dev

# Полная цепочка
npm run dev
```

> Если `npm run dev` не подхватывает `PHASE` в вашей оболочке, добавьте `cross-env` в `devDependencies` и оберните скрипт: `"dev": "cross-env ts-node src/index.ts"`.

## Definition of Done

Проект считается успешно реализованным, если:

- `npx tsc --noEmit` не выдаёт ошибок.
- `PHASE=1 npm run dev` печатает валидный конфиг.
- `PHASE=2 npm run dev` доходит до `PlayOk` и возвращает 4 session id.
- `PHASE=4 npm run dev` (или просто `npm run dev`) печатает `IN_GAME`.
- Клиент остаётся подключённым не менее 60 секунд, отвечая на серверные пинги.
- Каждая фаза печатает свой self-debug report.

## Советы

- **Не меняйте опкоды** — в [PLANE.md](PLANE.md) используется собственная карта HighFive, не «учебная».
- **Копируйте reusable-код дословно** — алгоритмы Blowfish, RSA, XOR описаны именно в том виде, в котором их ожидает сервер.
- **Honor the crypt flag:** игра включает XOR-шифрование только если `CryptInit` прислал `encryptionFlag !== 0`.
- **Connection.send()** сам добавляет 2-байтовый little-endian префикс длины; не добавляйте его повторно.
- **EnterWorld** требует предварительного `RequestKeyMapping` (`0xD0 0x0021`) и ровно 104 нулевых байта после опкода `0x11`.
- Если сервер пропускает `CharSelected` и сразу шлёт `UserInfo` — обработайте это; не отправляйте `EnterWorld` дважды.

## Лицензия

Проект создаётся в образовательных/исследовательских целях для тестирования возможностей LLM. Используйте ответственно и только на серверах, где у вас есть разрешение.
