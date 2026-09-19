/** Where the pair goes when `--out` names nowhere. Beside whatever the business is running. */
export declare const DEFAULT_KEY_FILE = "nmts-business-key.json";
/** Where a person registers the public half. The one path this command exists to name. */
export declare const REGISTER_PATH = "Settings \u203A Developer \u203A Platform";
export interface PlatformOptions {
    out?: string | undefined;
    write?: ((line: string) => void) | undefined;
}
export declare function platform(sub: string | undefined, options?: PlatformOptions): number;
