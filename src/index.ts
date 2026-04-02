import "dotenv/config";
import { IMessageSDK } from "@photon-ai/imessage-kit";
import { assertConfig, config } from "./config.js";
import { createInboundHandler } from "./handler.js";
import { startMessageWatcher } from "./messageWatcher.js";
import { destroyReminderService } from "./reminderService.js";

assertConfig();

const sdk = new IMessageSDK({
  debug: config.debug,
  watcher: {
    pollInterval: 2000,
    excludeOwnMessages: true,
  },
});

const handleInbound = createInboundHandler(sdk);

function logRoutingBanner(): void {
  console.log("[drafts] Gemini model:", config.geminiModel);
  console.log("[drafts] watching: direct messages only (onDirectMessage)");
  console.log("[drafts] DRAFTS_MODE:", config.draftsMode);
  if (config.draftsMode === "allowlist") {
    if (config.allowedSenders.length === 0) {
      console.warn(
        "[drafts] ALLOWED_SENDERS is empty — no one can trigger Drafts. Set ALLOWED_SENDERS or use DRAFTS_MODE=any_dm for testing.",
      );
    } else {
      console.log(
        "[drafts] ALLOWED_SENDERS (must match iMessage sender string exactly after normalization):",
        config.allowedSenders.join(", "),
      );
    }
  }
  if (config.draftsMode === "prefix") {
    console.log("[drafts] messages must start with:", JSON.stringify(config.draftsPrefix));
  }
  if (config.draftsMode === "any_dm") {
    console.warn("[drafts] DRAFTS_MODE=any_dm — any DM to this Mac is handled.");
  }
  console.log(
    "[drafts] tip: set LOG_INCOMING_DMS=true in .env to log every DM sender + allowed=true/false",
  );
}

async function main(): Promise<void> {
  logRoutingBanner();
  await startMessageWatcher(sdk, handleInbound);
}

function shutdown(): void {
  destroyReminderService();
  void sdk.close().catch(() => undefined);
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
