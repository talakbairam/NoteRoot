#!/usr/bin/env node
// Decrypts a note encrypted by the NoteRoot extension, without the extension. Needs only Node.js (no packages).
//
//   node decrypt.js ideas.md.enc              asks for the master key, prints the text
//   node decrypt.js ideas.md.enc ideas.md     asks for the master key, writes the text to a file
//
// Format: the first line is "NOTEROOT-ENCRYPTED v1", then base64 of salt (16) + iv (12) + tag (16) + ciphertext.
// Key: scrypt(master key in Unicode NFC, salt, N=32768, r=8, p=1, 32 bytes). Cipher: AES-256-GCM, with the first line as AAD.

const fs = require("node:fs");
const crypto = require("node:crypto");
const readline = require("node:readline");

const HEADER = "NOTEROOT-ENCRYPTED v1";

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
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
  const [input, output] = process.argv.slice(2);
  if (!input) {
    fail("Usage: node decrypt.js <file.enc> [output file]");
  }
  const text = fs.readFileSync(input, "utf8");
  if (!text.startsWith(HEADER + "\n") && !text.startsWith(HEADER + "\r\n")) {
    fail("This is not a NoteRoot encrypted note.");
  }
  const payload = Buffer.from(text.slice(HEADER.length).replace(/\s+/g, ""), "base64");
  if (payload.length < 44) {
    fail("The file is cut short.");
  }
  const key = await askKey();
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const body = payload.subarray(44);
  const derived = crypto.scryptSync(key.normalize("NFC"), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv("aes-256-gcm", derived, iv);
  decipher.setAAD(Buffer.from(HEADER));
  decipher.setAuthTag(tag);
  let plain;
  try {
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    fail("Wrong master key, or the file is damaged.");
  }
  if (output) {
    fs.writeFileSync(output, plain, { flag: "wx" }); // Never overwrites an existing file.
    process.stderr.write("Written to " + output + "\n");
  } else {
    process.stdout.write(plain);
  }
}

main();
