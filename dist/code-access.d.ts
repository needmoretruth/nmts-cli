import { type CredentialSource } from "./credentials.ts";
export interface OpenedCode {
    code: string;
    source: CredentialSource;
}
/**
 * The NMTS key for this run, opening a sealed one if that is what is stored.
 *
 * Returns null when there is nothing to use — the caller decides whether that is an error, which
 * differs between `whoami` (say so quietly) and `put` (refuse).
 */
export interface OpenOptions {
    /**
     * May this run stop and ask on the terminal?
     *
     * ⛔ FALSE FOR `nmts mcp`, AND THAT IS NOT TIDINESS. Its stdin carries the protocol: a prompt
     *    there consumes the client's first message as a passphrase guess, and the answer it prints
     *    lands on the wire as bytes the other end cannot parse. An MCP server that cannot open its
     *    credential must say so and exit, not negotiate.
     */
    allowPrompt?: boolean;
}
export declare function openAccountCode(options?: OpenOptions): Promise<OpenedCode | null>;
/**
 * The code, or a refusal naming what to do about it. For commands that cannot proceed without it.
 *
 * ⛔ The message never mentions the code itself, only where one could come from.
 */
export declare function requireAccountCode(options?: OpenOptions): Promise<OpenedCode>;
