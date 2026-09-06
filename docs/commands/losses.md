# nmts losses — storage the daily check could not find

Commands: losses
Tiers: losses=none · losses.dismiss=medium

Lists storage objects paid with this account's credits that NMTS's daily check could not find on
the chain, newest first: a public chain object id and the day a check first missed it, no file
name, because the server cannot pair them. `--recheck <id>` asks the chain again now. Both only
read.

`--dismiss <id>` puts a line down for good, which is somebody saying "I have read this". In the
default mode it asks first (or takes `--yes`); in an auto mode it is your judgement, and the safe
judgement is to show the person the line rather than dismiss it for them.
