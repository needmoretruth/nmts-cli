import { type Autonomy } from "./autonomy.ts";
import type { ParsedArgs } from "./args.ts";
import { CONSENTS } from "./consent.ts";
import { type ActId } from "./risk.ts";
export interface GateIo {
    write?: ((line: string) => void) | undefined;
    /** Injected in tests: answers the y/N. Its presence stands in for a terminal. */
    readLine?: ((question: string) => Promise<string>) | undefined;
    now?: (() => Date) | undefined;
}
export interface Passage {
    /** The command must still get a yes in its own words — a review and --yes, a typed sentence. */
    ask: boolean;
    mode: Autonomy;
}
/** Whether the unlock behind an act is open right now. */
export declare function unlocked(key: keyof typeof CONSENTS, now: Date): Promise<boolean>;
export declare function gate(act: ActId, args: ParsedArgs, io?: GateIo): Promise<Passage>;
