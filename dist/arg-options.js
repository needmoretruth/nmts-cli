// What a command line can say — every option this tool accepts, in one place.
//
// ⛔ THE FIELDS ARE THE VOCABULARY, and the parser beside them (`args.ts`) is the only thing that
//    fills them. They moved out of that file on 2026-09-16 because the two are different jobs and
//    the parser's file had a ceiling: this is what the options MEAN, that is how a line is read.
//
// ⛔ NO SECRET IS EVER AN OPTION. There is no --code and no --api-key: on Linux any process can
//    read another's command line, and the shell records it. A test asserts no option name looks
//    like one.
export {};
