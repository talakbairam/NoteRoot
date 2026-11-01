import { createHash } from "crypto";

const BLOCK_SIZE = 4 * 1024 * 1024;

/**
 * The content hash that Dropbox reports for a file (`content_hash`): the file is cut into blocks of 4 MiB, each block is hashed
 * with SHA-256, the digests are put one after the other, and that is hashed with SHA-256 again. Pure, so a local file can be
 * compared with the hash of the one online.
 */
export function dropboxContentHash(bytes: Uint8Array): string {
  const digests: Buffer[] = [];
  for (let start = 0; start < bytes.length; start += BLOCK_SIZE) {
    digests.push(
      createHash("sha256")
        .update(bytes.subarray(start, start + BLOCK_SIZE))
        .digest()
    );
  }
  return createHash("sha256").update(Buffer.concat(digests)).digest("hex");
}
