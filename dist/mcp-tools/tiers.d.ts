import { type Autonomy } from "../autonomy.ts";
import type { Asker } from "../mcp-ask.ts";
import type { ToolDefinition } from "../mcp.ts";
import { type ActId, type Tier } from "../risk.ts";
interface ToolTier {
    /** The act, or how to read it off the arguments when one tool both reads and sets. */
    act: ActId | ((args: Record<string, unknown>) => ActId);
    /** Changes nothing anywhere: the client may call it freely. */
    readOnly?: true;
    /** The question put to the person, when the generic one would not name what is at stake. */
    question?: (args: Record<string, unknown>) => string;
}
export declare const TOOL_TIERS: Readonly<Record<string, ToolTier>>;
/** What `tools/list` says about a tool, in the words the MCP specification gives those hints. */
export declare function annotationsOf(name: string): Record<string, boolean>;
/** The sentence put in front of a tool's description, so the model knows the tier before calling. */
export declare function tierLine(tier: Tier): string;
/** The refusal for a client that cannot be asked, and the way round it. */
export declare function cannotAsk(what: string): string;
/** The refusal after the question was put and not agreed to. */
export declare const SAID_NO = "Refused: the person did not confirm it. Nothing was sent and nothing changed.";
/**
 * Run the tier gate for one tool call. Returns the refusal to hand back, or `null` to go ahead.
 *
 * ⛔ THE MODE AND THE ASKER ARE ARGUMENTS, NOT THINGS THIS READS, so every branch is tested for
 *    the answer it gives rather than for the machine the test runs on.
 */
export declare function passTool(name: string, args: Record<string, unknown>, mode: Autonomy, ask: Asker, now?: Date): Promise<string | null>;
/** Wrap the served tools: tier in the description, hints in the listing, the gate before each run. */
export declare function withTiers(tools: readonly ToolDefinition[], asker: () => Asker): ToolDefinition[];
export {};
