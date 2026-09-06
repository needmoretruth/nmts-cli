/**
 * Make this program able to write and read compression flag 0x02. Safe to call more than once.
 *
 * ⛔ CALLED FROM THE FILE-LIST FLOW RATHER THAN FROM THE ENTRY POINT, and that is deliberate: the
 *    package is a library and an MCP server as well as a command, and a list opened through any of
 *    those doors has to be able to expand a zstd frame the browser wrote. Putting it here also
 *    means `nmts --help` never loads it.
 */
export declare function registerNodeZstd(): void;
/** For tests that need this process to look like a build with no encoder. */
export declare function forgetNodeZstd(): void;
