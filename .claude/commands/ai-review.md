---
description: Run a deep 11-agent local AI code review on the current diff using Ollama (devstral:latest). Reviews security, correctness, performance, design, dependencies, breaking changes, license compliance, adversarial patterns, integration risks, and coverage. Fully offline.
allowed-tools:
  - Bash(ai-review *)
  - Bash(node dist/cli/index.js *)
  - Bash(npm run build)
  - Bash(git diff *)
  - Bash(git status *)
  - Bash(ollama list)
  - Bash(ollama serve *)
---

# /ai-review

Run the 11-agent local AI code review swarm against the current working diff using Ollama.

**When to use:**
- Before committing or opening a PR — thorough, multi-domain review
- When you want a fully offline review with no cloud API calls
- Use `/code-review` instead for a fast Claude-native check mid-session

**Prerequisites:** Ollama must be running (`ollama serve`) with `devstral:latest` pulled.

## Usage

```
/ai-review                                        # reviews staged diff (falls back to unstaged)
/ai-review --agents security,correctness          # specific agents only
/ai-review --model qwen3:latest                   # override the model
/ai-review --diff path/to/changes.diff            # review a saved diff file
/ai-review --dir /path/to/repo                    # diff a directory against HEAD
/ai-review --format json                          # JSON output
/ai-review --no-sanitize                          # skip prompt injection sanitization
/ai-review --ignore "dist/**"                     # exclude files by glob (repeatable)
/ai-review --max-lines 500                        # limit diff size
/ai-review --fail-on critical                     # only fail CI on critical findings
```

## Instructions for Claude

1. **Check Ollama is running.** Run:

   ```bash
   ollama list
   ```

   If this fails or returns an error, tell the user: "Ollama does not appear to be running. Start it with `ollama serve` and then re-run `/ai-review`." Stop here.

2. **Build if needed.** If `dist/cli/index.js` doesn't exist, run:

   ```bash
   npm run build
   ```

3. **Run the review.** Execute with the arguments the user provided (or defaults):

   ```bash
   ai-review --format markdown
   ```

   If `ai-review` is not installed globally, use:

   ```bash
   node dist/cli/index.js --format markdown
   ```

   Pass through any flags the user specified (`--agents`, `--model`, `--diff`, `--dir`, `--ignore`, `--max-lines`, `--no-sanitize`, etc.).

4. **Stream the output** directly into the conversation.

5. **After displaying findings**, ask: "Would you like me to address any of these findings?"

If the diff is empty, say so and stop — don't run the swarm against nothing.
