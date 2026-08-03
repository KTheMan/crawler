import { STORE_NAMES } from "./adapter.mjs";

const SNAPSHOT_VERSION = 1;

export class OpfsStorageError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "OpfsStorageError";
    this.code = code;
  }
}

/**
 * Transactional adapter backed by one atomically replaced OPFS snapshot.
 *
 * `FileSystemWritableFileStream.close()` commits the temporary write to the
 * target file, so a failed callback or failed write leaves the prior snapshot
 * intact. A Web Lock coordinates independent tabs when available; the local
 * queue provides the same serialization inside one application instance.
 */
export class OpfsStorageAdapter {
  #queue = Promise.resolve();

  constructor(fileHandle, lockName, locks = globalThis.navigator?.locks) {
    this.fileHandle = fileHandle;
    this.lockName = lockName;
    this.locks = locks;
  }

  static async open(
    name = "crawler-local-storage",
    version = 1,
    root = undefined,
    locks = globalThis.navigator?.locks,
  ) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new TypeError("OPFS storage version must be a positive integer");
    }
    const directory = root ?? await requireStorageManager().getDirectory();
    const fileName = `${safeName(name)}.v${version}.json`;
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const adapter = new OpfsStorageAdapter(
      fileHandle,
      `crawler-opfs:${fileName}`,
      locks,
    );
    // Fail during selection, rather than during the first accepted transaction,
    // when an existing snapshot is corrupt or incompatible.
    await adapter.transaction(STORE_NAMES, "readonly", async () => undefined);
    return adapter;
  }

  async transaction(storeNames, mode, callback) {
    requireStores(storeNames);
    if (mode !== "readonly" && mode !== "readwrite") {
      throw new TypeError(`unsupported transaction mode ${mode}`);
    }
    if (typeof callback !== "function") {
      throw new TypeError("transaction callback must be a function");
    }
    return this.#serialized(async () => {
      const run = () => this.#runTransaction(storeNames, mode, callback);
      return this.locks?.request
        ? this.locks.request(this.lockName, { mode: "exclusive" }, run)
        : run();
    });
  }

  #serialized(task) {
    const pending = this.#queue.then(task, task);
    this.#queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #runTransaction(storeNames, mode, callback) {
    const durable = await this.#readStores();
    const selected = new Map(
      storeNames.map((name) => [name, cloneMap(durable.get(name))]),
    );
    const api = transactionApi(selected, mode);
    const result = await callback(api);
    if (mode === "readwrite") {
      for (const [name, values] of selected) durable.set(name, values);
      await this.#writeStores(durable);
    }
    return clone(result);
  }

  async #readStores() {
    const file = await this.fileHandle.getFile();
    if (file.size === 0) return emptyStores();
    let snapshot;
    try {
      snapshot = JSON.parse(await file.text());
    } catch (error) {
      throw new OpfsStorageError(
        "OPFS_CORRUPT_SNAPSHOT",
        `OPFS storage snapshot is not valid JSON: ${error.message}`,
        { cause: error },
      );
    }
    if (
      !snapshot ||
      snapshot.snapshot_version !== SNAPSHOT_VERSION ||
      !snapshot.stores ||
      typeof snapshot.stores !== "object"
    ) {
      throw new OpfsStorageError(
        "OPFS_INCOMPATIBLE_SNAPSHOT",
        "OPFS storage snapshot version is unsupported",
      );
    }
    const stores = emptyStores();
    for (const name of STORE_NAMES) {
      const entries = snapshot.stores[name];
      if (!Array.isArray(entries)) {
        throw corruptSnapshot(`OPFS storage snapshot is missing ${name}`);
      }
      const decoded = new Map();
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
          throw corruptSnapshot(`OPFS storage snapshot contains an invalid ${name} entry`);
        }
        if (decoded.has(entry[0])) {
          throw corruptSnapshot(`OPFS storage snapshot contains duplicate key ${entry[0]}`);
        }
        decoded.set(entry[0], decodeValue(entry[1]));
      }
      stores.set(name, decoded);
    }
    return stores;
  }

  async #writeStores(stores) {
    const snapshot = {
      snapshot_version: SNAPSHOT_VERSION,
      stores: Object.fromEntries(STORE_NAMES.map((name) => [
        name,
        [...stores.get(name).entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, encodeValue(value)]),
      ])),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const writable = await this.fileHandle.createWritable({ keepExistingData: false });
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort?.();
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
  }
}

function transactionApi(stores, mode) {
  return {
    async get(store, key) {
      return clone(requireSelectedStore(stores, store).get(key));
    },
    async put(store, key, value) {
      assertWritable(mode);
      requireSelectedStore(stores, store).set(String(key), clone(value));
    },
    async delete(store, key) {
      assertWritable(mode);
      requireSelectedStore(stores, store).delete(String(key));
    },
    async entries(store, prefix = "") {
      return [...requireSelectedStore(stores, store).entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, clone(value)]);
    },
  };
}

function encodeValue(value) {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("OPFS storage rejects non-finite numbers");
    return ["number", value];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (value instanceof Uint8Array) return ["uint8array", bytesToBase64(value)];
  if (value instanceof ArrayBuffer) return ["arraybuffer", bytesToBase64(new Uint8Array(value))];
  if (Array.isArray(value)) return ["array", value.map(encodeValue)];
  if (typeof value === "object") {
    return ["object", Object.keys(value).sort().map((key) => [key, encodeValue(value[key])])];
  }
  throw new TypeError(`OPFS storage cannot encode ${typeof value}`);
}

function decodeValue(encoded) {
  if (!Array.isArray(encoded) || typeof encoded[0] !== "string") {
    throw corruptSnapshot("OPFS storage contains an invalid encoded value");
  }
  switch (encoded[0]) {
    case "undefined": return undefined;
    case "null": return null;
    case "boolean":
    case "string":
    case "number": return encoded[1];
    case "bigint": return BigInt(encoded[1]);
    case "uint8array": return base64ToBytes(encoded[1]);
    case "arraybuffer": return base64ToBytes(encoded[1]).buffer;
    case "array": return encoded[1].map(decodeValue);
    case "object": return Object.fromEntries(encoded[1].map(([key, value]) => [key, decodeValue(value)]));
    default: throw corruptSnapshot(`OPFS storage contains unknown value tag ${encoded[0]}`);
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function emptyStores() {
  return new Map(STORE_NAMES.map((name) => [name, new Map()]));
}

function cloneMap(source) {
  return new Map([...source].map(([key, value]) => [key, clone(value)]));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requireStores(names) {
  for (const name of names) {
    if (!STORE_NAMES.includes(name)) throw new TypeError(`unknown object store ${name}`);
  }
}

function requireSelectedStore(stores, name) {
  const store = stores.get(name);
  if (!store) throw new TypeError(`object store ${name} is not in this transaction`);
  return store;
}

function assertWritable(mode) {
  if (mode !== "readwrite") throw new Error("readonly transaction cannot mutate storage");
}

function safeName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) {
    throw new TypeError("OPFS storage name contains unsupported characters");
  }
  return value;
}

function requireStorageManager() {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.getDirectory !== "function") {
    throw new Error("Origin Private File System is unavailable in this environment");
  }
  return storage;
}

function corruptSnapshot(message) {
  return new OpfsStorageError("OPFS_CORRUPT_SNAPSHOT", message);
}
