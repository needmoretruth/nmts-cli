import type { ParsedArgs } from "../args.ts";
export interface KeyManageOptions {
    server?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** Injected in tests: answers the tier gate's y/N. */
    readLine?: ((question: string) => Promise<string>) | undefined;
}
export declare function keyList(options?: KeyManageOptions): Promise<number>;
/** `nmts key revoke <id|all>`: the refusals, the tier gate's question, then the proof and the cut. */
export declare function keyRevoke(target: string | undefined, args: ParsedArgs, options?: KeyManageOptions): Promise<number>;
