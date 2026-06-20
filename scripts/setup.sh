#!/usr/bin/env bash
# End-user setup — installs ai-review-agent and its prerequisites.
# Checks Node.js >=18, verifies Ollama is running, pulls devstral:latest,
# installs ai-review-agent globally via npm, and runs a smoke test.
set -euo pipefail

OLLAMA_MODEL='devstral:latest'   # change to use a different model

echo ""
echo "=== AI Review Agent — User Setup ==="
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
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] Node.js v$NODE_MAJOR found — v18 or higher required."
  echo "        Download: https://nodejs.org"
  exit 1
fi
echo "  Node.js $NODE_VERSION"

# Step 2: Ollama running check
echo "Checking Ollama..."
OLLAMA_RESP=$(curl -sf --max-time 3 http://localhost:11434 2>/dev/null || true)
if [ -z "$OLLAMA_RESP" ]; then
  echo "[ERROR] Ollama is not running on http://localhost:11434."
  echo "        Start Ollama, then re-run this script."
  echo "        Install: https://ollama.com"
  exit 1
fi
if ! echo "$OLLAMA_RESP" | grep -qi 'ollama'; then
  echo "[ERROR] Port 11434 is occupied by a different service."
  echo "        Start Ollama, then re-run this script."
  exit 1
fi
echo "  Ollama running"

# Step 3: Pull model
echo ""
echo "Pulling $OLLAMA_MODEL (may take a few minutes on first run)..."
if ! ollama pull "$OLLAMA_MODEL"; then
  echo "[ERROR] ollama pull failed. Check your internet connection and that Ollama is still running."
  echo "        Retry: ollama pull $OLLAMA_MODEL"
  exit 1
fi

# Step 4: Global install
echo ""
echo "Installing ai-review-agent globally..."
if ! npm install -g ai-review-agent; then
  echo "[ERROR] npm install -g failed."
  echo "        If you see a permissions error, try: sudo npm install -g ai-review-agent"
  echo "        Or use a version manager like nvm to avoid needing sudo."
  exit 1
fi

# Step 5: Smoke test
echo ""
echo "Smoke test..."
if ! command -v ai-review-agent &>/dev/null; then
  echo "[ERROR] ai-review-agent not found in PATH after install."
  echo "        Close and reopen your terminal, then run: ai-review-agent --version"
  exit 1
fi
VERSION=$(ai-review-agent --version 2>&1) || {
  echo "[ERROR] ai-review-agent --version failed."
  exit 1
}
echo "  ai-review-agent $VERSION"

echo ""
echo "Setup complete. Run: ai-review-agent"
echo ""
