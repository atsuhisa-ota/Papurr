#!/bin/sh
# Double-click this file on a Mac to register the Papurr helper (needed once for "External PDF app").
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 || echo /usr/bin/python3)
"$PY" install.py
echo
echo "Done. Restart Chrome, then press Test in Papurr's Settings."
echo "You can close this window."
