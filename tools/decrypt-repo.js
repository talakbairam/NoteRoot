#!/usr/bin/env node
// Opens a repository that NoteRoot encrypted (Sync with encryption), without the extension. Needs only Node.js (no packages).
//
//   node decrypt-repo.js <folder of the repository> <output folder>
//
// Clone the repository first (git clone ...), or download it as a ZIP and unpack it. The script asks for the master key (it is
// not shown), opens every note and writes it, with its own name and folders, into the output folder. It never overwrites a file.
//
// Format (it must stay in step with src/services/SyncCrypto.ts):
//   .noteroot-encrypted  JSON: { format: 1, names: "plain" | "hidden", salt: base64 (16 bytes), check: base64 }
//   .noteroot-index      sealed JSON: { format: 1, files: { "<path>": { name: "<file online>", hash: "<sha256 of the note>" } } }
//   every sealed file    "NRS1" + iv (12) + tag (16) + AES-256-GCM data; the authenticated data is the path of the note
//                        (".noteroot-index" for the index, "check" for the check text)
//   key                  scrypt(master key in Unicode NFC, salt, N=32768, r=8, p=1, 32 bytes)

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const MAGIC = Buffer.from("NRS1");

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function open(key, sealed, aad) {
  if (sealed.length < 32 || !sealed.subarray(0, 4).equals(MAGIC)) {
    throw new Error("not a sealed file");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, sealed.subarray(4, 16));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.subarray(16, 32));
  return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]);
}

/** A path from the index is data from outside: no empty part, `.`, `..`, absolute path or backslash. */
function isSafe(relative) {
  return (
    relative.length > 0 &&
    !relative.startsWith("/") &&
    !relative.includes("\\") &&
    relative.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Opens every note of the repository folder into the output folder. Returns how many were written. */
function decryptRepository(repository, output, masterKey) {
  const headerFile = path.join(repository, ".noteroot-encrypted");
  if (!fs.existsSync(headerFile)) {
    throw new Error("This folder has no .noteroot-encrypted file: it is not an encrypted NoteRoot repository.");
  }
  const header = JSON.parse(fs.readFileSync(headerFile, "utf8"));
  const salt = Buffer.from(header.salt, "base64");
  const key = crypto.scryptSync(masterKey.normalize("NFC"), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    if (open(key, Buffer.from(header.check, "base64"), "check").toString("utf8") !== "NoteRoot") throw new Error();
  } catch {
    throw new Error("Wrong master key.");
  }
  const indexFile = path.join(repository, ".noteroot-index");
  const index = fs.existsSync(indexFile) ? JSON.parse(open(key, fs.readFileSync(indexFile), ".noteroot-index").toString("utf8")).files : {};
  let written = 0;
  for (const [relative, entry] of Object.entries(index)) {
    if (!isSafe(relative) || !isSafe(entry.name)) {
      process.stderr.write(`Skipped ${JSON.stringify(relative)}: the name is not safe.\n`);
      continue;
    }
    let plain;
    try {
      plain = open(key, fs.readFileSync(path.join(repository, ...entry.name.split("/"))), relative);
    } catch {
      process.stderr.write(`Skipped ${relative}: its file is missing, damaged or was changed.\n`);
      continue;
    }
    if (crypto.createHash("sha256").update(plain).digest("hex") !== entry.hash) {
      process.stderr.write(`Skipped ${relative}: the content does not match its hash.\n`);
      continue;
    }
    const target = path.join(output, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, plain, { flag: "wx" }); // Never overwrites an existing file.
    written++;
  }
  return written;
}

/** Asks for the key without showing it. */
function askKey() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = () => {}; // Keeps the typed characters off the screen.
    process.stderr.write("Master key: ");
    rl.question("", (answer) => {
      process.stderr.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [repository, output] = process.argv.slice(2);
  if (!repository || !output) {
    fail("Usage: node decrypt-repo.js <folder of the repository> <output folder>");
  }
  const masterKey = await askKey();
  try {
    const count = decryptRepository(repository, output, masterKey);
    process.stderr.write(`${count} notes written to ${output}\n`);
  } catch (error) {
    fail(error.message);
  }
}

module.exports = { decryptRepository };
if (require.main === module) {
  main();
}
