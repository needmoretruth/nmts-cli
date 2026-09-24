/** How a file may be shown. `none` means "not previewed", which is a valid and often correct answer. */
export type PreviewKind = "image" | "video" | "audio" | "text" | "pdf" | "none";
/**
 * Decide how a file named `name` may be shown, from its extension alone.
 *
 * Extension-only is deliberate: the alternative is sniffing the decrypted bytes, which means
 * deciding "is this really a PNG?" on content an attacker chose. An extension the person can see
 * in their own file list is a worse signal about the format and a much better one about intent —
 * and every branch below is safe even when the extension lies, because none of them hands the
 * bytes to a renderer that would execute them.
 *
 * Unknown ⇒ `none`. The default must be refusal, never a guess about whether a format can execute.
 */
export declare function classify(name: string): {
    kind: PreviewKind;
    mime: string;
};
