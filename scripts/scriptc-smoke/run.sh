#!/usr/bin/env bash
# Builds each consumer program with scriptc, runs the native binary, and diffs
# its stdout against the same program under Bun (the oracle). Exit 1 on any
# build error, non-zero run, or output mismatch.
# Usage: SCRIPTC=/path/to/scriptc scripts/scriptc-smoke/run.sh
set -u
cd "$(dirname "$0")"
SCRIPTC="${SCRIPTC:-scriptc}"
out="$(mktemp -d)"
fail=0
for src in *.ts; do
  name="${src%.ts}"
  if ! "$SCRIPTC" build "$src" -o "$out/$name" >"$out/$name.build" 2>&1; then
    echo "FAIL build $src"; cat "$out/$name.build"; fail=1; continue
  fi
  if ! "$out/$name" >"$out/$name.native" 2>&1; then
    echo "FAIL run $src"; cat "$out/$name.native"; fail=1; continue
  fi
  bun "$src" >"$out/$name.bun" 2>&1
  if ! diff -u "$out/$name.bun" "$out/$name.native"; then
    echo "FAIL output $src (bun vs native)"; fail=1; continue
  fi
  echo "ok $src"
done
exit $fail
