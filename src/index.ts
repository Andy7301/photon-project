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

async function main(): Promise<void> {
  console.log("[drafts] starting (DM-only). Mode:", config.draftsMode);
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
