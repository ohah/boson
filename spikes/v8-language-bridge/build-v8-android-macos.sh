#!/usr/bin/env bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$repo_root/tools/v8/build-android-macos.sh"
