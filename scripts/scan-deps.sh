#!/usr/bin/env bash
# The hard rule in AGENTS.md, in one place. Firebase, Google tracking and cloud-AI tooling stay
# out of the app, and so do Google Fonts and any vendor sign-in. Sign-in is the operator's own OIDC
# issuer, a password or a magic link; the app ships no identity provider.
#
# This script names the forbidden things, so it excludes itself. README, AGENTS and the task
# backlog quote the rule by name; docs/ may name the identity providers an operator can connect.
set -u
cd "$(dirname "$0")/.." || exit 1
if grep -rinE 'firebase|firestore|gcloud|gemini|vertexai|vertex-ai|aiplatform|generativelanguage|googletagmanager|google-analytics|gtag/js|fonts\.googleapis\.com|fonts\.gstatic\.com' . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.taskmaster \
  --exclude=README.md --exclude=AGENTS.md --exclude=scan-deps.sh --exclude='*.log'; then
  echo "Found a forbidden dependency. See the hard rule in AGENTS.md." >&2
  exit 1
fi
echo "No forbidden dependencies."
