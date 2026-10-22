#!/usr/bin/env bash
# The boundary, enforced rather than remembered.
#
# `server/` is the application: it has to compile and run on a machine that has never heard of
# Cloudflare. A binding that leaked into it would work on the deployed Worker and fail on every
# self-hosted instance, which is the one failure this architecture exists to prevent.
set -euo pipefail

if grep -rnE 'cloudflare:|D1Database|env\.ASSETS|cf-connecting-ip' server/ ; then
  echo
  echo "A Cloudflare binding has appeared in server/, which must run without Cloudflare."
  echo "Entries and their bindings belong in worker/ or server/index.node.ts."
  exit 1
fi

echo "server/ is portable."
