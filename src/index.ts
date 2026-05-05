import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createRepoWorkspace } from "@flyingrobots/graft";

async function main() {
  const args = process.argv.slice(2);
  const cwds: string[] = [];
  const includeExts: Set<string> = new Set();
  const excludeExts: Set<string> = new Set();
  let explicitOut: string | undefined;
  let noTests = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--cwd=")) {
      cwds.push(arg.split("=")[1]);
    } else if (arg.startsWith("--include-ext=") || arg.startsWith("--only=")) {
      includeExts.add(normalizeExt(arg.split("=")[1]));
    } else if (arg.startsWith("--exclude-ext=")) {
      excludeExts.add(normalizeExt(arg.split("=")[1]));
    } else if (arg.startsWith("--out=")) {
      explicitOut = arg.split("=")[1];
    } else if (arg === "--no-tests") {
      noTests = true;
    } else if (!arg.startsWith("-")) {
      cwds.push(arg);
    }
  }

  if (cwds.length === 0) {
    cwds.push(process.cwd());
  }

  let baseName: string;
  if (explicitOut) {
    baseName = explicitOut;
  } else if (cwds.length === 1) {
    baseName = path.basename(path.resolve(cwds[0]));
  } else {
    console.error("Error: Multiple --cwd arguments provided without --out=<name>");
    process.exit(1);
  }

  const outputTxt = `${baseName}.txt`;
  const outputToc = `${baseName}_toc.md`;
  const outputSymbols = `${baseName}_symbols.csv`;
  const outputDiff = `${baseName}_diff.txt`;
  const prevTxt = `${baseName}.prev.txt`;

  // Rotate previous output
  try {
    await fs.access(outputTxt);
    await fs.rename(outputTxt, prevTxt);
  } catch {}

  const txtHandle = await fs.open(outputTxt, "w");
  const tocHandle = await fs.open(outputToc, "w");
  const symHandle = await fs.open(outputSymbols, "w");

  await tocHandle.write("| Filepath | Line Start | Line End | Symbols |\n");
  await tocHandle.write("|----------|------------|----------|---------|\n");
  await symHandle.write("Symbol,Type,Signature,File,Line\n");

  let currentLine = 0;
  const processedFiles = new Set<string>();

  for (const cwd of cwds) {
    const absoluteCwd = path.resolve(cwd);
    const workspace = await createRepoWorkspace({ cwd: absoluteCwd });
    const files = getFiles(absoluteCwd, noTests);

    for (const relativePath of files) {
      const fullPath = path.resolve(absoluteCwd, relativePath);
      if (processedFiles.has(fullPath)) continue;
      processedFiles.add(fullPath);

      const ext = normalizeExt(path.extname(relativePath));
      if (includeExts.size > 0 && !includeExts.has(ext)) continue;
      if (excludeExts.has(ext)) continue;

      // Skip the output files themselves
      if (fullPath === path.resolve(outputTxt) || 
          fullPath === path.resolve(outputToc) || 
          fullPath === path.resolve(outputSymbols) || 
          fullPath === path.resolve(outputDiff) ||
          fullPath === path.resolve(prevTxt)) {
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        // Skip binary files (simple check)
        if (content.includes("\0")) continue;

        const lineCount = content.split("\n").length;
        const result = await workspace.fileOutline({ path: relativePath });

        if ("outline" in result) {
          const headerLine = currentLine + 1;
          const startLine = headerLine + 1;
          const endLine = headerLine + lineCount;

          const symbols: string[] = [];
          walkOutline(result.outline, (entry) => {
            symbols.push(entry.name);
            const line = getLineNumber(content, result.jumpTable, entry.name);
            symHandle.write(`${escapeCsv(entry.name)},${escapeCsv(entry.kind)},${escapeCsv(entry.signature || entry.name)},${escapeCsv(relativePath)},${line}\n`);
          });

          await tocHandle.write(`| ${relativePath} | ${startLine} | ${endLine} | ${symbols.join(", ")} |\n`);
          await txtHandle.write(`# ${relativePath}\n${content}\n\n`);
          currentLine = endLine + 2;
        } else {
          // No outline (maybe unsupported language), still include content
          const headerLine = currentLine + 1;
          const startLine = headerLine + 1;
          const endLine = headerLine + lineCount;

          await tocHandle.write(`| ${relativePath} | ${startLine} | ${endLine} | |\n`);
          await txtHandle.write(`# ${relativePath}\n${content}\n\n`);
          currentLine = endLine + 2;
        }
      } catch (err) {
        console.warn(`Warning: Could not process ${relativePath}: ${err}`);
      }
    }
  }

  await txtHandle.close();
  await tocHandle.close();
  await symHandle.close();

  // Generate diff
  try {
    await fs.access(prevTxt);
    execSync(`diff -u "${prevTxt}" "${outputTxt}" > "${outputDiff}"`, { stdio: "ignore" });
  } catch {}

  console.log(`Aggregation complete:
  - ${outputTxt}
  - ${outputToc}
  - ${outputSymbols}
  - ${outputDiff}`);
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function getFiles(cwd: string, noTests: boolean): string[] {
  try {
    let cmd = "git ls-files -co --exclude-standard -z";
    const output = execSync(cmd, { cwd }).toString();
    let files = output.split("\0").filter(f => f.length > 0);
    
    if (noTests) {
      files = files.filter(f => !isTestFile(f));
    }
    return files;
  } catch {
    // Fallback to manual walk if not a git repo (omitted for brevity in this first pass, but I'll add a simple one)
    return [];
  }
}

function isTestFile(file: string): boolean {
  const testPatterns = [
    /_test\./, /\.test\./, /\.spec\./, /test_/, /test\./,
    /Test\./, /Tests\./, /Spec\./, /_spec\./,
    /^test\//, /^tests\//, /\/__tests__\//, /\/__snapshots__\//
  ];
  return testPatterns.some(p => p.test(file));
}

function walkOutline(outline: any[], cb: (entry: any) => void) {
  for (const entry of outline) {
    cb(entry);
    if (entry.children) {
      walkOutline(entry.children, cb);
    }
  }
}

function getLineNumber(content: string, jumpTable: any[], symbolName: string): number {
  const jump = jumpTable.find(j => j.symbol === symbolName);
  return jump ? jump.start : 1;
}

function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes("\"") || val.includes("\n")) {
    return `"${val.replace(/"/g, "\"\"")}"`;
  }
  return val;
}

main().catch(console.error);
