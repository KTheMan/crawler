const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const MANIFEST_PATH = "manifest.json";
export const DOCUMENT_MEDIA_TYPE = "application/vnd.crawler.document+json";
export const PART_PACKAGE_MEDIA_TYPE = "application/vnd.crawler.part+zip";

const DOCUMENT_FIELDS = [
  "schema_version",
  "id",
  "display_name",
  "revision",
  "units",
  "root_component",
  "origin_planes",
  "components",
  "bodies",
  "sketches",
  "features",
  "parameters",
  "topology_references",
  "transactions",
  "recompute",
];
const MAP_FIELDS = new Set([
  "origin_planes",
  "components",
  "bodies",
  "sketches",
  "features",
  "parameters",
  "topology_references",
  "inputs",
]);
const MANIFEST_FIELDS = [
  "format_version",
  "package_id",
  "document_kind",
  "document_schema_version",
  "required_features",
  "root_payload",
  "payloads",
];
const DESCRIPTOR_FIELDS = [
  "role",
  "media_type",
  "byte_length",
  "sha256",
  "path",
];

export class StorageProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "StorageProtocolError";
    this.code = code;
    this.details = details;
  }
}

/** Canonical semantic document bytes; volatile workspace state is not input. */
export function canonicalDocumentBytes(document) {
  const normalized = canonicalizeDocument(document);
  return encoder.encode(`${JSON.stringify(normalized)}\n`);
}

/** Mirrors crawler-part-engine: semantic hashes cover canonical document bytes. */
export function semanticDocumentHash(document) {
  return sha256(canonicalDocumentBytes(document));
}

export function decodeCanonicalDocumentBytes(bytes) {
  const document = parseJsonBytes(bytes, "checkpoint document");
  validateDocumentEnvelope(document);
  if (!bytesEqual(canonicalDocumentBytes(document), bytes)) {
    throw new StorageProtocolError(
      "NONCANONICAL_DOCUMENT",
      "checkpoint document bytes are not canonical",
    );
  }
  return document;
}

export function savePartEntrySet(document, requiredFeatures = []) {
  validateDocumentEnvelope(document);
  const features = normalizeFeatureTokens(requiredFeatures);
  const documentBytes = canonicalDocumentBytes(document);
  const digest = sha256(documentBytes);
  const path = payloadPath(digest);
  const manifest = {
    format_version: 1,
    package_id: document.id,
    document_kind: "part",
    document_schema_version: document.schema_version,
    required_features: features,
    root_payload: "document",
    payloads: {
      document: {
        role: "semantic_document",
        media_type: DOCUMENT_MEDIA_TYPE,
        byte_length: documentBytes.byteLength,
        sha256: digest,
        path,
      },
    },
  };
  const manifestBytes = canonicalManifestBytes(manifest);
  return new Map([
    [MANIFEST_PATH, manifestBytes],
    [path, documentBytes],
  ]);
}

/** Convenience boundary proving view state is excluded from saves. */
export function saveWorkspacePart(workspace, requiredFeatures = []) {
  if (!workspace || typeof workspace !== "object" || !workspace.document) {
    throw new StorageProtocolError(
      "INVALID_WORKSPACE",
      "workspace must expose its semantic document",
    );
  }
  return savePartEntrySet(workspace.document, requiredFeatures);
}

export function loadPartEntrySet(entrySet, supportedFeatures = new Set()) {
  const entries = normalizeEntrySet(entrySet);
  const manifestBytes = entries.get(MANIFEST_PATH);
  if (!manifestBytes) {
    throw new StorageProtocolError("MISSING_MANIFEST", "package is missing manifest.json");
  }
  const manifest = parseJsonBytes(manifestBytes, "manifest");
  validateManifest(manifest, manifestBytes, supportedFeatures);

  const declaredPaths = new Set([MANIFEST_PATH]);
  for (const [logicalName, descriptor] of Object.entries(manifest.payloads)) {
    declaredPaths.add(descriptor.path);
    const bytes = entries.get(descriptor.path);
    if (!bytes) {
      throw new StorageProtocolError(
        "MISSING_PAYLOAD",
        `payload ${logicalName} is missing ${descriptor.path}`,
      );
    }
    if (bytes.byteLength !== descriptor.byte_length) {
      throw new StorageProtocolError(
        "PAYLOAD_LENGTH_MISMATCH",
        `payload ${logicalName} length differs`,
      );
    }
    const digest = sha256(bytes);
    if (digest !== descriptor.sha256) {
      throw new StorageProtocolError(
        "PAYLOAD_HASH_MISMATCH",
        `payload ${logicalName} SHA-256 differs`,
      );
    }
  }
  const unexpected = [...entries.keys()].find((path) => !declaredPaths.has(path));
  if (unexpected) {
    throw new StorageProtocolError(
      "UNDECLARED_ENTRY",
      `package entry ${unexpected} is not declared`,
    );
  }

  const root = manifest.payloads[manifest.root_payload];
  if (
    !root ||
    root.role !== "semantic_document" ||
    root.media_type !== DOCUMENT_MEDIA_TYPE
  ) {
    throw new StorageProtocolError(
      "INVALID_ROOT_PAYLOAD",
      "root payload must be declarative Crawler document JSON",
    );
  }
  const documentBytes = entries.get(root.path);
  const document = parseJsonBytes(documentBytes, "document");
  validateDocumentEnvelope(document);
  if (document.id !== manifest.package_id) {
    throw new StorageProtocolError(
      "PACKAGE_IDENTITY_MISMATCH",
      "manifest package identity differs from document identity",
    );
  }
  if (!bytesEqual(canonicalDocumentBytes(document), documentBytes)) {
    throw new StorageProtocolError(
      "NONCANONICAL_DOCUMENT",
      "document payload bytes are not canonical",
    );
  }
  return { document, manifest };
}

export function canonicalManifestBytes(manifest) {
  const payloads = {};
  for (const logicalName of Object.keys(manifest.payloads).sort()) {
    const descriptor = manifest.payloads[logicalName];
    payloads[logicalName] = Object.fromEntries(
      DESCRIPTOR_FIELDS.map((field) => [field, descriptor[field]]),
    );
  }
  const normalized = {
    format_version: manifest.format_version,
    package_id: manifest.package_id,
    document_kind: manifest.document_kind,
    document_schema_version: manifest.document_schema_version,
    required_features: [...manifest.required_features],
    root_payload: manifest.root_payload,
    payloads,
  };
  return encoder.encode(`${JSON.stringify(normalized)}\n`);
}

export function entrySetsEqual(left, right) {
  const leftEntries = [...normalizeEntrySet(left).entries()];
  const rightEntries = [...normalizeEntrySet(right).entries()];
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([path, bytes], index) =>
        path === rightEntries[index][0] && bytesEqual(bytes, rightEntries[index][1]),
    )
  );
}

function validateManifest(manifest, originalBytes, supportedFeatures) {
  requireExactFields(manifest, MANIFEST_FIELDS, "manifest");
  if (manifest.format_version !== 1) {
    throw new StorageProtocolError(
      "UNSUPPORTED_PACKAGE_VERSION",
      `package format version ${manifest.format_version} is unsupported`,
    );
  }
  if (manifest.document_kind !== "part") {
    throw new StorageProtocolError("WRONG_DOCUMENT_KIND", "package is not a part");
  }
  if (manifest.document_schema_version !== 1) {
    throw new StorageProtocolError(
      "UNSUPPORTED_DOCUMENT_SCHEMA",
      `document schema version ${manifest.document_schema_version} is unsupported`,
    );
  }
  const features = normalizeFeatureTokens(manifest.required_features);
  if (JSON.stringify(features) !== JSON.stringify(manifest.required_features)) {
    throw new StorageProtocolError(
      "NONCANONICAL_MANIFEST",
      "required features must be sorted and unique",
    );
  }
  const supported = new Set(supportedFeatures);
  const unsupported = features.find((feature) => !supported.has(feature));
  if (unsupported) {
    throw new StorageProtocolError(
      "UNSUPPORTED_REQUIRED_FEATURE",
      `required document feature ${unsupported} is unsupported`,
      { feature: unsupported },
    );
  }
  if (!manifest.package_id || !manifest.root_payload) {
    throw new StorageProtocolError(
      "INVALID_MANIFEST",
      "package and root payload identities are required",
    );
  }
  if (!manifest.payloads || typeof manifest.payloads !== "object") {
    throw new StorageProtocolError("INVALID_MANIFEST", "payload map is required");
  }
  for (const [name, descriptor] of Object.entries(manifest.payloads)) {
    if (!portableToken(name)) {
      throw new StorageProtocolError("INVALID_MANIFEST", `invalid payload name ${name}`);
    }
    validateDescriptor(descriptor);
  }
  if (!bytesEqual(canonicalManifestBytes(manifest), originalBytes)) {
    throw new StorageProtocolError(
      "NONCANONICAL_MANIFEST",
      "manifest bytes are not canonical",
    );
  }
}

function validateDescriptor(descriptor) {
  requireExactFields(descriptor, DESCRIPTOR_FIELDS, "payload descriptor");
  const allowed =
    (descriptor.role === "semantic_document" &&
      descriptor.media_type === DOCUMENT_MEDIA_TYPE) ||
    (descriptor.role === "imported_geometry" && descriptor.media_type === "model/step");
  if (!allowed) {
    throw new StorageProtocolError(
      "EXECUTABLE_OR_UNKNOWN_PAYLOAD",
      "payload role/media type is not declarative document JSON or STEP",
    );
  }
  if (!Number.isSafeInteger(descriptor.byte_length) || descriptor.byte_length < 0) {
    throw new StorageProtocolError("INVALID_MANIFEST", "payload byte length is invalid");
  }
  const expectedPath = payloadPath(descriptor.sha256);
  if (descriptor.path !== expectedPath) {
    throw new StorageProtocolError(
      "INVALID_PAYLOAD_PATH",
      `payload path must be ${expectedPath}`,
    );
  }
}

function validateDocumentEnvelope(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new StorageProtocolError("INVALID_DOCUMENT", "document must be an object");
  }
  if (document.schema_version !== 1) {
    throw new StorageProtocolError(
      "UNSUPPORTED_DOCUMENT_SCHEMA",
      `document schema version ${document.schema_version} is unsupported`,
    );
  }
  if (typeof document.id !== "string" || document.id.length === 0) {
    throw new StorageProtocolError("INVALID_DOCUMENT", "document id is required");
  }
}

function canonicalizeDocument(document) {
  validateDocumentEnvelope(document);
  const normalized = {};
  for (const field of DOCUMENT_FIELDS) {
    if (Object.hasOwn(document, field)) {
      normalized[field] = canonicalizeValue(document[field], field);
    }
  }
  for (const field of Object.keys(document).sort()) {
    if (!DOCUMENT_FIELDS.includes(field)) {
      normalized[field] = canonicalizeValue(document[field], field);
    }
  }
  return normalized;
}

function canonicalizeValue(value, field = "") {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const keys = MAP_FIELDS.has(field) ? Object.keys(value).sort() : Object.keys(value);
  const result = {};
  for (const key of keys) {
    result[key] = canonicalizeValue(value[key], key);
  }
  if (field === "recompute" && result.features) {
    result.features = Object.fromEntries(
      Object.keys(result.features)
        .sort()
        .map((key) => [key, result.features[key]]),
    );
  }
  return result;
}

function normalizeFeatureTokens(features) {
  if (!Array.isArray(features)) {
    throw new StorageProtocolError("INVALID_MANIFEST", "required_features must be an array");
  }
  const normalized = [...new Set(features)].sort();
  if (normalized.some((feature) => !portableToken(feature))) {
    throw new StorageProtocolError(
      "INVALID_REQUIRED_FEATURE",
      "required feature token is not portable lowercase ASCII",
    );
  }
  return normalized;
}

function portableToken(value) {
  return typeof value === "string" && /^[a-z0-9._:/-]+$/.test(value);
}

function payloadPath(digest) {
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new StorageProtocolError("INVALID_SHA256", "SHA-256 must be lowercase hexadecimal");
  }
  return `payloads/sha256/${digest.slice(0, 2)}/${digest.slice(2)}`;
}

function requireExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StorageProtocolError("INVALID_MANIFEST", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new StorageProtocolError(
      "UNKNOWN_MANIFEST_FIELD",
      `${label} fields differ from version 1`,
    );
  }
}

function normalizeEntrySet(entrySet) {
  const entries = entrySet instanceof Map ? [...entrySet] : [...entrySet];
  const normalized = new Map();
  for (const [path, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof path !== "string" || normalized.has(path)) {
      throw new StorageProtocolError("INVALID_ENTRY_SET", "entry paths must be unique strings");
    }
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    normalized.set(path, new Uint8Array(bytes));
  }
  return normalized;
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new StorageProtocolError("MALFORMED_JSON", `${label} JSON is invalid: ${error.message}`);
  }
}

function sha256(bytes) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 =
        rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 =
        rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

function bytesEqual(left, right) {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}
