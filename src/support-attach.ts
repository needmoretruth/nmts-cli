// Turning the run log into the text that travels with a report.
//
// ⛔ IT IS FOR A PERSON TO READ, NOT FOR A MACHINE TO PARSE. The log on disk is JSON because it is
//    appended to and trimmed; what goes into a report is a transcript, because the thing that
//    makes a report useful is somebody being able to see the sequence at a glance.
//
// ⛔ THE CAP DROPS WHOLE RUNS, OLDEST FIRST. Cutting the text at a byte offset would end the
//    attachment in the middle of the one run that matters — the newest one, which is the one the
//    report is about — and a half line is worse than an honest count of what was left out.

import type { RunRecord } from "./run-log.ts";

/** What one attachment turned out to be. */
export interface LogAttachment {
  /** The text, oldest run first. Empty when there was nothing to attach. */
  readonly text: string;
  /** How many runs are in it. */
  readonly runs: number;
  /** How many were left out to fit the cap. */
  readonly dropped: number;
  /** What it weighs on the wire. */
  readonly bytes: number;
}

/** The server's ceiling on the log field. `api/src/routes/support.rs` is the origin. */
export const MAX_ATTACHMENT_BYTES = 32 * 1024;

/** Room held back for the "older runs left out" line and the blank line above it. */
const NOTICE_RESERVE = 48;

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** One run, as a person reads it. */
export function formatRun(record: RunRecord): string {
  const lines = [
    `${record.t} v${record.v} exit ${record.exit} in ${record.ms}ms`,
    `$ nmts ${[record.cmd, ...record.args].join(" ")}`.trimEnd(),
  ];
  for (const event of record.events) {
    if (event.kind === "http") {
      const tail = event.error === undefined ? "" : ` ${event.error}`;
      lines.push(`  ${event.method} ${event.path} → ${event.status}${tail}`);
    } else {
      lines.push(`  ! ${event.message}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the attachment.
 *
 * `clean` is the caller's redaction — it runs over each run's own text rather than over the
 * finished attachment, so that a value replaced by a longer label cannot push the result back over
 * the cap after it has been measured.
 */
export function buildLogAttachment(
  records: readonly RunRecord[],
  clean: (text: string) => string,
  limit = MAX_ATTACHMENT_BYTES,
): LogAttachment {
  const blocks = records.map((record) => clean(formatRun(record)));
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  // Newest first while packing, because the newest run is the one the report is about.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined) continue;
    // Every run but the first costs a blank line between it and the one before.
    const cost = bytes(block) + (kept.length === 0 ? 0 : 2);
    // ⛔ ROOM FOR THE NOTICE IS HELD BACK WHILE OLDER RUNS REMAIN, not added afterwards. An
    //    attachment that filled the cap and then said "3 runs left out" would be over it, and the
    //    server would refuse the whole message rather than the sentence.
    const reserve = i === 0 ? 0 : NOTICE_RESERVE;
    if (used + cost + reserve > limit) {
      dropped = i + 1;
      break;
    }
    used += cost;
    kept.unshift(block);
  }
  const parts = kept.length === 0 ? [] : [kept.join("\n\n")];
  if (dropped > 0) parts.unshift(noticeLine(dropped));
  const text = parts.join("\n\n");
  return { text, runs: kept.length, dropped, bytes: bytes(text) };
}

function noticeLine(dropped: number): string {
  return `(${dropped} older ${dropped === 1 ? "run" : "runs"} left out to fit.)`;
}
