#!/usr/bin/env node
/**
 * Commands the help text announces but this version cannot run.
 *
 * ⛔ ANNOUNCED-AND-UNFINISHED IS NOT THE SAME AS UNKNOWN, and an agent needs to tell them apart:
 *    unknown means "you guessed the name wrong, try again", unfinished means "stop, this will not
 *    work however you spell it". They get different exit codes for exactly that reason.
 *
 * ⛔ EMPTY IS THE GOAL, NOT AN OVERSIGHT. Everything help names, this version runs.
 */
export declare const NOT_BUILT_YET: readonly string[];
export declare function run(argv: readonly string[]): Promise<number>;
