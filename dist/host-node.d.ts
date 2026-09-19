import { type Host, type StateHost } from "./host.ts";
/** Files under the person's own config directory, named by `placeOf`. */
export declare function nodeState(): StateHost;
/** Where a state key lands on this machine. For tests, and for messages that name a file. */
export declare function statePath(key: string): string;
/**
 * Every `NMTS_*` variable this process is holding.
 *
 * ⛔ THE ONE PLACE THE WHOLE ENVIRONMENT IS READ. `redact.ts` needs the values to label them out of
 *    a report, and a browser has none — so it is a host call rather than a `process.env` walk in a
 *    module that has to run in both.
 */
export declare function nodeEnvEntries(): {
    name: string;
    value: string;
}[];
/** This machine, as the package's host. */
export declare function nodeHost(): Host;
/**
 * Put this machine in the register: what the two Node doors — `index.ts` and the command's own
 * entry point — call before anything that loads the engine, keeps state or reads the environment.
 *
 * ⛔ THE COMMAND LOADS THIS FILE LATE, not at the top of `main.ts`. The chain below reaches the
 *    credentials module, and a fixed cost at the head of `nmts --help` is one an agent running
 *    this tool in a loop pays thousands of times (`check:cli-startup`).
 */
export declare function registerNodeHost(): void;
