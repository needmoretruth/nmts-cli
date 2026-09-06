# nmts mkdir, mv, rename — folders and names

Commands: mkdir, mv, rename
Tiers: mkdir=none · mv=none · rename=none

Free, instant, reversible, and none of them stops to ask. `mkdir <path>` makes a folder and any
missing folder above it. `mv <paths> <folder>` moves things into a folder; `/` is the top of the
drive. `rename <path> <name>` gives one thing a new name and refuses a name already used in that
folder rather than numbering it. Paths are matched whole, and a path matching two entries is
refused (exit 4).
