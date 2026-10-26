// Example hook, to replace with your own. Claude Code and Codex run it right
// before the agent asks the user a question, and pass it the hook input as JSON
// on stdin. Exiting without output lets the question through.

import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
