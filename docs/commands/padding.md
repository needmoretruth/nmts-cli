# nmts padding — how file sizes are hidden

Commands: padding
Tiers: padding=none · padding.set=low

A stored file's size is public on the storage network no matter what; padding is how coarsely it
is rounded up before sealing. `standard` allows a few dozen sizes per doubling for about one
percent more storage; `pow2` allows one per doubling, hides more, and costs more on average. The
setting lives in the sealed file list, so it follows the account to every device and the server
never learns it. Reading costs a list read; setting costs a list write, is a low act (asked once
in the default mode, run in an auto mode), and applies to what is uploaded next — bytes already on
the network are not re-padded.
