/**
 * Hold the terminal in raw mode across a RUN of prompts.
 *
 * ⛔ WITHOUT THIS, THE GAP BETWEEN TWO PROMPTS ECHOES. `promptSecret` sets raw mode for its own
 *    question and restores it afterwards, which was right while this tool asked one thing. `login`
 *    now asks three in a row with work in between (the code is checked before a passphrase is
 *    asked for), and in that gap the terminal is back in line mode: it echoes what is typed, and
 *    its line discipline holds whole lines that the next prompt then never sees. Measured through
 *    a pty: a paste of code + passphrase + confirmation ended in "Cancelled" with both
 *    passphrases printed on the screen.
 *
 * ⚠ Restoring is what the `finally` is for, including on a throw — a process that exits leaving a
 *   terminal in raw mode leaves the person's shell unusable.
 */
export declare function holdTerminal<T>(body: () => Promise<T>): Promise<T>;
export declare function stdinIsATerminal(): boolean;
/** Ask for a secret on the terminal, echoing nothing. Ctrl-C and Ctrl-D abandon the prompt. */
export declare function promptSecret(question: string, envVar: string): Promise<string>;
/**
 * Ask a question whose answer is not a secret, and echo what is typed.
 *
 * ⛔ NOT FOR SECRETS. `promptSecret` exists for those: it turns echo off and wipes what it read.
 *    This one is for a choice, where seeing what you typed is the point.
 *
 * ⛔ IT MUST NOT BE CALLED INSIDE `holdTerminal`. That puts the terminal in raw mode, where
 *    readline gets characters one at a time and no line ever arrives.
 *
 * ⚠ Returns the empty string when there is no terminal, so callers can treat "nobody was there"
 *   as "nothing was chosen" rather than as an answer. A setup script must not hang here.
 */
export declare function promptLine(question: string): Promise<string>;
