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

Send a DM to this Mac from an allowed sender. Message `ping` to get `pong` (sanity check). Anything else goes through Drafts (drafts, rewrites, reminders per your message).

## Project layout

| Path | Role |
|------|------|
| `src/index.ts` | Entry: SDK, watcher, shutdown |
| `src/messageWatcher.ts` | `startWatching` / `onDirectMessage` |
| `src/handler.ts` | Route → Gemini → memory → reply |
| `src/intentParser.ts` | draft / rewrite / reminder heuristics |
| `src/draftEngine.ts` | `@google/genai` + JSON variants |
| `src/memoryStore.ts` | JSON persistence (`data/` by default) |
| `src/reminderService.ts` | Photon `Reminders` |

## Memory file (`MEMORY_PATH`, default `./data/memory.json`)

- **`users`** has **one object per sender** (the iMessage `sender` id, e.g. `+15551234567`). If you only ever DM from one number, you will only see **one key** here — that is expected.
- **`recentDrafts`** holds up to **8** last assistant draft strings (newest first); older ones roll off.
- **`lastIncoming`** is the latest user message text we stored for that sender.
- Set **`DEBUG=true`** to log each save: path, sender keys, and count.

## License

See your chosen license for this repo; dependencies include MIT-licensed [imessage-kit](https://github.com/photon-hq/imessage-kit).
