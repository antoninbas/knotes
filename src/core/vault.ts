import { join } from "path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { getHome } from "./config.ts";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KDF_N = process.env["KNOTES_VAULT_TEST_FAST"] === "1" ? 1024 : 131072;
const KDF_R = 8;
const KDF_P = 1;
const KDF_KEYLEN = 32;

interface PlaintextStore {
  version: 1;
  encrypted: false;
  entries: Record<string, { token: string }>;
}

interface EncryptedStore {
  version: 1;
  encrypted: true;
  kdf: {
    algorithm: "scrypt";
    salt: string; // base64
    N: number;
    r: number;
    p: number;
  };
  verifier: {
    iv: string; // base64
    authTag: string; // base64
    ciphertext: string; // base64
  };
  entries: Record<string, {
    iv: string; // base64
    authTag: string; // base64
    ciphertext: string; // base64
  }>;
}

type Store = PlaintextStore | EncryptedStore;

let cachedKey: Buffer | null = null;

function vaultPath(): string {
  return join(getHome(), ".data", "vault.json");
}

function ensureGitignore(): void {
  const gitignorePath = join(getHome(), ".data", ".gitignore");
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const lines = content.split("\n");
  if (!lines.includes("vault.json")) {
    writeFileSync(
      gitignorePath,
      content + (content.endsWith("\n") ? "" : "\n") + "vault.json\n"
    );
  }
}

function readStore(): Store {
  const path = vaultPath();
  if (!existsSync(path)) {
    return { version: 1, encrypted: false, entries: {} };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Store;
}

function writeStore(store: Store): void {
  const path = vaultPath();
  const dir = join(getHome(), ".data");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureGitignore();
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KDF_KEYLEN, {
    N: KDF_N,
    r: KDF_R,
    p: KDF_P,
  });
}

function encryptToken(
  token: string,
  key: Buffer
): { iv: string; authTag: string; ciphertext: string } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decryptToken(
  entry: { iv: string; authTag: string; ciphertext: string },
  key: Buffer
): string {
  const iv = Buffer.from(entry.iv, "base64");
  const authTag = Buffer.from(entry.authTag, "base64");
  const ciphertext = Buffer.from(entry.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}

export function isEncrypted(): boolean {
  const store = readStore();
  return store.encrypted;
}

export function vaultExists(): boolean {
  return existsSync(vaultPath());
}

export function vaultEntryCount(): number {
  const store = readStore();
  return Object.keys(store.entries).length;
}

export function ensureVaultExists(): void {
  if (!existsSync(vaultPath())) {
    writeStore({ version: 1, encrypted: false, entries: {} });
  }
}

export function unlock(passphrase: string): void {
  const store = readStore();
  if (!store.encrypted) return;
  const salt = Buffer.from(store.kdf.salt, "base64");
  const key = deriveKey(passphrase, salt);
  // Verify by decrypting the canary
  try {
    decryptToken(store.verifier, key);
  } catch {
    throw new Error("Invalid passphrase");
  }
  cachedKey = key;
}

export function lock(): void {
  cachedKey = null;
}

export function isLocked(): boolean {
  const store = readStore();
  return store.encrypted && cachedKey === null;
}

export function setupEncryption(passphrase: string): void {
  const store = readStore();
  if (store.encrypted) {
    throw new Error(
      "Vault is already encrypted. Run 'decrypt' first to re-encrypt with a different passphrase."
    );
  }
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const newEntries: EncryptedStore["entries"] = {};
  for (const [id, entry] of Object.entries(store.entries)) {
    newEntries[id] = encryptToken(entry.token, key);
  }
  const encryptedStore: EncryptedStore = {
    version: 1,
    encrypted: true,
    kdf: {
      algorithm: "scrypt",
      salt: salt.toString("base64"),
      N: KDF_N,
      r: KDF_R,
      p: KDF_P,
    },
    verifier: encryptToken("knotes-vault-canary", key),
    entries: newEntries,
  };
  writeStore(encryptedStore);
  cachedKey = key;
}

export function disableEncryption(passphrase: string): void {
  const store = readStore();
  if (!store.encrypted) {
    throw new Error("Vault is not encrypted.");
  }
  const salt = Buffer.from(store.kdf.salt, "base64");
  const key = deriveKey(passphrase, salt);
  // Verify by decrypting the canary
  try {
    decryptToken(store.verifier, key);
  } catch {
    throw new Error("Invalid passphrase");
  }
  const newEntries: PlaintextStore["entries"] = {};
  for (const [id, entry] of Object.entries(store.entries)) {
    newEntries[id] = { token: decryptToken(entry, key) };
  }
  writeStore({ version: 1, encrypted: false, entries: newEntries });
  cachedKey = null;
}

function makeKey(host: string, login: string): string {
  return `${host}:${login}`;
}

export function setToken(host: string, login: string, token: string): void {
  const store = readStore();
  if (store.encrypted) {
    if (!cachedKey) {
      throw new VaultLockedError(
        "Vault is locked. Run 'knotes vault unlock' or set KNOTES_VAULT_PASSPHRASE."
      );
    }
    store.entries[makeKey(host, login)] = encryptToken(token, cachedKey);
  } else {
    store.entries[makeKey(host, login)] = { token };
  }
  writeStore(store);
}

export function getToken(host: string, login: string): string | null {
  const store = readStore();
  const key = makeKey(host, login);
  if (store.encrypted) {
    if (!cachedKey) {
      throw new VaultLockedError(
        "Vault is locked. Run 'knotes vault unlock' or set KNOTES_VAULT_PASSPHRASE."
      );
    }
    const entry = store.entries[key];
    if (!entry) return null;
    return decryptToken(entry, cachedKey);
  }
  const entry = store.entries[key];
  if (!entry) return null;
  return entry.token;
}

export function deleteToken(host: string, login: string): void {
  const store = readStore();
  delete store.entries[makeKey(host, login)];
  writeStore(store);
}

export function listTokens(): { host: string; login: string }[] {
  const store = readStore();
  return Object.keys(store.entries).map((k) => {
    const idx = k.indexOf(":");
    if (idx < 0) return { host: k, login: "" };
    return { host: k.slice(0, idx), login: k.slice(idx + 1) };
  });
}

export function ensureUnlocked(): void {
  const store = readStore();
  if (store.encrypted && !cachedKey) {
    throw new VaultLockedError(
      "Vault is locked. Run 'knotes vault unlock' or set KNOTES_VAULT_PASSPHRASE."
    );
  }
}

export function tryAutoUnlock(): void {
  const passphrase = process.env["KNOTES_VAULT_PASSPHRASE"];
  if (passphrase && isEncrypted()) {
    try {
      unlock(passphrase);
    } catch {
      console.warn("Warning: KNOTES_VAULT_PASSPHRASE is set but the passphrase is incorrect; vault remains locked.");
    }
  }
}

/** Reset cached key (used in tests to simulate a fresh process). */
export function resetVaultCache(): void {
  cachedKey = null;
}

export class VaultLockedError extends Error {
  constructor(message: string = "Vault is locked") {
    super(message);
    this.name = "VaultLockedError";
  }
}

