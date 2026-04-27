import type { Command } from "commander";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  setupEncryption,
  disableEncryption,
  unlock,
  lock,
  isEncrypted,
  isLocked,
} from "../../core/vault.ts";
import { ensureHome } from "../../core/config.ts";
import {
  unlockVault,
  lockVault,
  getVaultLockStatus,
} from "../../core/router.ts";

async function readPasswordFromStdin(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let data = "";

    if (process.stdin.isTTY) {
      // Use readline with a muted output stream so nothing is echoed.
      // This handles UTF-8, backspace, and arrow keys correctly.
      const muted = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const rl = createInterface({
        input: process.stdin,
        output: muted,
        terminal: true,
      });
      rl.on("line", (line) => {
        rl.close();
        process.stdout.write("\n");
        resolve(line.trim());
      });
    } else {
      process.stdin.setEncoding("utf-8");
      const onData = (chunk: string) => {
        const newlineIdx = chunk.indexOf("\n");
        if (newlineIdx >= 0) {
          data += chunk.slice(0, newlineIdx);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          resolve(data.trim());
        } else {
          data += chunk;
        }
      };
      process.stdin.on("data", onData);
      process.stdin.resume();
    }
  });
}

export function registerVaultCommand(program: Command): void {
  const vault = program
    .command("vault")
    .description("Manage the encrypted credential vault");

  vault
    .command("encrypt")
    .description("Encrypt the vault with a passphrase")
    .option("--passphrase <p>", "Passphrase (omit to prompt interactively)")
    .action(async (opts) => {
      await ensureHome();
      if (isEncrypted()) {
        console.error("Vault is already encrypted. Run 'decrypt' first to re-encrypt with a different passphrase.");
        process.exit(1);
      }
      let passphrase = opts.passphrase as string | undefined;
      if (passphrase) {
        console.warn("Warning: passing passphrase on the command line is insecure; it will appear in shell history.");
      }
      if (!passphrase) {
        if (!process.stdin.isTTY) {
          console.error("No --passphrase provided and stdin is not a TTY. Pass --passphrase <p> or run interactively.");
          process.exit(1);
        }
        passphrase = await readPasswordFromStdin("Passphrase: ");
        if (!passphrase) {
          console.error("Empty passphrase, aborting.");
          process.exit(1);
        }
        const confirm = await readPasswordFromStdin("Confirm passphrase: ");
        if (passphrase !== confirm) {
          console.error("Passphrases do not match, aborting.");
          process.exit(1);
        }
      }
      setupEncryption(passphrase);
      console.log("Vault encrypted successfully.");
    });

  vault
    .command("decrypt")
    .description("Decrypt the vault back to plaintext")
    .option("--passphrase <p>", "Current passphrase (omit to prompt interactively)")
    .action(async (opts) => {
      await ensureHome();
      if (!isEncrypted()) {
        console.error("Vault is not encrypted.");
        process.exit(1);
      }
      let passphrase = opts.passphrase as string | undefined;
      if (passphrase) {
        console.warn("Warning: passing passphrase on the command line is insecure; it will appear in shell history.");
      }
      if (!passphrase) {
        if (!process.stdin.isTTY) {
          console.error("No --passphrase provided and stdin is not a TTY. Pass --passphrase <p> or run interactively.");
          process.exit(1);
        }
        passphrase = await readPasswordFromStdin("Passphrase: ");
        if (!passphrase) {
          console.error("Empty passphrase, aborting.");
          process.exit(1);
        }
      }
      disableEncryption(passphrase);
      console.log("Vault decrypted successfully.");
    });

  vault
    .command("unlock")
    .description("Unlock the vault (verify passphrase)")
    .option("--passphrase <p>", "Passphrase (omit to prompt interactively)")
    .action(async (opts) => {
      await ensureHome();
      if (!isEncrypted()) {
        console.log("Vault is not encrypted. Nothing to unlock.");
        return;
      }
      let passphrase = opts.passphrase as string | undefined;
      if (passphrase) {
        console.warn("Warning: passing passphrase on the command line is insecure; it will appear in shell history.");
      }
      if (!passphrase) {
        passphrase = process.env["KNOTES_VAULT_PASSPHRASE"];
      }
      if (!passphrase) {
        if (!process.stdin.isTTY) {
          console.error("Vault is locked. Set KNOTES_VAULT_PASSPHRASE or run interactively.");
          process.exit(1);
        }
        passphrase = await readPasswordFromStdin("Passphrase: ");
        if (!passphrase) {
          console.error("Empty passphrase, aborting.");
          process.exit(1);
        }
      }
      await unlockVault(passphrase);
      console.log("Vault unlocked.");
    });

  vault
    .command("lock")
    .description("Lock the vault immediately")
    .action(async () => {
      await ensureHome();
      if (!isEncrypted()) {
        console.log("Vault is not encrypted. Nothing to lock.");
        return;
      }
      await lockVault();
      console.log("Vault locked.");
    });

  vault
    .command("status")
    .description("Show vault status")
    .action(() => {
      if (!isEncrypted()) {
        console.log("Vault: plaintext (not encrypted)");
        return;
      }
      console.log(`Vault: encrypted, ${isLocked() ? "locked" : "unlocked"}`);
    });
}
