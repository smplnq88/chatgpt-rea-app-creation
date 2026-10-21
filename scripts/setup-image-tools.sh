#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -d /workspace ]]; then
  default_tools_dir=/workspace/rea-image-tools
else
  default_tools_dir="$project_dir/.cache/image-tools"
fi
tools_dir="${IMAGE_TOOLS_HOME:-$default_tools_dir}"
python3 -m venv "$tools_dir"
"$tools_dir/bin/python" -m pip --cache-dir "$project_dir/.cache/pip" install -r "$project_dir/server/requirements-image.lock"
U2NET_HOME="$tools_dir/models" OMP_NUM_THREADS=2 "$tools_dir/bin/python" - <<'PY'
from rembg import new_session
import cv2
# rembg/pooch downloads from its official release and verifies its expected hash.
new_session('u2netp', providers=['CPUExecutionProvider'])
print('AI background removal and natural erasing are ready.')
PY
