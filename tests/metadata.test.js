import { assertEquals } from "./assert.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const metadata = JSON.parse(await Deno.readTextFile("metadata.json"));
const schema = await Deno.readTextFile(
  "schemas/org.gnome.shell.extensions.p7-borders.gschema.xml",
);

Deno.test("metadata declares the supported Shell versions", () => {
  assertEquals(metadata["shell-version"], ["45", "46", "47", "48", "49", "50"]);
});

Deno.test("metadata and schema identify the same extension", () => {
  assertEquals(metadata.uuid, "p7-borders@prasannavl.com");
  assert(
    schema.includes(`id="${metadata["settings-schema"]}"`),
    "settings-schema is missing from the schema XML",
  );
});

Deno.test("schema contains only current app config storage", () => {
  assert(
    schema.includes('name="rules"'),
    "rules key missing",
  );
  assert(!schema.includes('name="app-configs"'), "obsolete config key remains");
  assert(
    schema.includes('name="use-shipped-configs"'),
    "shipped config mode missing",
  );
  assert(schema.includes('name="schema-version"'), "schema version missing");
  assert(!schema.includes('name="config-version"'), "old version key remains");
});

Deno.test("current release has a dated changelog entry", async () => {
  const changelog = await Deno.readTextFile("CHANGELOG.md");
  const heading = new RegExp(
    `^## \\[${metadata.version}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  );
  assert(
    heading.test(changelog),
    `version ${metadata.version} is not documented`,
  );
});

Deno.test("all relative runtime imports resolve", async () => {
  const root = new URL("../", import.meta.url);
  const entrypoints = [
    "extension.js",
    "prefs.js",
    "common/appconfig.js",
    "common/border.js",
    "common/config.js",
    "shell/bordermanager.js",
    "shell/compat.js",
    "shell/windowtracking.js",
    "prefs/config.js",
    "prefs/ui.js",
  ];
  for (const entrypoint of entrypoints) {
    const entrypointUrl = new URL(entrypoint, root);
    const source = await Deno.readTextFile(entrypointUrl);
    for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const imported = new URL(match[1], entrypointUrl);
      try {
        await Deno.stat(imported);
      } catch {
        throw new Error(`${entrypoint} imports missing ${match[1]}`);
      }
    }
  }
});
