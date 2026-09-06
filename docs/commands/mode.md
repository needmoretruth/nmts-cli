# nmts mode — how much an agent may decide without asking

Commands: mode
Tiers: mode=none

Every act this tool performs has a tier — none, low, medium, high, ultra-high — and the mode says
what each tier meets:

| | default | auto-low | auto-high | skip-permissions |
|---|---|---|---|---|
| none | runs | runs | runs | runs |
| low | asks | runs | runs | runs |
| medium | asks | your judgement | your judgement | runs |
| high | unlock, then asks | unlock, then asks | unlock, then asks | runs |
| ultra-high | a person types | refused | refused | `--reason` and `--yes` |

"Asks" means: at a terminal, a y/N question; with no terminal, exit 5 and the sentence to run again
with `--yes` after the person has said so. "Your judgement" means the code does not block: in an
auto mode you decide whether this is what the person wants, and auto-high is the mode where they
asked you to think further ahead than auto-low. "Unlock" is `nmts unlock <key>`, a person's act at
a terminal (`nmts help unlock`). Under skip-permissions nothing asks and nothing is locked; an
ultra-high act still wants a `--reason`, which is where you say why it is right.

Switching is a person's act: `nmts mode auto-low` at a terminal (the auto modes ask y/N, skip-
permissions asks for a typed sentence); `nmts mode default` turns it off; `nmts mode explain
<mode>` prints what a mode does, its risk and its gain, and `nmts mode` prints which one is on.
Every other command announces an active mode on stderr. Do not switch a mode, and do not tell the
person to switch one so that you can finish a task; you may recommend one when it fits, with the
explanation, and let them decide.
