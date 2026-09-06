# nmts on-collision — a name already in use

Commands: on-collision
Tiers: on-collision=none · on-collision.set=low

Reads or sets what an upload does when its name is already taken in the destination folder:
`rename` numbers the new file (`report (2).pdf`) and leaves what is there alone; `overwrite` puts
the old file in the trash, where `nmts restore` brings it back for thirty days. The default is
`rename`. Setting it is a low act: asked once in the default mode, run in an auto mode.

`put --on-collision overwrite` asks for the other answer for one run, and only takes effect while a
mode is on; in the default mode the upload is renamed and says so, because displacing somebody's
file is not a decision an agent makes alone.
