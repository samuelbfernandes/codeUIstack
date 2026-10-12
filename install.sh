#!/bin/sh
# Thin launcher: runs the Python installer that sits next to this file. It only looks for Python (3.9+) and starts it.
# Everything it will change is shown first:  sh install.sh --plan
here=$(cd "$(dirname "$0")" && pwd)
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    PYTHONPATH="$here/src${PYTHONPATH:+:$PYTHONPATH}" exec "$py" -m cctk "$@"
  fi
done
echo "Python 3.9 or newer is needed (python3 not found). Install it from https://www.python.org/downloads/ or with conda, then run this again." >&2
exit 1
