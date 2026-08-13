---
name: example-skill
description: Example skill showing how dotagents variables work. Replace it with your own skills.
---

# Example skill

This file lives in `src/skills/example-skill/`. Running `./build.sh` renders it
into `dist/skills/example-skill/`, which is what your agents actually read.

## Variables

Anything written as `{{!UPPER_SNAKE}}` is replaced at build time. The line you
just read shows the raw syntax because it carries a `!` right after the opening
braces, which tells the build to strip the escape and substitute nothing. This
skill uses
one variable, so the line below reads differently depending on the machine you
built it on:

Open pull requests from a branch named `{{BRANCH_PREFIX}}/<description>`.

A variable that resolves to an empty string simply disappears, which is how you
add a machine specific instruction without touching the shared text:

{{REVIEW_EXTRA_INSTRUCTIONS}}

## Rules

A variable with no value anywhere is a build error, not an empty string. That is
deliberate: a typo in a variable name should stop the build rather than silently
drop an instruction your agent was supposed to follow.
