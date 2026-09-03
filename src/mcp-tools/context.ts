// What every tool in the agent surface is handed, and the two helpers they all use.
//
// ⛔ THE PLACE IS THE PERSON'S, THE NAMES ARE THE MODEL'S. `outDir` was resolved once, from what
//    the person typed when they started the server, and no tool takes a destination argument. A
//    model chooses which file, never where it lands. That is the one rule that makes the rest of
//    this surface safe to widen: adding a tool cannot add a way out of that directory, because
//    there is nowhere in a tool declaration to put one.

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
export function common(ctx: ToolContext): { server: string; network: string } {
  return { server: ctx.server, network: ctx.network };
}

/**
 * Collect what a command would have printed, so it can be handed to a model instead.
 *
 * ⛔ EVERY TOOL USES THIS AND NONE OF THEM PRINT. On this server stdout is the protocol wire; a
 *    stray line there is a parse error at the client and the whole tool list disappears with no
 *    explanation. Commands write through an injected sink precisely so that this can be true.
 */
export function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/**
 * Run one command with its output collected, and hand back what it wrote.
 *
 * ⚠ A non-zero exit code is NOT turned into a throw. A command that returns 4 has already written
 *   the explanation the model needs, and replacing it with a generic failure would throw that
 *   away. The commands that genuinely cannot proceed throw, and the transport reports those.
 */
export async function say(run: (write: (line: string) => void) => Promise<number>): Promise<string> {
  const out = collector();
  await run(out.write);
  return out.lines.join("\n");
}

/** A required string argument, with the same refusal every tool gives for it. */
export function needString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  // The transport already checked the declared schema, so this only catches an empty string —
  // which is a legal string and never a legal path, id or address.
  if (typeof value !== "string" || value === "") throw new Error(`\`${name}\` is required.`);
  return value;
}

/** Several paths at once, as the multi-path commands take them. */
export function needPaths(args: Record<string, unknown>): string[] {
  const value = args["paths"];
  if (!Array.isArray(value) || value.length === 0) throw new Error("`paths` must hold at least one path.");
  return value.filter((p): p is string => typeof p === "string" && p !== "");
}

export type ToolFactory = (ctx: ToolContext) => ToolDefinition[];
