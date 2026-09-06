/**
 * A name not present in `taken`.
 *
 * Returns `desired` untouched when it is free. Otherwise inserts ` (n)` before the extension,
 * starting at 2, until it finds a free one — matching desktop behaviour so nobody has to learn a
 * new convention. `taken` is not mutated; callers uploading several files at once must add each
 * returned name themselves, or a batch of identical names would all resolve to the same `(2)`.
 */
export declare function uniqueFileName(desired: string, taken: ReadonlySet<string>): string;
