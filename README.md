# Drafts

iMessage-native helper that turns what you mean into send-ready texts. Built with [@photon-ai/imessage-kit](https://github.com/photon-hq/imessage-kit) and Google Gemini (default model `gemini-2.5-flash`, override with `GEMINI_MODEL`).

## Requirements

- macOS
- Node.js 20+
- [Full Disk Access](https://github.com/photon-hq/imessage-kit) for the terminal or app running Drafts (System Settings → Privacy & Security → Full Disk Access)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`: set `GEMINI_API_KEY` and `ALLOWED_SENDERS` (or use `DRAFTS_MODE=any_dm` only for local testing).

**Allowlist not matching?** iMessage may report `sender` as `+15551234567`, `5551234567`, or an Apple ID email. Run with `LOG_INCOMING_DMS=true`, send yourself a DM, and copy the logged `sender=` value into `ALLOWED_SENDERS`.

## Run

```bash
npm start
```

For development with reload:

```bash
npm run dev
```

Send a DM to this Mac from an allowed sender. Message `ping` to get `pong` (sanity check). Replies are numbered **1) 2) 3)** so you can say “shorter”, “option 2”, or “combine 1 and 2” on the next turn.

## Project layout

| Path | Role |
|------|------|
| `src/index.ts` | Entry: restore pending reminders, SDK, watcher, shutdown |
| `src/messageWatcher.ts` | `startWatching` / `onDirectMessage` |
| `src/handler.ts` | Resolve intent → Gemini → session + profile + reminders |
| `src/intentResolver.ts` | Stateful follow-ups (iterate, combine, reminder, new draft) |
| `src/draftSession.ts` | Helpers for latest turn / variants |
| `src/draftEngine.ts` | `@google/genai` + JSON (variants, reminder, mode, preferences) |
| `src/memoryStore.ts` | JSON: profile, `ActiveSession` turns, `pendingReminders` |
| `src/reminderService.ts` | Linked reminders + persistence |
| `src/prompts/modes.ts` | Recipient / mode prompt lines |

## Memory file (`MEMORY_PATH`, default `./data/memory.json`)

- **`users[sender].profile`**: optional `tone`, `length`, `styleNotes` (from explicit preferences / model updates).
- **`users[sender].session`**: `ActiveSession` with `turns[]` (each turn has three labeled variants). New topics call `startFreshSession` so you get a new session id.
- **`pendingReminders`**: scheduled reminders with `draftSnapshot`, `sendAt`, and Photon id for rescheduling after restart.
- **`lastIncoming`**: latest user message snippet.
- Set **`DEBUG=true`** to log each save.

## License

See your chosen license for this repo; dependencies include MIT-licensed [imessage-kit](https://github.com/photon-hq/imessage-kit).
