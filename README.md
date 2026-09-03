# Headless Lineage 2 Client — тестирование LLM по единому промпту

Этот репозиторий — песочница для проверки того, насколько хорошо современные LLM справляются с реализацией сложного сетевого клиента по одному длинному self-contained промпту.

Цель проекта — получить работающий **headless-клиент Lineage 2** (хроника HighFive, протокол `267`) на **Node.js 24.15.0 + TypeScript**, который без участия человека:

1. Подключается к **Login Server**, проходит аутентификацию по логину/паролю и забирает сессионные ключи.
2. Подключается к **Game Server**, используя эти ключи, выбирает персонажа по слоту и входит в игровой мир.
3. Печатает в консоль `IN_GAME`.
4. Поддерживает соединение, отвечая на серверные пинги.

Стек: Node.js, TypeScript, собственная реализация Blowfish + RSA + XOR-шифрование игрового потока. Никаких веб-фреймворков, баз данных и игровой логики (бой, движение, инвентарь) — только автологин.

## Что находится в репозитории

- [PLANE.md](PLANE.md) — **Источник правды / спецификация протокола** на английском. Содержит полную спецификацию для создания клиента: протокол, карту опкодов, reusable-реализации криптографии, FSM логин- и гейм-сервера, формат отчёта и troubleshooting. Блок «Единый промпт» ниже — это оркестрационный промпт, который ссылается на `PLANE.md`, а не заменяет его.
- [.env](.env) — Файл с реальными credentials (не шаблон): IP/порт серверов, логин, пароль, ID игрового сервера, слот персонажа, протокол. Читать только, не перезаписывать.
- [.env.example](.env.example) — Шаблон конфигурации.
- [`src/`](src/) — Исходный код клиента. **Генерируется LLM по единому промпту** на основе [PLANE.md](PLANE.md); в начальном состоянии отсутствует.
- [`README.md`](README.md) — Этот файл — вводное описание и инструкция по работе с LLM.
- [INFO.md](INFO.md) — Каталог скилов и специализированных агентов проекта (`.claude/skills/`, `.claude/agents/`): назначение, инструменты и типовой поток работы (сборка с нуля, аудит, запуск и диагностика FAIL).

## Архитектура клиента

Клиент — **единая линейная программа**: один запуск `npm run dev` выполняет весь сценарий от подключения до keep-alive. Никаких фаз и переменной окружения `PHASE` — `index.ts` последовательно:

1. Загружает и валидирует конфиг из `.env`.
2. Прогоняет крипто-self-tests (`runLoginCryptoSelfTests()` + `runGameCryptoSelfTests()`) **до** любого сокет-I/O.
3. Логин-сервер: аутентификация, получение 4 session id + адреса игрового сервера.
4. Игровой сервер: новое соединение, выбор персонажа, вход в мир.
5. Печатает `IN_GAME`, отвечает на пинги ≥ 60 секунд, затем чисто закрывает сокет и выходит.

При любой ошибке (упавший self-test, `LoginFail`/`PlayFail`, разрыв соединения до `UserInfo`) программа печатает финальный отчёт со `status: FAIL` и завершается с ненулевым кодом.

**Структура кода (`src/`):**

- `types.ts` — общие типы-контракты (`Config`, `LoginResult`, `GameInput`, `Artifacts`, union-состояния FSM); единственный дом для типов, которые нужны сразу нескольким модулям.
- `net/` — `Connection.ts` (TCP + реассембли пакетов по `[uint16LE size][opcode][payload]`), `PacketReader.ts`, `PacketWriter.ts`.
- `crypto/` — криптография: `Blowfish.ts`, `NewCrypt.ts`, `ScrambledRsaKey.ts`, `RsaCrypt.ts`, `LoginCrypt.ts`, `GameCrypt.ts` (16-байтовое скользящее XOR игрового потока).
- `game/` — `GameClient.ts`, `Opcodes.ts` (карта опкодов HighFive).
- `login/` — `LoginClient.ts`.
- `debug/` — `DebugTools.ts` (self-tests, `[STATE]`-лог, финальный отчёт).

`PacketReader.ts`, `PacketWriter.ts`, `Opcodes.ts`, `DebugTools.ts`, `types.ts` даны в PLANE.md готовыми листингами (**COPY VERBATIM**), не прозой. `npm run dev` — нативный TS Node 24 (`node --experimental-strip-types`), без `ts-node`; версии зависимостей закреплены точно. Точные экспортируемые сигнатуры модулей — в разделе `## MODULE CONTRACTS` PLANE.md.

### Логин-сервер (FSM)

`LoginClient` FSM: `WAIT_INIT → WAIT_GG_AUTH → WAIT_LOGIN_OK → WAIT_SERVER_LIST → WAIT_PLAY_OK`. Шаги: подключиться; `decryptInit` → модуль RSA (128 байт) + Blowfish-ключ; `RequestGGAuth` (или пропустить, если сервер сразу шлёт `LoginOk` → `ggResponse = 0`); `RequestAuthLogin` → `LoginOk`; `RequestServerList` → выбрать `L2_SERVER_ID`; `RequestServerLogin` → `PlayOk`; закрыть логин-соединение. Результат, который несётся дальше в игровую часть: `loginOkId1`, `loginOkId2`, `playOkId1`, `playOkId2`, `gameHost`, `gamePort`.

### Игровой сервер (FSM)

`GameClient` FSM: `WAIT_CRYPT_INIT → WAIT_CHAR_LIST → WAIT_CHAR_SELECTED → WAIT_USER_INFO → IN_GAME`. Шаги: подключиться к `gameHost:gamePort`; отправить сырой `ProtocolVersion 0x0E`; прочитать `CryptInit 0x2E` и включить `GameCrypt` только если `encryptionFlag !== 0`; `AuthRequest 0x2B` (порядок ключей `playOkId2, playOkId1, loginOkId1, loginOkId2`, без языкового поля); `CharSelectInfo 0x09` (проверить `charCount >= 1`); `CharacterSelected 0x12` (+ 14 нулевых байт); `RequestKeyMapping` (`0xD0 0x0021`) + `EnterWorld` (`0x11` + 104 нулевых байта, каждый — не более одного раза); на `UserInfo 0x32` печатать `IN_GAME`.

**Устойчивость:** допускать до 10 неизвестных пакетов в `WAIT_CHAR_SELECTED`/`WAIT_USER_INFO`; после `IN_GAME` молча отбрасывать все пакеты, кроме пингов. Если `UserInfo` приходит ещё в `WAIT_CHAR_SELECTED` (сервер пропустил `CharSelected`) — перейти к enter-world-последовательности с защитой от повторной отправки `RequestKeyMapping`/`EnterWorld`.

**Keep-alive:** отвечать на каждый `NetPingRequest` (`0xD3` или `0xFE 0x00D3`), полученный в `WAIT_USER_INFO` или `IN_GAME`, пакетом `NetPing` (`0xA8` + `D pingId` + `D 0x00000000` + `D 0x00080000`); держать соединение 60 секунд, затем закрыть.

### Отчёт

В конце `DebugTools.report(...)` печатает финальный отчёт:

```
=== REPORT ===
status: PASS | FAIL
self-tests: <passed>/<total>
state-path: IDLE -> ... -> <final>
artifacts: <key=value session data>
notes: <first failing assertion / error, if any>
```

## Как работать с LLM

Клиент реализуется **одним промптом в одной сессии** — вся спецификация помещается в контекст сразу.

### Подготовка

1. Убедитесь, что в `.env` заполнены реальные значения для вашего сервера.
2. Убедитесь, что [PLANE.md](PLANE.md) целиком помещается в контекст модели.

### Единый промпт

> Первая строка промпта — placeholder: вместо `[PASTE THE FULL CONTENTS OF PLANE.md HERE]` вставьте полное содержимое [PLANE.md](PLANE.md) (или прикрепите файл к сессии, если инструмент это позволяет).

```text
[PASTE THE FULL CONTENTS OF PLANE.md HERE]

Build a headless Lineage 2 client (chronicle HighFive, protocol 267) on Node.js 24 +
TypeScript as ONE straight-line program. `npm run dev` does the whole run in a single
pass: authenticate on the login server; obtain the 4 session ids + game server address;
open a fresh game connection; select the character in slot L2_CHAR_SLOT; enter the world;
print IN_GAME; answer server pings for 60 seconds; close cleanly and exit 0.
No build phases, no PHASE env var, no per-phase functions, no per-phase reports — one
linear flow, one `=== REPORT ===`.

PLANE.md above owns every byte, opcode, crypto algorithm, field layout and FSM state list
— follow the referenced section, do NOT restate or re-derive it here; copy every "COPY
VERBATIM" block exactly. This block only orchestrates: order, control flow, edge cases.

Build order
1. Scaffold per `## PROJECT SETUP`: package.json (dev = `node --experimental-strip-types
   src/index.ts`, NO ts-node, versions pinned exact), tsconfig.json, src/types.ts and
   src/game/Opcodes.ts and src/net/PacketReader.ts / PacketWriter.ts and
   src/debug/DebugTools.ts — all COPY VERBATIM. Run npm install; `npx tsc --noEmit` clean.
   Every module's exported signature must match `## MODULE CONTRACTS`.
2. `.env` already holds real credentials — READ it, never overwrite. Load via dotenv,
   parseInt numbers, throw a clear error on any missing var from `### .env.example`.
3. Crypto from `## REUSABLE CODE — COPY VERBATIM`, then run runLoginCryptoSelfTests() +
   runGameCryptoSelfTests() BEFORE any socket I/O — abort with a clear error if either
   fails. This is the gate: no socket code over red crypto. Shared types come only from
   src/types.ts; login/ and game/ never import each other; no enum/namespace/parameter-
   properties (native type-stripping).
4. Login flow per `### PART A — LOGIN SERVER`: Init → GGAuth → AuthLogin → ServerList
   (pick L2_SERVER_ID) → ServerLogin → PlayOk; close the login connection; carry forward
   the 4 session ids + gameHost/gamePort.
5. Game flow per `### PART B — GAME SERVER`: fresh connection → ProtocolVersion sent raw
   → CryptInit, enable GameCrypt only if encryptionFlag !== 0 → AuthRequest →
   CharSelectInfo → CharacterSelected → RequestKeyMapping → EnterWorld → on UserInfo
   print IN_GAME. Send RequestKeyMapping and EnterWorld at most once each.
6. Keepalive per `### PART B`: answer every ping received in WAIT_USER_INFO or IN_GAME;
   hold the connection 60 seconds, then close cleanly and exit 0.
7. Print the final self-debug report per `### src/debug/DebugTools.ts`.

Edge cases (control flow)
- Skipped GGAuth: if LoginOk-shaped data arrives before GGAuth, use ggResponse = 0 and
  proceed.
- Skipped CharSelected: if UserInfo arrives while still WAIT_CHAR_SELECTED, jump straight
  to the enter-world step, respecting the at-most-once guards.
- Tolerate up to 10 unknown packets in WAIT_CHAR_SELECTED and WAIT_USER_INFO; once
  IN_GAME, silently drop every non-ping packet.
- LoginFail / PlayFail, or the server closing the socket before UserInfo: settle the run
  promise (never leave it pending), report FAIL, exit non-zero.

If anything looks scrambled or stalls, consult `## TROUBLESHOOTING`.

Run: npm run dev
```

## Запуск

### Bash / zsh / Git Bash

```bash
# 1. Установка зависимостей
npm install

# 2. Проверить/заполнить .env
#    L2_LOGIN_IP, L2_LOGIN_PORT, L2_GAME_PORT,
#    L2_USERNAME, L2_PASSWORD,
#    L2_SERVER_ID, L2_CHAR_SLOT, L2_PROTOCOL

# 3. Запуск (весь сценарий за один прогон)
npm run dev
```

### PowerShell (Windows)

```powershell
npm install
npm run dev
```

## Definition of Done

Проект считается успешно реализованным, если:

- `npx tsc --noEmit` не выдаёт ошибок.
- `npm run dev` подключается к логин-серверу, доходит до `PlayOk` и получает 4 session id.
- Клиент входит в игровой мир и печатает `IN_GAME`.
- Клиент остаётся подключённым не менее 60 секунд, отвечая на серверные пинги.
- Программа печатает финальный self-debug report со `status: PASS`.

## Советы

- **Не меняйте опкоды** — в [PLANE.md](PLANE.md) используется собственная карта HighFive, не «учебная».
- **Копируйте reusable-код дословно** — алгоритмы Blowfish, RSA, XOR описаны именно в том виде, в котором их ожидает сервер.
- **Honor the crypt flag:** игра включает XOR-шифрование только если `CryptInit` прислал `encryptionFlag !== 0`.
- **Connection.send()** сам добавляет 2-байтовый little-endian префикс длины; не добавляйте его повторно.
- **EnterWorld** требует предварительного `RequestKeyMapping` (`0xD0 0x0021`) и ровно 104 нулевых байта после опкода `0x11`.
- Если сервер пропускает `CharSelected` и сразу шлёт `UserInfo` — обработайте это; не отправляйте `EnterWorld` дважды.

## Лицензия

Проект создаётся в образовательных/исследовательских целях для тестирования возможностей LLM. Используйте ответственно и только на серверах, где у вас есть разрешение.
