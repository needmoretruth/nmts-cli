// Which S3 keys a drive can hold, and when two keys are the same key.
//
// ⛔ A KEY IS A PATH IN A DRIVE, AND NOT EVERY S3 KEY IS ONE. S3 takes any bytes up to 1,024 of
//    them; a drive has folders and names, so `/x`, `a//b`, `a/./b` and a name made of control
//    characters have nowhere to go. Stored anyway, they came back under a different key — `/x`
//    listed as `x` — and the gateway answered 500 "stored but not shown" for a file it had paid
//    for, which a client retries, paying again each time. So they are refused BEFORE the body is
//    read, with a 400 a client does not retry.
//
// ⛔ TWO SPELLINGS OF ONE NAME ARE ONE KEY. The drive folds names to Unicode NFC when it compares
//    them — macOS writes `café` decomposed and a browser composed — so a key is compared the same
//    way here. Compared byte for byte instead, an upload to the other spelling was "free", stored
//    beside the file a person sees as the same one, or replaced it without asking whether its bytes
//    were the same.

import { S3Refusal } from "./answer.ts";
import { isFolderKey } from "./listing.ts";

/** S3's own ceiling on a key, in UTF-8 bytes. */
export const MAX_KEY_BYTES = 1024;

/** The form two keys are compared in: the drive's own folding of names. */
export function sameKey(key: string): string {
  return key.normalize("NFC");
}

function badKey(why: string): S3Refusal {
  return new S3Refusal(400, "InvalidArgument", `${why} Nothing was read or stored.`);
}

/** True when a string holds a C0 control character (U+0000 to U+001F). */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/**
 * Refuse a key this drive cannot hold as the path it names. A key ending in `/` is a folder marker
 * and is judged as the folder it names.
 *
 * ⛔ EVERY CHECK IS ON THE KEY ALONE, so this runs before the body is read and before any list is.
 */
export function checkKey(key: string): void {
  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new S3Refusal(400, "KeyTooLongError", `The key is longer than ${MAX_KEY_BYTES} bytes. Nothing was read or stored.`);
  }
  if (hasControl(key)) throw badKey("The key holds a control character, which no name in a drive can hold.");
  if (key.startsWith("/")) {
    throw badKey("The key begins with `/`, and a path in a drive has no empty name at its start.");
  }
  const path = isFolderKey(key) ? key.slice(0, -1) : key;
  for (const name of path.split("/")) {
    if (name === "") throw badKey("The key has an empty name between two `/`.");
    if (name === "." || name === "..") throw badKey("The key has `.` or `..` as a name, which a path in a drive cannot.");
    if (name.trim() === "") throw badKey("The key has a name that is only spaces.");
  }
}
