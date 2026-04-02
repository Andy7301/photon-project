# Drafts

iMessage-native helper that turns what you mean into send-ready texts. Built with [@photon-ai/imessage-kit](https://github.com/photon-hq/imessage-kit) and Google Gemini (`gemini-3-flash-preview`).

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

## License

See your chosen license for this repo; dependencies include MIT-licensed [imessage-kit](https://github.com/photon-hq/imessage-kit).
