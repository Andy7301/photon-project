import type { IMessageSDK, Message } from "@photon-ai/imessage-kit";

export async function startMessageWatcher(
  sdk: IMessageSDK,
  onDirectMessage: (msg: Message) => void | Promise<void>,
): Promise<void> {
  await sdk.startWatching({
    onDirectMessage,
    onError: (err) => {
      console.error("[drafts] watcher error:", err);
    },
  });
}
