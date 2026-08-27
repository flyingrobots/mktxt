import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");


test("--version reports the package version without creating outputs", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli(["--version"], undefined, fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "mktxt 5.2.0");
  assert.deepEqual((await fs.readdir(fixture)).sort(), ["nested", "omitted.txt", "one.ts"]);
});

test("--files-from packages exactly the listed files in manifest order", async (t) => {
  const fixture = await createFixture(t);
  const formats = new Map([
    ["paths.txt", "nested/two.md\none.ts\nnested/two.md\n"],
    ["paths.json", '["nested/two.md", "one.ts", "nested/two.md"]'],
    ["paths.jsonl", '{"path":"nested/two.md"}\n"one.ts"\n{"path":"nested/two.md"}\n'],
  ]);

  for (const [manifestName, manifestContent] of formats) {
    const manifestPath = path.join(fixture, manifestName);
    const outputBase = path.join(fixture, `bundle-${path.extname(manifestName).slice(1)}`);
    await fs.writeFile(manifestPath, manifestContent);

    const result = runCli([
      `--cwd=${fixture}`,
      `--files-from=${manifestPath}`,
      `--out=${outputBase}`,
      "--format=legacy",
    ]);

    assert.equal(result.status, 0, result.stderr);
    const aggregate = await fs.readFile(`${outputBase}.txt`, "utf8");
    assert.match(aggregate, /TWO_SELECTED/);
    assert.match(aggregate, /ONE_SELECTED/);
    assert.doesNotMatch(aggregate, /NOT_SELECTED/);
    assert.ok(
      aggregate.indexOf("# nested/two.md") < aggregate.indexOf("# one.ts"),
      `${manifestName} did not preserve manifest order`,
    );
    assert.equal(aggregate.match(/^# nested\/two\.md$/gm)?.length, 1);
  }
});

test("--files-from=- reads a newline-separated manifest from stdin", async (t) => {
  const fixture = await createFixture(t);
  const outputBase = path.join(fixture, "stdin-bundle");
  const result = runCli([
    `--cwd=${fixture}`,
    "--files-from=-",
    `--out=${outputBase}`,
  ], "one.ts\n");

  assert.equal(result.status, 0, result.stderr);
  const aggregate = await fs.readFile(`${outputBase}.txt`, "utf8");
  assert.match(aggregate, /ONE_SELECTED/);
  assert.doesNotMatch(aggregate, /TWO_SELECTED|NOT_SELECTED/);
});

test("non-empty piped stdin is automatically used as the path manifest", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli([], "one.ts\nnested\nmissing.ts\n", fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Skipping non-file piped path: nested/);
  assert.match(result.stderr, /Skipping missing piped path: missing\.ts/);
  const aggregate = await fs.readFile(path.join(fixture, `${path.basename(fixture)}.txt`), "utf8");
  assert.match(aggregate, /ONE_SELECTED/);
  assert.doesNotMatch(aggregate, /TWO_SELECTED|NOT_SELECTED/);
});

test("default outputs use the invocation directory basename", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  await fs.writeFile(manifestPath, '["one.ts"]');

  const result = runCli([`--files-from=${manifestPath}`], undefined, fixture);

  assert.equal(result.status, 0, result.stderr);
  const outputPath = path.join(fixture, `${path.basename(fixture)}.txt`);
  const aggregate = await fs.readFile(outputPath, "utf8");
  assert.match(aggregate, /^MKTCTX\/5$/m);
  assert.match(aggregate, /ONE_SELECTED/);
  await assert.rejects(fs.access(path.join(fixture, `${path.basename(fixture)}_toc.md`)));
  await assert.rejects(fs.access(path.join(fixture, `${path.basename(fixture)}_symbols.csv`)));
  await assert.rejects(fs.access(path.join(fixture, `${path.basename(fixture)}_diff.txt`)));
});

test("legacy format retains the aggregate sidecar set", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  const outputBase = path.join(fixture, "legacy");
  await fs.writeFile(manifestPath, '["one.ts"]');

  const result = runCli([
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--format=legacy",
  ], undefined, fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(`${outputBase}.txt`, "utf8"), /^# one\.ts$/m);
  await fs.access(`${outputBase}_toc.md`);
  await fs.access(`${outputBase}_symbols.csv`);
  await fs.access(`${outputBase}_diff.txt`);
});

test("context-v3 emits a self-contained packet and canonical manifest", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  const taskPath = path.join(fixture, "task.txt");
  const outputBase = path.join(fixture, "context");
  await fs.writeFile(manifestPath, '["nested/two.md", "one.ts"]');
  await fs.writeFile(taskPath, "Explain which selected file exports a symbol.\n");

  const result = runCli([
    `--cwd=${fixture}`,
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--format=context-v3",
    `--task-file=${taskPath}`,
    "--emit-manifest",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const aggregate = await fs.readFile(`${outputBase}.txt`, "utf8");
  assert.match(aggregate, /^MKTCTX\/3$/m);
  assert.match(aggregate, /^@guide .*@task is optional instruction\.$/m);
  assert.match(aggregate, /@selection kind=manifest order=manifest/);
  assert.match(aggregate, /F[a-f0-9]{12} path="nested\/two\.md"/);
  assert.match(aggregate, /F[a-f0-9]{12} path="one\.ts"/);
  assert.doesNotMatch(aggregate, /NOT_SELECTED/);
  assert.ok(aggregate.indexOf("\n@task ") > aggregate.lastIndexOf("@end-file"));
  assert.match(aggregate, /Explain which selected file exports a symbol\./);

  const machineManifest = JSON.parse(await fs.readFile(`${outputBase}.manifest.json`, "utf8"));
  assert.equal(machineManifest.protocol, "MKTCTX/3");
  assert.deepEqual(machineManifest.files.map((file: { path: string }) => file.path), [
    "nested/two.md",
    "one.ts",
  ]);
  await assert.rejects(fs.access(`${outputBase}_toc.md`));
  await assert.rejects(fs.access(`${outputBase}_symbols.csv`));
  await assert.rejects(fs.access(`${outputBase}_diff.txt`));
});

test("--emit-sidecars adds derived v5 outputs", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  const outputBase = path.join(fixture, "context-sidecars");
  await fs.writeFile(manifestPath, '["one.ts"]');

  const result = runCli([
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--emit-sidecars",
  ], undefined, fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(`${outputBase}.txt`, "utf8"), /^MKTCTX\/5$/m);
  await fs.access(`${outputBase}_toc.md`);
  await fs.access(`${outputBase}_symbols.csv`);
  await fs.access(`${outputBase}_diff.txt`);
});

test("reserved projection modes fail explicitly", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli(["--format=context-v3", "--mode=balanced"], undefined, fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Mode balanced is reserved but not implemented/);
});

test("implicit piped omissions are recorded before file content", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli([], "one.ts\nmissing.ts\nnested\n", fixture);

  assert.equal(result.status, 0, result.stderr);
  const aggregate = await fs.readFile(path.join(fixture, `${path.basename(fixture)}.txt`), "utf8");
  assert.match(aggregate, /@coverage .*normalized_requested=3 included=1 omitted=2 repository_total=unknown .*selected_complete=false repository_complete=unknown/);
  assert.match(aggregate, /@omitted count=2/);
  assert.match(aggregate, /path="missing\.ts" reason=selected-missing/);
  assert.match(aggregate, /path="nested" reason=selected-not-file/);
  assert.ok(aggregate.indexOf("@end-omitted") < aggregate.indexOf("ONE_SELECTED"));
});

test("record policy emits stable diagnostics for missing, directory, binary, and invalid UTF-8 paths", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(path.join(fixture, "binary.dat"), Buffer.from([0x41, 0x00, 0x42]));
  await fs.writeFile(path.join(fixture, "invalid.txt"), Buffer.from([0xc3, 0x28]));
  const result = runCli(["--missing=record"],
    "one.ts\nmissing.ts\nnested\nbinary.dat\ninvalid.txt\n", fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(fixture, `${path.basename(fixture)}.txt`);
  const packet = await fs.readFile(output, "utf8");
  for (const code of [
    "SELECTED_PATH_MISSING",
    "SELECTED_PATH_NOT_FILE",
    "SELECTED_PATH_BINARY",
    "SELECTED_PATH_INVALID_UTF8",
  ]) {
    assert.match(packet, new RegExp(`severity=warning code=${code}`));
  }
  assert.match(packet, /@diagnostics policy=record count=4 errors=0 warnings=4 .*selection_complete=false policy_compliant=true/);
  const verified = runCli(["verify", output, "--json"], undefined, fixture);
  assert.equal(verified.status, 0, verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.selectionComplete, false);
  assert.equal(report.policyCompliant, true);
  assert.equal(report.diagnostics.length, 4);
});

test("error policy exits before output with stable diagnostics for selection failures", async (t) => {
  const fixture = await createFixture(t);
  await fs.writeFile(path.join(fixture, "binary.dat"), Buffer.from([0x41, 0x00, 0x42]));
  await fs.writeFile(path.join(fixture, "invalid.txt"), Buffer.from([0xc3, 0x28]));
  const cases = [
    { path: "missing.ts", code: "SELECTED_PATH_MISSING" },
    { path: "nested", code: "SELECTED_PATH_NOT_FILE" },
    { path: "binary.dat", code: "SELECTED_PATH_BINARY" },
    { path: "invalid.txt", code: "SELECTED_PATH_INVALID_UTF8" },
  ];
  for (const [index, entry] of cases.entries()) {
    const manifestPath = path.join(fixture, `strict-${index}.json`);
    const outputBase = path.join(fixture, `strict-${index}`);
    await fs.writeFile(manifestPath, JSON.stringify([entry.path]));
    const result = runCli([
      `--cwd=${fixture}`,
      `--files-from=${manifestPath}`,
      "--missing=error",
      `--out=${outputBase}`,
    ]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, new RegExp(`severity=error code=${entry.code}`));
    await assert.rejects(fs.access(`${outputBase}.txt`));
  }
});

test("excluded candidates obey error and record policies", async (t) => {
  const fixture = await createFixture(t);
  git(fixture, ["init", "-q"]);
  const strict = runCli(["--include-ext=ts", "--missing=error", "--out=strict-excluded"], undefined, fixture);
  assert.equal(strict.status, 1, strict.stdout);
  assert.match(strict.stderr, /severity=error code=PATH_EXCLUDED_EXTENSION/);
  await assert.rejects(fs.access(path.join(fixture, "strict-excluded.txt")));

  const recorded = runCli(["--include-ext=ts", "--missing=record", "--out=recorded-excluded"], undefined, fixture);
  assert.equal(recorded.status, 0, recorded.stderr);
  const packet = await fs.readFile(path.join(fixture, "recorded-excluded.txt"), "utf8");
  assert.match(packet, /severity=warning code=PATH_EXCLUDED_EXTENSION/);
  assert.match(packet, /policy_compliant=true/);
});

test("--line-numbers emits the citation representation without changing selection", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  const outputBase = path.join(fixture, "numbered");
  await fs.writeFile(manifestPath, '["one.ts"]');

  const result = runCli([
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--line-numbers",
  ], undefined, fixture);

  assert.equal(result.status, 0, result.stderr);
  const aggregate = await fs.readFile(`${outputBase}.txt`, "utf8");
  assert.match(aggregate, /projection=numbered .*reason=citation-gutter/);
  assert.match(aggregate, /1\| export const one = 'ONE_SELECTED';/);
});

test("context-v4 emits a canonical manifest and verify subcommand accepts the packet", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "paths.json");
  const outputBase = path.join(fixture, "v4");
  await fs.writeFile(manifestPath, '["one.ts"]');
  const generated = runCli([
    `--cwd=${fixture}`,
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--format=context-v4",
    "--emit-manifest",
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(await fs.readFile(`${outputBase}.txt`, "utf8"), /^MKTCTX\/4$/m);
  const manifest = JSON.parse(await fs.readFile(`${outputBase}.manifest.json`, "utf8"));
  assert.equal(manifest.protocol, "MKTCTX/4");
  assert.equal(manifest.representation, "valid-utf8-source-bytes");

  const verified = runCli(["verify", `${outputBase}.txt`, "--json"], undefined, fixture);
  assert.equal(verified.status, 0, verified.stderr);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.protocol, "MKTCTX/4");
  assert.equal(result.exactFilesVerified, 1);
  assert.ok(result.checks.includes("canonical-manifest-sha256"));
});

test("v5 selection provenance redacts absolute request paths and records replay posture", async (t) => {
  const fixture = await createFixture(t);
  const externalPath = path.join(os.tmpdir(), `mktxt-external-${path.basename(fixture)}.ts`);
  t.after(() => fs.rm(externalPath, { force: true }));
  await fs.writeFile(externalPath, "export const external = true;\n");
  const manifestPath = path.join(fixture, "absolute-paths.json");
  const outputBase = path.join(fixture, "selection-provenance");
  await fs.writeFile(manifestPath, JSON.stringify([externalPath]));

  const generated = runCli([
    `--cwd=${fixture}`,
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
    "--emit-manifest",
    "--task=PRIVATE TASK TEXT",
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  const packet = await fs.readFile(`${outputBase}.txt`, "utf8");
  const manifestText = await fs.readFile(`${outputBase}.manifest.json`, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.selection.reproducibility, "exact-request-replayable");
  assert.equal(manifest.selection.caller.kind, "path-list");
  assert.match(manifest.selection.caller.paths[0], /^external\/[a-f0-9]{8}\/mktxt-external-/);
  assert.doesNotMatch(manifestText, new RegExp(escapeRegExp(os.tmpdir())));
  assert.doesNotMatch(manifestText, /PRIVATE TASK TEXT/);
  assert.doesNotMatch(packet.slice(0, packet.indexOf("@task ")), new RegExp(escapeRegExp(os.tmpdir())));
});

test("--git-diff emits VCS changes, resolved edges, and review projections", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "mktxt-git-cli-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, "src"));
  await fs.writeFile(path.join(fixture, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  await fs.writeFile(path.join(fixture, "src", "b.ts"), "export const b = 1;\n");
  await fs.writeFile(path.join(fixture, "deleted.ts"), "remove me\n");
  git(fixture, ["init", "-q"]);
  git(fixture, ["config", "user.email", "mktxt@example.invalid"]);
  git(fixture, ["config", "user.name", "mktxt test"]);
  git(fixture, ["add", "."]);
  git(fixture, ["commit", "-qm", "base"]);
  await fs.writeFile(path.join(fixture, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b + 1;\n');
  await fs.writeFile(path.join(fixture, "src", "c.ts"), 'import { a } from "./a.js";\nexport const c = a;\n');
  await fs.rm(path.join(fixture, "deleted.ts"));

  const result = runCli(["--git-diff=HEAD", "--out=review"], undefined, fixture);
  assert.equal(result.status, 0, result.stderr);
  const packet = await fs.readFile(path.join(fixture, "review.txt"), "utf8");
  assert.match(packet, /^@vcs kind=git .* base_ref="HEAD" .* dirty=true source=working-tree$/m);
  assert.match(packet, /status=modified path="src\/a\.ts"/);
  assert.match(packet, /status=added path="src\/c\.ts"/);
  assert.match(packet, /status=deleted path="deleted\.ts"/);
  assert.match(packet, /kind=import resolution=resolved confidence=resolved specifier="\.\/b\.js"/);
  assert.match(packet, /path="src\/a\.ts".*reason=changed/);
  assert.match(packet, /path="src\/b\.ts".*reason=dependency-neighbor/);
  const verified = runCli(["verify", "review.txt"], undefined, fixture);
  assert.equal(verified.status, 0, verified.stderr);
});

test("the superseded context-v2 flag fails instead of emitting v3", async (t) => {
  const fixture = await createFixture(t);
  const result = runCli(["--format=context-v2"], undefined, fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /context-v2 was superseded by context-v3/);
});

test("invalid selections fail before an existing output is rotated", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "missing.txt");
  const outputBase = path.join(fixture, "bundle");
  await fs.writeFile(manifestPath, "missing.ts\n");
  await fs.writeFile(`${outputBase}.txt`, "KEEP_EXISTING_OUTPUT\n");

  const result = runCli([
    `--cwd=${fixture}`,
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Selected path does not exist: missing\.ts/);
  assert.equal(await fs.readFile(`${outputBase}.txt`, "utf8"), "KEEP_EXISTING_OUTPUT\n");
  await assert.rejects(fs.access(`${outputBase}.prev.txt`));
});

test("a manifest cannot select its own aggregate output", async (t) => {
  const fixture = await createFixture(t);
  const manifestPath = path.join(fixture, "self.txt");
  const outputBase = path.join(fixture, "bundle");
  await fs.writeFile(manifestPath, "bundle.txt\n");
  await fs.writeFile(`${outputBase}.txt`, "KEEP_EXISTING_OUTPUT\n");

  const result = runCli([
    `--cwd=${fixture}`,
    `--files-from=${manifestPath}`,
    `--out=${outputBase}`,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Path manifest cannot include an output file: bundle\.txt/);
  assert.equal(await fs.readFile(`${outputBase}.txt`, "utf8"), "KEEP_EXISTING_OUTPUT\n");
  await assert.rejects(fs.access(`${outputBase}.prev.txt`));
});

async function createFixture(t: test.TestContext): Promise<string> {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "mktxt-manifest-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, "nested"));
  await fs.writeFile(path.join(fixture, "one.ts"), "export const one = 'ONE_SELECTED';\n");
  await fs.writeFile(path.join(fixture, "nested", "two.md"), "TWO_SELECTED\n");
  await fs.writeFile(path.join(fixture, "omitted.txt"), "NOT_SELECTED\n");
  return fixture;
}

const entryPath = path.join(projectRoot, "src/index.ts");
const tsxPath = path.join(projectRoot, "node_modules/.bin/tsx");

function runCli(args: string[], input?: string, cwd = projectRoot) {
  return spawnSync(tsxPath, [entryPath, ...args], {
    cwd,
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
