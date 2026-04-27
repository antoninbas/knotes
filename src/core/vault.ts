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
const IV_LEN = 16;
const KDF_N = process.env["KNOTES_VAULT_TEST_FAST"] === "1" ? 1024 : 32768;
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
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, "vault.json\n", { mode: 0o600 });
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

export function unlock(passphrase: string): void {
  const store = readStore();
  if (!store.encrypted) return;
  const salt = Buffer.from(store.kdf.salt, "base64");
  const key = deriveKey(passphrase, salt);
  // Verify by trying to decrypt the first entry
  const entries = Object.values(store.entries);
  if (entries.length > 0) {
    try {
      decryptToken(entries[0]!, key);
    } catch {
      throw new Error("Invalid passphrase");
    }
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
  // Verify
  const entries = Object.values(store.entries);
  if (entries.length > 0) {
    try {
      decryptToken(entries[0]!, key);
    } catch {
      throw new Error("Invalid passphrase");
    }
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
  const entry = store.entries[key];
  if (!entry) return null;
  if (store.encrypted) {
    if (!cachedKey) {
      throw new VaultLockedError(
        "Vault is locked. Run 'knotes vault unlock' or set KNOTES_VAULT_PASSPHRASE."
      );
    }
    return decryptToken(entry as EncryptedStore["entries"][string], cachedKey);
  }
  return (entry as PlaintextStore["entries"][string]).token;
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
      // Ignore — will fail later with a better error if actually needed
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

/** Export a plain map of all tokens (used during migration). */
export function exportTokens(): Record<string, string> {
  const store = readStore();
  const result: Record<string, string> = {};
  for (const [id, entry] of Object.entries(store.entries)) {
    if (store.encrypted) {
      if (!cachedKey) {
        throw new Error("Vault is locked. Cannot export tokens.");
      }
      result[id] = decryptToken(entry as EncryptedStore["entries"][string], cachedKey);
    } else {
      result[id] = (entry as PlaintextStore["entries"][string]).token;
    }
  }
  return result;
}

/** Import a plain map of tokens (used during migration). */
export function importTokens(tokens: Record<string, string>): void {
  const store: PlaintextStore = { version: 1, encrypted: false, entries: {} };
  for (const [id, token] of Object.entries(tokens)) {
    store.entries[id] = { token };
  }
  writeStore(store);
}
