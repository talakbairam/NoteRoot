import * as vscode from "vscode";
import type { KeyStore } from "./EncryptedSyncProvider";

/**
 * Keeps the keys of encrypted repositories in the `SecretStorage` of VS Code (the keychain of the system). What is kept is
 * the key made from the master key, not the master key itself, and only on this computer.
 */
export class SecretKeyStore implements KeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(id: string): Promise<Buffer | undefined> {
    const hex = await this.secrets.get(id);
    return hex && /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : undefined;
  }

  async set(id: string, key: Buffer): Promise<void> {
    await this.secrets.store(id, key.toString("hex"));
  }

  async delete(id: string): Promise<void> {
    await this.secrets.delete(id);
  }
}
