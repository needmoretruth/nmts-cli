// `nmts usage` — how much this account is holding, added up from the sealed file list.
//
// ⚠ IT ANSWERS FROM THE LIST, LIKE `ls`. The list is what every device reads to know what exists,
//   so its counts are the account's counts. It still proves nothing about whether the bytes behind
//   any one entry are fetchable, and it is not a bill: the storage network holds more bytes than
//   the files contain, and what was paid for is a chain fact this command never reads.
//
// ⛔ THE TRASH GETS ITS OWN LINE AND IS NOT IN THE TOTAL. "I deleted 4 GB and nothing changed" and
//    "I deleted 4 GB and it is gone" are both wrong, and one number cannot say the true thing,
//    which is that the bytes are out of the drive and still stored. So there are two numbers, and
//    the trash one carries the two commands that act on it.
//
// ⛔ IT IS ITS OWN COMMAND RATHER THAN A LINE UNDER `ls`. `ls` prints a table whose length is the
//    drive's, and an agent that only wants "am I near my limit" would have to fetch and parse all
//    of it. This answers that in one small object, and both read the same list the same way.

import { buildIndex } from "../drive-paths.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { humanSize } from "../units.ts";
import { computeUsage, type UsageReport } from "../usage-report.ts";

export interface UsageOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Machine-readable output. For an agent this is the shape to parse; the table is for a person. */
  json?: boolean;
  write?: (line: string) => void;
}

/** An account that has never been written to. Nothing is unknown here — nothing was uploaded. */
const NOTHING: UsageReport = {
  files: 0,
  folders: 0,
  bytes: 0,
  trashedFiles: 0,
  trashedBytes: 0,
  biggest: [],
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function usage(options: UsageOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const session = await openSession({ server: options.server, network: options.network });
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);

  if (list.manifest === null) {
    // ⛔ ZEROS, NOT A MISSING FIELD. An agent asking how much the account holds gets an answer it
    //    can compare against a number; making it special-case an absent shape is how "no list yet"
    //    turns into an unhandled branch on somebody's first run.
    if (options.json) {
      say(JSON.stringify({ state: "absent", ...NOTHING }));
      return 0;
    }
    say(`This account has no file list yet. Nothing has been uploaded from any device.`);
    return 0;
  }

  const report = computeUsage(buildIndex(list.manifest.entries));

  if (options.json) {
    say(JSON.stringify({ state: "present", seq: list.seq, ...report }));
    return 0;
  }

  if (report.files === 0 && report.folders === 0 && report.trashedFiles === 0) {
    say(`This account's file list is empty.`);
    return 0;
  }

  say(
    `${plural(report.files, "file", "files")} · ` +
      `${plural(report.folders, "folder", "folders")} · ` +
      `${humanSize(report.bytes)}`,
  );

  if (report.biggest.length > 0) {
    say(``);
    say(`Largest`);
    for (const file of report.biggest) {
      say(`  ${humanSize(file.size).padStart(9)}  ${file.path}`);
    }
  }

  say(``);
  if (report.trashedFiles === 0) {
    say(`Nothing is in the trash.`);
  } else {
    say(
      `In the trash: ${plural(report.trashedFiles, "file", "files")} · ` +
        `${humanSize(report.trashedBytes)}. That is still stored and still paid for, and it is not`,
    );
    say(
      `counted above. \`${BINARY_NAME} ls --all\` lists it; \`${BINARY_NAME} sweep\` drops the ` +
        `entries whose 30 days have run out.`,
    );
  }

  say(``);
  say(`  Sizes are the plaintext the files hold, counted from this account's own list — the server`);
  say(`  was asked for nothing but the sealed blob, and it could not have answered this anyway.`);
  say(`  What the storage network holds is larger: sealing adds bytes, and storage is bought in`);
  say(`  fixed units. This is not what the account was charged.`);
  return 0;
}
