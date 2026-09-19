import type { Host } from "./host.ts";
/**
 * Put a host's state through everything the package relies on, and say what it got wrong.
 *
 * An empty array is a pass.
 */
export declare function hostContract(host: Host): Promise<string[]>;
