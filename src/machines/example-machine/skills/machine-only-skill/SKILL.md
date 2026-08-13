---
name: machine-only-skill
description: Example of a skill that exists on one machine only. Replace or delete it.
---

# Machine only skill

This skill lives in `src/machines/example-machine/skills/`, so it is built only
when the active machine is `example-machine`. Every other machine builds a
`dist/` that does not contain it at all.

Use this for skills that are meaningless elsewhere, such as a deploy procedure
for infrastructure only this machine can reach. A skill placed here that shares
a name with a shared skill replaces it entirely for this machine.
