// This process's own stderr, as a progress reporter.
//
// ⛔ STDERR, NOT STDOUT. Progress is not the answer, and a caller redirecting the answer to a file
//    must not find it interleaved with percentages.
//
// ⛔ SEPARATE FROM `progress.ts` SO THE REPORTER RUNS IN A BROWSER. Everything about how often to
//    print and what a pipe gets instead of a rewriting line is the same wherever the text goes;
//    only this one destination is Node's.

import type { ProgressSink } from "./progress.ts";

export function stderrSink(): ProgressSink {
  return {
    write: (text) => void process.stderr.write(text),
    interactive: process.stderr.isTTY === true,
  };
}
