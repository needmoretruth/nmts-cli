/** The product these artefacts come from, spelled as the formats carry it. */
export declare const PRODUCT = "NMTS";
/** Where the recovery list's format is written down, in the copy anybody can reach. */
export declare const RECOVERY_SPEC_URL = "https://github.com/needmoretruth/nmts-recovery/blob/main/docs/RECOVERY-MANIFEST.md";
/** Where the envelope format is — key derivation, header layout, domain separators. */
export declare const CRYPTO_SPEC_URL = "https://github.com/needmoretruth/nmts-recovery/blob/main/docs/CRYPTO-FORMAT-NCF3.md";
/**
 * Which build wrote the file.
 *
 * ⚠ A CLAIM, NEVER A REQUIREMENT. It names THIS PROGRAM rather than the site release, because that
 *   is the field's own contract — what the writer says about itself — and a person holding two
 *   copies of one account's artefacts can then tell which program made each.
 */
export declare const WRITTEN_BY = "nmts-cli 0.30.0";
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
/** The block for one wrapper. */
export declare function artifactAbout(artifact: ArtifactKind): ArtifactAbout;
