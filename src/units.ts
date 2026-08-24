// Numbers as a person reads them.
//
// WHY A MODULE FOR ONE FUNCTION. It began inside `ls`, and the second command that had to print a
// size would have copied it — after which one table says "1.2 MB" and the other says "1.15 MiB"
// for the same file, and nobody can tell which of the two is what the account is charged for.
// Decimal units, because that is the unit storage is sold in.

/** Bytes as a person reads them: 1 kB is 1,000 bytes, the way the storage is priced. */
export function humanSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
