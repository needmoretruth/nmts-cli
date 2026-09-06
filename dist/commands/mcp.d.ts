import { destinationFor } from "../safe-path.ts";
export { destinationFor };
export interface McpOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Where fetched files land. Defaults to the working directory the person started this in. */
    out?: string | undefined;
    /** Overridable so a test can drive both ends without pipes. */
    input?: NodeJS.ReadableStream;
    output?: (line: string) => void;
    note?: (line: string) => void;
}
/**
 * Every schema this program actually serves, for the gate that checks they can be enforced.
 *
 * ⛔ IT BUILDS THE REAL TABLE rather than restating it. A hand-kept list of tool names in a test is
 *    a list that goes stale the day somebody adds a tool, and the failure is a tool nobody checks.
 *    The context here is a placeholder — no tool reads it while its schema is being looked at.
 */
export declare function mcpToolSchemas(): {
    name: string;
    inputSchema: Record<string, unknown>;
}[];
export declare function mcp(options?: McpOptions): Promise<number>;
