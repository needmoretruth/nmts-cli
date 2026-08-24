// What the SENDER seals beside a shared file — the plaintext the recipient opens to learn what
// they were sent.
//
// It used to be the file's name and nothing else: one sealed string, opened and shown. That was
// enough while the number the server holds was the file's own length. It stopped being enough
// twice over:
//   1. The stored size became the SEALED total, so the number a recipient is handed is
//      bytes-on-the-network rather than bytes-of-the-file — larger by a fixed amount per part.
//      A length check against it fails on any file stored in more than one piece.
//   2. Size padding means a stored stream may be sealed from MORE bytes than the file has, so the
//      padding can only be taken back off by somebody who knows the real length. The owner has it
//      in their own sealed list. A recipient has nothing but what the sender sealed.
//
// So this is a small, EXTENSIBLE document rather than a bare string. Adding a field later costs a
// key here and a fallback there; it does not cost a database column, a migration, or a byte the
// server can read — which is the whole reason the size lives in here.
//
// ⛔ BACKWARD COMPATIBLE IN ONE DIRECTION, ON PURPOSE. Shares sealed before this document existed
//    hold a bare name, and `decode` reads them as exactly that. A recipient running this code
//    against an older share therefore learns the name and NOT the size — which is correct, because
//    a file shared before padding existed has none to strip. If a padded file ever were shared by
//    an old client still sealing bare names, the recipient would write the padding, the whole-file
//    content hash would not match, and the download would be DISCARDED rather than saved wrong.
//    That is the safe direction, and it is why this needed no flag day.
//
// ⚠ IT IS COPIED VERBATIM INTO OTHER PROGRAMS, so it depends on nothing. Two programs that seal
//   this document must produce the same bytes: what is sealed here is hashed into the key that
//   wraps the file's own key, so a document that differs by one character makes a share the
//   recipient cannot open.

/** The marker that tells a document apart from a file that happens to be named like JSON. */
const FORMAT = "nmts-share-file/1";

/** What a recipient learns about a shared file before fetching a byte of it. */
export interface SharedFileInfo {
  /** Plaintext file name, exactly as the sender's drive spells it. */
  name: string;
  /**
   * The file's REAL plaintext length. Absent for a share sealed before this document existed.
   *
   * Absent must be read as "not recorded", never as "zero" and never as "unpadded": what makes an
   * older share safe is the content hash, not this field.
   */
  size?: number;
}

/** The string to seal as `name_share_ct`. */
export function encodeSharedFileInfo(info: SharedFileInfo): string {
  const doc: Record<string, unknown> = { f: FORMAT, name: info.name };
  if (info.size !== undefined && Number.isSafeInteger(info.size) && info.size >= 0) {
    doc.size = info.size;
  }
  return JSON.stringify(doc);
}

/**
 * Read what the sender sealed. Never throws: a name that cannot be parsed IS the name.
 *
 * The refusal to throw is deliberate. This runs while painting a list of everything shared with a
 * person, and one row whose document is malformed must not take the other rows' names down with it.
 */
export function decodeSharedFileInfo(sealed: string): SharedFileInfo {
  if (!sealed.startsWith("{")) return { name: sealed };
  let parsed: unknown;
  try {
    parsed = JSON.parse(sealed);
  } catch {
    return { name: sealed };
  }
  if (typeof parsed !== "object" || parsed === null) return { name: sealed };
  const doc = parsed as { f?: unknown; name?: unknown; size?: unknown };
  if (doc.f !== FORMAT || typeof doc.name !== "string") return { name: sealed };
  const size =
    typeof doc.size === "number" && Number.isSafeInteger(doc.size) && doc.size >= 0
      ? doc.size
      : undefined;
  return size === undefined ? { name: doc.name } : { name: doc.name, size };
}
