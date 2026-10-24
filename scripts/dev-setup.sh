#!/usr/bin/env bash
# Contributor setup — wires up a cloned repo for local development.
# Checks Node.js >=20.18.1, verifies repo root, runs npm install + build + link,
# and runs a smoke test. No Ollama steps — unit tests run without Ollama.
set -euo pipefail

echo ""
echo "=== AI Review Agent — Contributor Setup ==="
echo ""

# Step 1: Node.js check
echo "Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found."
  echo "        Download: https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node --version 2>&1 | grep -E 'v[0-9]+\.' | tail -1)
if [ -z "$NODE_VERSION" ]; then
  echo "[ERROR] Could not determine Node.js version."
  echo "        Download: https://nodejs.org"
  exit 1
fi
# 20.18.1 is the floor of the undici dependency, so compare the whole version, not the major.
IFS=. read -r NODE_MAJOR NODE_MINOR NODE_PATCH <<<"${NODE_VERSION#v}"
NODE_PATCH=${NODE_PATCH%%[!0-9]*}
if [ $((NODE_MAJOR * 1000000 + NODE_MINOR * 1000 + NODE_PATCH)) -lt 20018001 ]; then
  echo "[ERROR] Node.js $NODE_VERSION found — v20.18.1 or higher required."
  echo "        Download: https://nodejs.org"
  exit 1
fi
echo "  Node.js $NODE_VERSION"

# Step 2: Verify repo root
echo "Checking repo root..."
if [ ! -f package.json ]; then
  echo "[ERROR] package.json not found."
  echo "        Run this script from the repo root directory."
  exit 1
fi
echo "  Repo root confirmed"

# Step 3: npm install
echo ""
echo "Installing dependencies..."
if ! npm install; then
  echo "[ERROR] npm install failed."
  exit 1
fi

# Step 4: Build
echo ""
echo "Building..."
if ! npm run build; then
  echo "[ERROR] Build failed — fix TypeScript errors above."
  exit 1
fi

# Step 5: npm link
echo ""
echo "Linking..."
if ! npm link; then
  echo "[ERROR] npm link failed."
  echo "        If you see a permissions error, try: sudo npm link"
  echo "        Or use a version manager like nvm to avoid needing sudo."
  exit 1
fi

# Step 6: Smoke test
echo ""
echo "Smoke test..."
if ! command -v ai-review-agent &>/dev/null; then
  echo "[ERROR] ai-review-agent not found in PATH after link."
  echo "        Close and reopen your terminal, then run: ai-review-agent --version"
  exit 1
fi
VERSION=$(ai-review-agent --version 2>&1) || {
  echo "[ERROR] ai-review-agent --version failed."
  exit 1
}
echo "  ai-review-agent $VERSION"

echo ""
echo "Dev setup complete. Run: npm test"
echo ""
