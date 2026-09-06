import type { Asker } from "../mcp-ask.ts";
import type { ToolDefinition } from "../mcp.ts";
export interface ToolContext {
    server: string;
    network: string;
    /** Where anything fetched lands. Chosen by the person, never by the model. */
    outDir: string;
    accountId: string;
    /**
     * How to put a question in front of the person, or `null` when this client declared no way.
     *
     * ⛔ A FUNCTION, NOT A VALUE. The tools are built when the server starts and the answer is not
     *    known until the client has spoken, so reading it early would freeze in a `null` that was
     *    only ever "not yet".
     */
    asker: () => Asker;
}
/** The server and network every command takes, in the shape they take it. */
export declare function common(ctx: ToolContext): {
    server: string;
    network: string;
};
/**
 * Collect what a command would have printed, so it can be handed to a model instead.
 *
 * ⛔ EVERY TOOL USES THIS AND NONE OF THEM PRINT. On this server stdout is the protocol wire; a
 *    stray line there is a parse error at the client and the whole tool list disappears with no
 *    explanation. Commands write through an injected sink precisely so that this can be true.
 */
export declare function collector(): {
    lines: string[];
    write: (line: string) => void;
};
/**
 * Run one command with its output collected, and hand back what it wrote.
 *
 * ⚠ A non-zero exit code is NOT turned into a throw. A command that returns 4 has already written
 *   the explanation the model needs, and replacing it with a generic failure would throw that
 *   away. The commands that genuinely cannot proceed throw, and the transport reports those.
 */
export declare function say(run: (write: (line: string) => void) => Promise<number>): Promise<string>;
/** A required string argument, with the same refusal every tool gives for it. */
export declare function needString(args: Record<string, unknown>, name: string): string;
/** Several paths at once, as the multi-path commands take them. */
export declare function needPaths(args: Record<string, unknown>): string[];
export type ToolFactory = (ctx: ToolContext) => ToolDefinition[];
