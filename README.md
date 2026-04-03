# Drafts

iMessage-native helper that turns what you mean into send-ready texts. Built with [@photon-ai/imessage-kit](https://github.com/photon-hq/imessage-kit) and Google Gemini (default model `gemini-2.5-flash`, override with `GEMINI_MODEL`).

## What it is

Drafts is a small service that runs on your Mac, watches your iMessages (from allowed senders), and replies in-thread with AI-generated text you can copy into Messages. It’s meant to feel like a drafting partner: you describe what you want to say, get a few concrete options with clear labels, then refine in plain language across turns while it keeps session state on disk.

It biases toward natural, recipient-appropriate tone by classifying who the message is for and what kind of message it is, using that to pick prompt guidance—not a single generic “write a message” template. It can also help when you’re answering someone else’s text rather than only starting a new one.

Beyond generation, it can track several drafts at once, move them through a simple lifecycle toward sending, surface copy-ready text when you’re ready, and schedule light follow-ups through the same Photon reminder system you use for “remind me” style prompts, with guardrails so nudges stay optional and dismissible.

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

Send a DM to this Mac from an allowed sender. You can send `ping` to verify the bot is receiving traffic.

## Project layout

| Path | Role |
|------|------|
| `src/index.ts` | Entry: restore pending reminders, SDK, watcher, shutdown |
| `src/messageWatcher.ts` | `startWatching` / `onDirectMessage` |
| `src/handler.ts` | Intent → Gemini (or lifecycle-only replies) → session, drafts, profile, reminders, nudges |
| `src/intentResolver.ts` | Classifies what the user wants (new draft, refine, reminders, draft CRUD, lifecycle, prefs) |
| `src/draftSession.ts` | Latest turn / variants helpers |
| `src/draftEngine.ts` | `@google/genai` + JSON (variants, reminder, mode, preferences) |
| `src/memoryStore.ts` | JSON: profile, **drafts[]**, **activeDraftId**, **session** (active draft mirror), **nudgePreferences**, **pendingReminders** |
| `src/draftLifecycleManager.ts` | Draft **status** transitions |
| `src/draftReferenceResolver.ts` | Heuristics to pick which saved draft the user means |
| `src/nudgeEngine.ts` | When to schedule nudges; caps + opt-out / snooze |
| `src/reminderService.ts` | Linked reminders + **nudges** (Photon `Reminders`) + persistence |
| `src/intelligence/` | `mergeDraftContext`, `recipientClassifier`, `messageModeDetector`, `replyDetector`, `promptSelector`, `toneFromText` |
| `src/prompts/templates/` | Per-mode and recipient **prompt templates** (follow-up, thank-you, scheduling, etc.) |
| `src/prompts/buildUserPrompt.ts` | User prompt + variant-count instructions |
| `src/prompts/system.ts` | Base JSON schema + rules for Gemini |

## Memory file (`MEMORY_PATH`, default `./data/memory.json`)

- **`users[sender].profile`**: optional `tone`, `length`, `styleNotes` (from explicit preferences / model updates).
- **`users[sender].session`**: `ActiveSession` for the **active draft** (same shape as before: `turns[]`, `recipientHint`, `mode`, `selectedVariantIndex`). Kept in sync with the active entry in `drafts`.
- **`users[sender].drafts`**: list of **DraftRecord** (id, **status**, embedded `session`, optional title, nudge metadata).
- **`users[sender].activeDraftId`**: which draft is active for list/switch/iterate.
- **`users[sender].nudgePreferences`**: optional `optOut`, `snoozeUntil` (ISO).
- **`pendingReminders`**: scheduled **reminders** and **nudges** with `draftSnapshot`, `sendAt`, Photon id; **`kind`** `reminder` \| `nudge`, optional **`draftId`** for nudges. Restored after restart.
- **`lastIncoming`**: latest user message snippet.
- Set **`DEBUG=true`** to log each save.

## License

See your chosen license for this repo; dependencies include MIT-licensed [imessage-kit](https://github.com/photon-hq/imessage-kit).
