import { type PushOptions } from "./push.ts";
/** Cut the files into runs of at most one order's parts, in order. */
export declare function batchesOf<T extends {
    size: number;
}>(files: readonly T[], partsOf: (one: T) => number): T[][];
export declare function pushHeavy(target: string, options: PushOptions): Promise<number>;
