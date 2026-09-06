# nmts logout — remove the stored credentials

Commands: logout
Tiers: logout=none

Removes the NMTS key and API key this tool stored on this machine. Nothing on the server
changes: the key stays valid until revoked (`nmts key revoke`, or the account screen), and the
account is untouched. A code that came from an environment variable or a file is not touched
either — this only forgets what `nmts login` wrote.

Run it when a machine is handed over or a task is finished on a machine the person does not keep.
