export interface DocumentOptions {
    server?: string | undefined;
    /** Machine-readable output, where the command has one. */
    json?: boolean;
    /** Keep the document as a file rather than printing it. */
    save?: boolean;
    /** Which directory `--save` writes into. Default: this one. */
    out?: string | undefined;
    /** `terms`/`privacy`: which language. Default: English, which is the canonical text. */
    lang?: string | undefined;
    /** `terms`: the board's terms rather than the service's. */
    board?: boolean;
    write?: (line: string) => void;
}
/**
 * The three verbs, dispatched from one module.
 *
 * ⛔ ONE ENTRY POINT BECAUSE THEY ARE ONE SUBJECT — the documents this service publishes — and
 *    because every command in `main.ts` is loaded only when it is the command being run. Three
 *    entries there would be three imports to keep in step for one file.
 */
export declare function runDocuments(command: string, options: DocumentOptions & {
    id?: string | undefined;
}): Promise<number>;
/**
 * `nmts notices` — the board, one notice, or one notice kept as a file.
 *
 * The id, when there is one, is the operand: `nmts notices <id>` prints it and
 * `nmts notices --save <id>` writes it. With no id the command lists.
 */
export declare function notices(options?: DocumentOptions & {
    id?: string | undefined;
}): Promise<number>;
/** `nmts terms` and `nmts privacy` — the published document, printed or kept. */
export declare function legal(which: "terms" | "privacy", options?: DocumentOptions): Promise<number>;
