set -euo pipefail

archive="dist/p7-borders@prasannavl.com.shell-extension.zip"
expected_files=$(printf '%s\n' \
  CHANGELOG.md \
  README.md \
  appconfig.js \
  bordermanager.js \
  borderstate.js \
  compat.js \
  config.js \
  extension.js \
  metadata.json \
	prefs.js \
	prefsconfig.js \
  schemas/ \
  schemas/org.gnome.shell.extensions.p7-borders.gschema.xml \
	windowtracking.js | LC_ALL=C sort)
actual_files=$(unzip -Z1 "$archive" | LC_ALL=C sort)

if [[ "$actual_files" != "$expected_files" ]]; then
  diff -u <(printf '%s\n' "$expected_files") <(printf '%s\n' "$actual_files")
  exit 1
fi

if ! cmp -s metadata.json <(unzip -p "$archive" metadata.json); then
  echo "packaged metadata.json differs from the source" >&2
  exit 1
fi

echo "ok - package contains exactly the runtime files and current metadata"
