export const PROTOCOL_VERSION = 1;

export function commandEnvelope({
  requestId,
  documentId = "reference-document",
  documentRevision = 0,
  previewGeneration = 0,
  command,
  ...payload
}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId,
    document_id: documentId,
    document_revision: documentRevision,
    preview_generation: previewGeneration,
    command,
    ...payload,
  };
}

export function commandTransferables(command) {
  if (
    command.command === "import_step" &&
    command.source_bytes instanceof Uint8Array
  ) {
    return [command.source_bytes.buffer];
  }
  return [];
}

export class StaleResultGate {
  #newest = new Map();

  noteRequest(command) {
    const current = this.#newest.get(command.document_id);
    const candidate = {
      documentRevision: command.document_revision,
      previewGeneration: command.preview_generation,
    };
    if (
      !current ||
      candidate.documentRevision > current.documentRevision ||
      (candidate.documentRevision === current.documentRevision &&
        candidate.previewGeneration > current.previewGeneration)
    ) {
      this.#newest.set(command.document_id, candidate);
    }
  }

  accepts(event) {
    if (event.event !== "result") {
      return true;
    }
    const current = this.#newest.get(event.document_id);
    return (
      !current ||
      (event.document_revision === current.documentRevision &&
        event.preview_generation === current.previewGeneration)
    );
  }
}
