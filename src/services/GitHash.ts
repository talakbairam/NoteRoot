import { createHash } from "node:crypto";

/** The hash that Git (and so GitHub) gives to a file: sha1 of `blob <size>`, a zero byte and the content. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
