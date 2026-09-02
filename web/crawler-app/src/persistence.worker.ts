/// <reference lib="webworker" />

import { AppStorage, type AcceptedStateAction } from "./storage";
import type { AcceptedTransaction } from "./protocol";

const scope = self as DedicatedWorkerGlobalScope;
let storagePromise: Promise<AppStorage> | undefined;

type PersistenceRequest = {
  type: "persist-accepted";
  requestId: number;
  documentJson: string;
  semanticHash: string;
  transaction?: AcceptedTransaction;
  action?: AcceptedStateAction;
};

scope.addEventListener("message", async (event: MessageEvent<PersistenceRequest>) => {
  if (event.data?.type !== "persist-accepted") return;
  const { requestId, documentJson, semanticHash, transaction, action } = event.data;
  try {
    storagePromise ??= AppStorage.open();
    const storage = await storagePromise;
    const document = JSON.parse(documentJson) as { id: string };
    if (transaction) {
      await storage.recordAccepted(document.id, transaction, document, semanticHash);
    } else {
      await storage.recordAcceptedState(document.id, document, semanticHash, action ?? "accepted_state");
    }
    scope.postMessage({ type: "persisted-accepted", requestId });
  } catch (error) {
    scope.postMessage({
      type: "persistence-error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
