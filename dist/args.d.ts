import type { ParsedArgs } from "./arg-options.ts";
export type { ParsedArgs } from "./arg-options.ts";
export declare const OPTIONS_TAKING_A_VALUE: string[];
export declare const FLAGS: string[];
export declare function parseArgs(argv: readonly string[]): ParsedArgs;
