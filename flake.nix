{
  description = "P7 Borders GNOME Shell extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-45.url = "github:NixOS/nixpkgs/nixos-23.11";
    nixpkgs-46.url = "github:NixOS/nixpkgs/nixos-24.05";
    nixpkgs-47.url = "github:NixOS/nixpkgs/nixos-24.11";
    nixpkgs-48.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgs-49.url = "github:NixOS/nixpkgs/nixos-25.11";
    # Pinned to the last nixos-unstable revision with GNOME 50, so that the
    # gnome-50 shell keeps testing GNOME 50 while unstable moved on to 51.
    nixpkgs-50.url = "github:NixOS/nixpkgs/34ab99075ac4f7e40cf037eef32cb1c360bb85e9";
    nixpkgs-51.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = inputs @ {
    self,
    nixpkgs,
    ...
  }: let
    systems = ["x86_64-linux" "aarch64-linux"];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    pkgsFor = system: import nixpkgs {inherit system;};
    commonPackagesFor = pkgs:
      with pkgs; [
        glib
        gnumake
        gnome-shell
        libadwaita
        unzip
        zip
      ];
    formatterPkgsFor = pkgs:
      with pkgs; [
        treefmt
        alejandra
        biome
        deno
      ];
    metadata = builtins.fromJSON (builtins.readFile ./metadata.json);
    uuid = metadata.uuid;
    versionNixpkgs = {
      "gnome-45" = inputs.nixpkgs-45;
      "gnome-46" = inputs.nixpkgs-46;
      "gnome-47" = inputs.nixpkgs-47;
      "gnome-48" = inputs.nixpkgs-48;
      "gnome-49" = inputs.nixpkgs-49;
      "gnome-50" = inputs.nixpkgs-50;
      "gnome-51" = inputs.nixpkgs-51;
    };
  in {
    packages = forAllSystems (
      system: let
        pkgs = pkgsFor system;
        commonPackages = commonPackagesFor pkgs;
      in rec {
        p7-borders = pkgs.stdenvNoCC.mkDerivation {
          pname = "gnome-shell-extension-p7-borders";
          extensionUuid = uuid;

          version = builtins.toString metadata.version;
          src = ./.;
          nativeBuildInputs = commonPackages;

          buildPhase = ''
            runHook preBuild
            make pack
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            make install DESTDIR=$out
            runHook postInstall
          '';
        };

        default = p7-borders;
      }
    );

    formatter = forAllSystems (system: let
      pkgs = pkgsFor system;
      formatterPkgs = formatterPkgsFor pkgs;
    in
      pkgs.writeShellApplication {
        name = "treefmt";
        runtimeInputs = formatterPkgs;
        text = "treefmt";
      });

    devShells = forAllSystems (system: let
      pkgs = pkgsFor system;
      commonPackages = commonPackagesFor pkgs;
      formatterPkgs = formatterPkgsFor pkgs;
      # GSettings only discovers schemas through XDG_DATA_DIRS. GNOME packages
      # collect their schema directories in GSETTINGS_SCHEMAS_PATH, so expose
      # them there and let tests find the system schemas next to ours.
      schemaPathHook = ''
        if [ -n "''${GSETTINGS_SCHEMAS_PATH:-}" ]; then
          export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
        fi
      '';
      versionShells = nixpkgs.lib.mapAttrs (
        _name: source: let
          versionPkgs = import source {inherit system;};
          gnomeShell = versionPkgs.gnome-shell or versionPkgs.gnome.gnome-shell;
        in
          versionPkgs.mkShell {
            packages = [
              versionPkgs.gjs
              versionPkgs.glib
              versionPkgs.libadwaita
              gnomeShell
            ];
            shellHook = ''
              export GNOME_SHELL_STORE=${gnomeShell}
              export GNOME_SHELL_EXTENSIONS_RESOURCE=${gnomeShell}/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource
              ${schemaPathHook}
            '';
          }
      ) versionNixpkgs;
    in
      versionShells // {
        default = pkgs.mkShell {
          packages = commonPackages ++ formatterPkgs ++ [pkgs.gjs];
          shellHook = ''
            shellGiPath=$(nix-store -qR ${pkgs.gnome-shell} | while IFS= read -r dependency; do
              find "$dependency/lib" -maxdepth 3 -type f -name '*.typelib' -printf '%h\n' 2>/dev/null
            done | sort -u | paste -sd:)
            export GI_TYPELIB_PATH="$shellGiPath"
            export GNOME_SHELL_EXTENSIONS_RESOURCE=${pkgs.gnome-shell}/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource
            ${schemaPathHook}
          '';
        };
      });
  };
}
