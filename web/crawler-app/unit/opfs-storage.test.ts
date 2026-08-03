import assert from "node:assert/strict";
import test from "node:test";

// @ts-ignore Shared protocol modules intentionally remain plain JavaScript.
import { InMemoryStorageAdapter } from "../../storage-protocol/src/adapter.mjs";
// @ts-ignore Shared protocol modules intentionally remain plain JavaScript.
import { OpfsStorageAdapter } from "../../storage-protocol/src/opfs-adapter.mjs";
import { openPreferredStorageAdapter } from "../src/storage.ts";

class FakeFileHandle {
  bytes = new Uint8Array();
  failNextClose = false;

  async getFile() {
    const bytes = this.bytes.slice();
    return {
      size: bytes.byteLength,
      async text() { return new TextDecoder().decode(bytes); },
    };
  }

  async createWritable() {
    let pending = new Uint8Array();
    return {
      write: async (value: Uint8Array) => { pending = new Uint8Array(value); },
      close: async () => {
        if (this.failNextClose) {
          this.failNextClose = false;
          throw new Error("injected OPFS close failure");
        }
        this.bytes = pending;
      },
      abort: async () => undefined,
    };
  }
}

class FakeDirectoryHandle {
  readonly files = new Map<string, FakeFileHandle>();

  async getFileHandle(name: string, options?: { create?: boolean }) {
    let handle = this.files.get(name);
    if (!handle && options?.create) {
      handle = new FakeFileHandle();
      this.files.set(name, handle);
    }
    if (!handle) throw new Error(`missing ${name}`);
    return handle;
  }
}

test("OPFS adapter durably round-trips structured values and atomically rejects failed writes", async () => {
  const directory = new FakeDirectoryHandle();
  const adapter = await OpfsStorageAdapter.open("crawler-test", 1, directory, undefined);
  await adapter.transaction(["metadata", "journals"], "readwrite", async (transaction: any) => {
    await transaction.put("metadata", "document:a", { revision: 1, bytes: new Uint8Array([1, 2, 3]), exact: 4n });
    await transaction.put("journals", "document:a\0one", { accepted: true });
  });

  const reopened = await OpfsStorageAdapter.open("crawler-test", 1, directory, undefined);
  assert.deepEqual(
    await reopened.transaction(["metadata"], "readonly", (transaction: any) => transaction.get("metadata", "document:a")),
    { revision: 1, bytes: new Uint8Array([1, 2, 3]), exact: 4n },
  );

  directory.files.get("crawler-test.v1.json")!.failNextClose = true;
  await assert.rejects(
    reopened.transaction(["metadata"], "readwrite", (transaction: any) =>
      transaction.put("metadata", "document:a", { revision: 2 })),
    /injected OPFS close failure/,
  );
  assert.equal(
    (await reopened.transaction(["metadata"], "readonly", (transaction: any) =>
      transaction.get("metadata", "document:a"))).revision,
    1,
  );
});

test("preferred selection migrates a complete legacy IndexedDB-shaped snapshot into empty OPFS", async () => {
  const legacy = new InMemoryStorageAdapter();
  await legacy.transaction(["metadata", "explicit-files"], "readwrite", async (transaction: any) => {
    await transaction.put("metadata", "document:a", { revision: 7 });
    await transaction.put("explicit-files", "document:a", [["manifest.json", new Uint8Array([9, 8, 7])]]);
  });
  const directory = new FakeDirectoryHandle();
  const opfs = await OpfsStorageAdapter.open("crawler-test", 1, directory, undefined);
  const selected = await openPreferredStorageAdapter({
    openOpfs: async () => opfs,
    openIndexedDb: async () => legacy,
  });
  assert.equal(selected.backend, "opfs");
  assert.equal(selected.migratedFromIndexedDb, true);
  assert.deepEqual(
    await selected.adapter.transaction(["metadata"], "readonly", (transaction) =>
      transaction.get("metadata", "document:a")),
    { revision: 7 },
  );
  assert.deepEqual(
    await selected.adapter.transaction(["explicit-files"], "readonly", (transaction) =>
      transaction.get("explicit-files", "document:a")),
    [["manifest.json", new Uint8Array([9, 8, 7])]],
  );
});

test("preferred selection safely falls back to IndexedDB when OPFS cannot open", async () => {
  const indexedDb = new InMemoryStorageAdapter();
  const selected = await openPreferredStorageAdapter({
    openOpfs: async () => { throw new Error("OPFS denied"); },
    openIndexedDb: async () => indexedDb,
  });
  assert.equal(selected.backend, "indexeddb");
  assert.equal(selected.migratedFromIndexedDb, false);
  assert.equal(selected.adapter, indexedDb);
});

test("an initialized OPFS lineage stays authoritative and does not reopen legacy storage", async () => {
  const directory = new FakeDirectoryHandle();
  const opfs = await OpfsStorageAdapter.open("crawler-test", 1, directory, undefined);
  await opfs.transaction(["metadata"], "readwrite", (transaction: any) =>
    transaction.put("metadata", "document:a", { revision: 9 }));
  let legacyOpenCount = 0;
  const selected = await openPreferredStorageAdapter({
    openOpfs: async () => opfs,
    openIndexedDb: async () => {
      legacyOpenCount += 1;
      return new InMemoryStorageAdapter();
    },
  });
  assert.equal(selected.backend, "opfs");
  assert.equal(selected.migratedFromIndexedDb, false);
  assert.equal(legacyOpenCount, 0);
  assert.deepEqual(
    await selected.adapter.transaction(["metadata"], "readonly", (transaction) =>
      transaction.get("metadata", "document:a")),
    { revision: 9 },
  );
});

test("corrupt OPFS state fails closed instead of silently selecting stale IndexedDB", async () => {
  const directory = new FakeDirectoryHandle();
  const handle = await directory.getFileHandle("crawler-test.v1.json", { create: true });
  handle.bytes = new TextEncoder().encode("{not-json");
  let legacyOpenCount = 0;
  await assert.rejects(
    openPreferredStorageAdapter({
      openOpfs: () => OpfsStorageAdapter.open("crawler-test", 1, directory, undefined),
      openIndexedDb: async () => {
        legacyOpenCount += 1;
        return new InMemoryStorageAdapter();
      },
    }),
    (error: any) => error.code === "OPFS_CORRUPT_SNAPSHOT",
  );
  assert.equal(legacyOpenCount, 0);
});

test("failed legacy migration keeps the intact IndexedDB lineage authoritative", async () => {
  const legacy = new InMemoryStorageAdapter();
  await legacy.transaction(["metadata"], "readwrite", (transaction: any) =>
    transaction.put("metadata", "document:a", { revision: 5 }));
  const directory = new FakeDirectoryHandle();
  const opfs = await OpfsStorageAdapter.open("crawler-test", 1, directory, undefined);
  directory.files.get("crawler-test.v1.json")!.failNextClose = true;
  const selected = await openPreferredStorageAdapter({
    openOpfs: async () => opfs,
    openIndexedDb: async () => legacy,
  });
  assert.equal(selected.backend, "indexeddb");
  assert.equal(selected.adapter, legacy);
  assert.deepEqual(
    await selected.adapter.transaction(["metadata"], "readonly", (transaction) =>
      transaction.get("metadata", "document:a")),
    { revision: 5 },
  );
});
