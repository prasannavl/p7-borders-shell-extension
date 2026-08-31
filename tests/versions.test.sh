set -euo pipefail

releases=(
  nixos-23.11
  nixos-24.05
  nixos-24.11
  nixos-25.05
  nixos-25.11
  nixos-unstable
)

for release in "${releases[@]}"; do
  expression="
    let
      pkgs = (builtins.getFlake \"github:NixOS/nixpkgs/$release\").legacyPackages.\${builtins.currentSystem};
      gnomeShell = pkgs.gnome-shell or pkgs.gnome.gnome-shell;
    in pkgs.mkShell {
      packages = [ pkgs.gjs pkgs.glib pkgs.libadwaita gnomeShell ];
      shellHook = \"export GNOME_SHELL_STORE=\${gnomeShell}; export GNOME_SHELL_EXTENSIONS_RESOURCE=\${gnomeShell}/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource\";
    }
  "

  nix --quiet develop --impure --expr "$expression" --command bash -c '
    set -euo pipefail
    unset GIO_EXTRA_MODULES
    shell_gi_path=$(nix-store -qR "$GNOME_SHELL_STORE" | while IFS= read -r dependency; do
      find "$dependency/lib" -maxdepth 3 -type f -name "*.typelib" -printf "%h\\n" 2>/dev/null
    done | sort -u | paste -sd:)
    export GI_TYPELIB_PATH="$shell_gi_path"

    run_test() {
      label="$1"
      shift
      if output=$("$@" 2>&1); then
        echo "ok - $label"
      else
        echo "FAIL - $label"
        echo "$output"
        exit 1
      fi
    }

    run_output_test() {
      label="$1"
      expected="$2"
      shift 2
      output=$("$@" 2>&1) || true
      if grep -Fq "$expected" <<<"$output"; then
        echo "ok - $label"
      else
        echo "FAIL - $label"
        echo "$output"
        exit 1
      fi
    }

    gnome-shell --version
    gjs --version
    glib-compile-schemas schemas
    run_test compat gjs -m tests/compat.test.js
    run_test windowtracking gjs -m tests/windowtracking.test.js
    run_test settings env \
      GSETTINGS_SCHEMA_DIR="$PWD/schemas" \
      GSETTINGS_BACKEND=memory \
      gjs -m tests/settings.test.js
    run_test prefs-store env \
      GSETTINGS_SCHEMA_DIR="$PWD/schemas" \
      GSETTINGS_BACKEND=memory \
      gjs -m tests/prefsconfig.test.js
    run_output_test prefs-module "preferences module loaded" \
      gjs -m tests/prefs-module.test.js
  '
done
