import type { ParsedArgs } from "../args.ts";
/** Is this one of the settings commands? */
export declare function isSettingsCommand(command: string): boolean;
/** Run it. Only call this when `isSettingsCommand` said yes. */
export declare function runSettings(command: string, args: ParsedArgs): Promise<number>;
