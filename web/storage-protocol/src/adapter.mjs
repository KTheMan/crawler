const STORE_NAMES = [
  "checkpoints",
  "explicit-files",
  "journals",
  "metadata",
  "quarantine",
];

export { STORE_NAMES };

/**
 * Transactional IndexedDB-shaped adapter used by protocol code and tests.
 * Values are structured-cloned at the boundary so callers cannot mutate
 * durable state through a retained reference.
 */
export class InMemoryStorageAdapter {
  #stores = new Map(STORE_NAMES.map((name) => [name, new Map()]));

  async transaction(storeNames, mode, callback) {
    requireStores(storeNames);
    if (mode !== "readonly" && mode !== "readwrite") {
      throw new TypeError(`unsupported transaction mode ${mode}`);
    }
    const selected = new Map(
      storeNames.map((name) => [name, cloneMap(this.#stores.get(name))]),
    );
    const api = memoryTransactionApi(selected, mode);
    const result = await callback(api);
    if (mode === "readwrite") {
      for (const [name, values] of selected) {
        this.#stores.set(name, values);
      }
    }
    return structuredClone(result);
  }
}

/** Browser adapter for the same transactional interface. */
export class IndexedDbStorageAdapter {
  constructor(database) {
    this.database = database;
  }

  static async open(name = "crawler-local-storage", version = 1) {
    if (!globalThis.indexedDB) {
      throw new Error("IndexedDB is unavailable in this environment");
    }
    const request = globalThis.indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      for (const store of STORE_NAMES) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(store);
        }
      }
    };
    return new IndexedDbStorageAdapter(await requestResult(request));
  }

  async transaction(storeNames, mode, callback) {
    requireStores(storeNames);
    const transaction = this.database.transaction(storeNames, mode);
    const api = {
      get: async (store, key) =>
        clone(await requestResult(transaction.objectStore(store).get(key))),
      put: async (store, key, value) => {
        assertWritable(mode);
        await requestResult(
          transaction.objectStore(store).put(clone(value), key),
        );
      },
      delete: async (store, key) => {
        assertWritable(mode);
        await requestResult(transaction.objectStore(store).delete(key));
      },
      entries: async (store, prefix = "") => {
        const objectStore = transaction.objectStore(store);
        const [keys, values] = await Promise.all([
          requestResult(objectStore.getAllKeys()),
          requestResult(objectStore.getAll()),
        ]);
        return keys
          .map((key, index) => [String(key), clone(values[index])])
          .filter(([key]) => key.startsWith(prefix))
          .sort(([left], [right]) => left.localeCompare(right));
      },
    };
    try {
      const result = await callback(api);
      await transactionComplete(transaction);
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted because of the request.
      }
      throw error;
    }
  }
}

function memoryTransactionApi(stores, mode) {
  return {
    async get(store, key) {
      return clone(requireSelectedStore(stores, store).get(key));
    },
    async put(store, key, value) {
      assertWritable(mode);
      requireSelectedStore(stores, store).set(key, clone(value));
    },
    async delete(store, key) {
      assertWritable(mode);
      requireSelectedStore(stores, store).delete(key);
    },
    async entries(store, prefix = "") {
      return [...requireSelectedStore(stores, store).entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, clone(value)]);
    },
  };
}

function cloneMap(source) {
  return new Map([...source].map(([key, value]) => [key, clone(value)]));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requireStores(names) {
  for (const name of names) {
    if (!STORE_NAMES.includes(name)) {
      throw new TypeError(`unknown object store ${name}`);
    }
  }
}

function requireSelectedStore(stores, name) {
  const store = stores.get(name);
  if (!store) {
    throw new TypeError(`object store ${name} is not in this transaction`);
  }
  return store;
}

function assertWritable(mode) {
  if (mode !== "readwrite") {
    throw new Error("readonly transaction cannot mutate storage");
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
  });
}
