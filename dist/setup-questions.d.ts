/**
 * The one question setup asks about uploads.
 *
 * ⛔ CALL THIS OUTSIDE `holdTerminal`. Inside it the terminal is in raw mode, where a line prompt
 *    never sees a line.
 */
export declare function askAboutCollisions(say: (line: string) => void): Promise<void>;
