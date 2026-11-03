import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { configureExtension, extensionConfig } from "./configure-extension.mjs";

test("defaults to localhost and normalizes a custom origin", () => {
  assert.equal(extensionConfig().origin, "http://localhost:3000");
  const config = extensionConfig("https://EXAMPLE.com:8443/");
  const context = vm.createContext({});
  vm.runInContext(config.script, context);
  assert.equal(context.SEEM_BOX_EXTENSION_URL, "https://example.com:8443");
  assert.equal(config.permission, "https://example.com/*");
});

test("rejects invalid origins and URLs containing credentials or paths", () => {
  for (const url of ["", "localhost:3000", "ftp://example.com", "https://user:secret@example.com", "https://example.com/api", "https://example.com/?secret=abc", "https://example.com/#fragment", "https://*.example.com"]) {
    assert.throws(() => extensionConfig(url), /SEEM_BOX_EXTENSION_URL/);
  }
});

test("applies env precedence and changes permissions without exposing secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "seem-box-extension-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}/`);
  await mkdir(new URL("extension/", root));
  await writeFile(new URL("extension/manifest.json", root), JSON.stringify({
    name: "Test extension", host_permissions: ["https://old.example/*"], permissions: ["storage"],
  }));
  await writeFile(new URL(".env", root), "SEEM_BOX_EXTENSION_URL=https://base.example\n");
  await writeFile(new URL(".env.local", root), 'SEEM_BOX_EXTENSION_URL="https://local.example:8443/"\nSEEM_BOX_EXTENSION_TOKEN=private-token\n');
  assert.equal(await configureExtension(root, {}), "https://local.example:8443");
  assert.equal(await configureExtension(root, { SEEM_BOX_EXTENSION_URL: "http://localhost:4000" }), "http://localhost:4000");
  const manifest = JSON.parse(await readFile(new URL("extension/manifest.json", root), "utf8"));
  assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*", "http://localhost/*"]);
  assert.deepEqual(manifest.permissions, ["storage"]);
  const script = await readFile(new URL("extension/config.js", root), "utf8");
  assert.ok(script.includes("http://localhost:4000"));
  assert.ok(!script.includes("private-token"));
  await assert.rejects(configureExtension(root, { SEEM_BOX_EXTENSION_URL: "broken" }));
  assert.equal(await readFile(new URL("extension/config.js", root), "utf8"), script);
});
