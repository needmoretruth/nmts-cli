import type { ParsedArgs } from "../args.ts";
interface HeavyIo {
    write?: ((line: string) => void) | undefined;
    now?: number;
}
export declare function heavy(verb: string | undefined, args: ParsedArgs, io?: HeavyIo): Promise<number>;
export {};
