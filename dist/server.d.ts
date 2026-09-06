export declare const DEFAULT_SERVER = "https://nmts.me";
export declare const SERVER_ENV_VAR = "NMTS_SERVER";
/**
 * Resolve the server for this run: an explicit argument, then the environment, then the default.
 *
 * ⛔ Refuses anything that is not http(s). A credential is sent to whatever this returns, so a
 *    typo that lands on another scheme must stop here rather than somewhere further in.
 */
export declare function resolveServer(explicit?: string | undefined): string;
