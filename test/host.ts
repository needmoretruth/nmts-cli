// Every test runs with the Node host in the register — loaded through `--import`, before any test
// file's own imports.
//
// ⛔ THE REGISTER IS PROCESS-WIDE AND SO IS THIS. Most test files import one module directly rather
//    than the package's entry point, which is what makes them fast and what means they never go
//    through the line in `index.ts` that puts the host there. Registering it in each of them would
//    be a hundred copies of one fact; `node --test` passes its own `--import` on to the worker it
//    runs each file in, so one line here covers all of them.
//
// ⚠ IT IS THE REAL NODE HOST, not a fake. What the tests keep is a real config directory under
//   `NMTS_CONFIG_DIR`, exactly as before the host existed, so nothing about what they prove moved.

import { registerNodeHost } from "../src/host-node.ts";

registerNodeHost();
