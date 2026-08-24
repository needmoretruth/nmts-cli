// WHAT THIS FILE IS · WHAT OPENS IT · WHERE TO GET THAT · WHO WROTE IT — the block every recovery
// artefact this tool writes carries in its plaintext header.
//
// ⛔ WHY IT IS WORTH BYTES. Three artefacts leave this tool and live in an ordinary folder rather
//    than on the storage network: the recovery list (`.nmtsmap`), this machine's copy of the file
//    list (`.nmtslist`), and the recovery kit (`.txt`). Nothing around them supplies context — no
//    address, no account screen, no site. Years later the only question that matters is whether
//    the person holding one can act on it alone, and these fields are what answer it: which
//    product wrote it, which program reads it, where to get that program, and where the format is
//    written down.
//
// ⛔ TWO LAYERS, AND THE SPLIT IS A PRIVACY RULE. This is the PLAINTEXT layer, so it carries only
//    what a reader needs BEFORE opening anything: never a file name, never a count, never a total.
//    A leaked wrapper must not say what is inside it, or even how much. Everything here is a
//    constant of the product plus the version of the program that wrote the file.
//
// ⚠ EVERY FIELD IS A CLAIM, NEVER A REQUIREMENT. No reader can check them and none should refuse a
//   file over them — a URL can die and a repository can move. They are here to save a person a
//   search, not to decide whether a recovery may proceed.
//
// ⚠ MIRRORS `web/src/lib/recovery/provenance.ts`, which this package cannot import: the two trees
//   share no code by design. The VALUES are taken from the modules that already own them
//   (`product.ts`, `recovery-release.ts`) so a rename lands here without a second edit.

import { HOME_URL, VERSION } from "./product.ts";
import { RECOVERY_TOOL, RECOVERY_TOOL_URL } from "./recovery-release.ts";

/** The product these artefacts come from, spelled as the formats carry it. */
export const PRODUCT = "NMTS";

/** Where the recovery list's format is written down, in the copy anybody can reach. */
export const RECOVERY_SPEC_URL = `${RECOVERY_TOOL_URL}/blob/main/docs/RECOVERY-MANIFEST.md`;
/** Where the envelope format is — key derivation, header layout, domain separators. */
export const CRYPTO_SPEC_URL = `${RECOVERY_TOOL_URL}/blob/main/docs/CRYPTO-FORMAT-NCF3.md`;

/**
 * Which build wrote the file.
 *
 * ⚠ A CLAIM, NEVER A REQUIREMENT. It names THIS PROGRAM rather than the site release, because that
 *   is the field's own contract — what the writer says about itself — and a person holding two
 *   copies of one account's artefacts can then tell which program made each.
 */
export const WRITTEN_BY = `nmts-cli ${VERSION}`;

/** Which of the three artefacts a wrapper is. A reader holding several can sort them. */
export type ArtifactKind = "recovery-list" | "file-list" | "recovery-kit";

/**
 * How a sealed payload is put together — enough for a stranger to open it with the format
 * document and an account code, and nothing else.
 *
 * `context` is the NCF-3 domain separator the envelope was sealed under. It is not a secret and it
 * is not a key: it is the string a re-implementation has to pass to the same function, and one
 * that guesses it wrong gets an authentication failure with nothing to explain it.
 */
export interface SealedDescription {
  format: "ncf3";
  context: string;
  encoding: "base64url";
  /** What the reader must supply. One value, and the person has it or they do not. */
  opened_with: "nmts-account-code";
  spec_url: string;
}

/** The plaintext self-description a wrapper carries. */
export interface ArtifactAbout {
  product: string;
  product_url: string;
  app_version: string;
  artifact: ArtifactKind;
  tool: string;
  tool_url: string;
  /** Where THIS artefact's format is written down. */
  spec_url: string;
  /** Absent on the kit, which is a text file that EMBEDS a sealed document rather than being one. */
  sealed?: SealedDescription;
  /** Kit only: what is inside it, so its danger is legible before it is opened. */
  contains?: readonly string[];
}

/** The NCF-3 domain separator each sealed artefact uses. */
const SEALED_CONTEXT: Readonly<Record<"recovery-list" | "file-list", string>> = {
  "recovery-list": "nmts/v3/recovery-map",
  "file-list": "nmts/v3/file-list",
};

/** The block for one wrapper. */
export function artifactAbout(artifact: ArtifactKind): ArtifactAbout {
  const about: ArtifactAbout = {
    product: PRODUCT,
    product_url: HOME_URL,
    app_version: WRITTEN_BY,
    artifact,
    tool: RECOVERY_TOOL,
    tool_url: RECOVERY_TOOL_URL,
    spec_url: artifact === "file-list" ? CRYPTO_SPEC_URL : RECOVERY_SPEC_URL,
  };
  if (artifact === "recovery-kit") {
    // ⛔ Said out loud because this is the artefact that is dangerous to hold. A reader — a person
    //    or a program — must be able to tell from the header alone that this file carries the code.
    about.contains = ["account-code", "recovery-list"];
    return about;
  }
  about.sealed = {
    format: "ncf3",
    context: SEALED_CONTEXT[artifact],
    encoding: "base64url",
    opened_with: "nmts-account-code",
    spec_url: CRYPTO_SPEC_URL,
  };
  return about;
}
