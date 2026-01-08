{
  description = "P7 Borders GNOME Shell extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
      pkgsFor = system: import nixpkgs { inherit system; };
      commonPackagesFor = pkgs: with pkgs; [
        glib
        gnumake
        gnome-shell
        unzip
        zip
      ];
      metadata = builtins.fromJSON (builtins.readFile ./metadata.json);
      uuid = metadata.uuid;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          commonPackages = commonPackagesFor pkgs;
        in
        rec {
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
        });

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          commonPackages = commonPackagesFor pkgs;
        in
        {
          default = pkgs.mkShell {
            packages = commonPackages ++ [ pkgs.biome ];
          };
        });
    };
}
