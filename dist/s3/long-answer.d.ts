import type { Call } from "./call.ts";
/** How often a space is written while the store runs: well inside the 60 seconds botocore waits. */
export declare const KEEP_ALIVE_MS = 10000;
/**
 * Run `work` and answer with the XML it resolves to -- or, when `work` has called `accepted` and is
 * still running one keep-alive interval later, begin the 200 then and keep the client hearing
 * something while the rest runs.
 *
 * A `work` that settles before that is answered as though it had never called `accepted`: its
 * result with 200, its throw with its own status.
 */
export declare function answerAfter(call: Call, work: (accepted: () => void) => Promise<string>): Promise<void>;
