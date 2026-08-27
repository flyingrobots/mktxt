import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import {
  applyExactFileAliases,
  assignStableFileIds,
  buildContextSymbols,
  CONTEXT_PROTOCOL,
  type ContentRepresentation,
  type ContextFile,
  type ContextMode,
  type ContextOmission,
  type ContextPacket,
  languageFromPath,
  renderContextV3,
  renderLegacyAggregate,
  sha256,
  sourceLineCount,
} from "./context.js";
import {
  CONTEXT_V4_PROTOCOL,
  decodeValidUtf8,
  estimateTokens,
  renderContextV4,
  type ContextProfile,
  type SymbolPolicy,
  type V4File,
  type V4Packet,
  verifyContextV4,
  v4SourceLineCount,
  v4Sha256,
} from "./context-v4.js";
import {
  CONTEXT_V5_PROTOCOL,
  diagnosticForV5Omission,
  renderContextV5,
  type ContextV5Format,
  type V5File,
  type V5MissingPolicy,
  type V5Packet,
  type V5ProjectionProfile,
  type V5SelectionRequest,
  verifyContextV5,
} from "./context-v5.js";
import { analyzeModuleEdges, applyProjectionProfile, applyV4Aliases, selectSymbols } from "./analysis-v4.js";
import { generateUnifiedDiff } from "./diff.js";
import { readPathManifest } from "./manifest.js";
import { attachChangeFileIds, readGitDiffSelection, type GitDiffSelection } from "./vcs-v4.js";

type GraftModule = typeof import("@flyingrobots/graft");
type CreateRepoWorkspace = GraftModule["createRepoWorkspace"];

interface SelectedFile {
  readonly fullPath: string;
  readonly displayPath: string;
  readonly outlinePath?: string;
}

interface ResolvedSelection {
  readonly files: SelectedFile[];
  readonly omissions: ContextOmission[];
  readonly requestedPaths: string[];
}

interface CollectedContext {
  readonly files: ContextFile[];
  readonly omissions: ContextOmission[];
  readonly sourceByFileId: ReadonlyMap<string, Buffer>;
  readonly resolvedCandidates: readonly string[];
}

interface CliOptions {
  readonly cwds: string[];
  readonly includeExts: Set<string>;
  readonly excludeExts: Set<string>;
  readonly explicitOut?: string;
  readonly manifestSource?: string;
  readonly noTests: boolean;
  readonly format: ContextV5Format;
  readonly mode?: ContextMode;
  readonly task?: string;
  readonly taskFile?: string;
  readonly emitManifest: boolean;
  readonly emitSidecars: boolean;
  readonly lineNumbers: boolean;
  readonly gitDiff?: string;
  readonly profile?: V5ProjectionProfile;
  readonly symbolPolicy: SymbolPolicy;
  readonly tokenBudget?: number;
  readonly missingPolicy?: V5MissingPolicy;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "verify") {
    await runVerify(args.slice(1));
    return;
  }
  if (args[0] === "--mcp") {
    await runMcp();
    return;
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(`mktxt ${await readVersion()}`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseArgs(args);
  const invocationCwd = process.cwd();
  const baseName = options.explicitOut ?? (path.basename(invocationCwd) || "mktxt");
  const outputTxt = `${baseName}.txt`;
  const outputToc = `${baseName}_toc.md`;
  const outputSymbols = `${baseName}_symbols.csv`;
  const outputDiff = `${baseName}_diff.txt`;
  const outputManifest = `${baseName}.manifest.json`;
  const prevTxt = `${baseName}.prev.txt`;
  const outputPaths = [outputTxt, outputToc, outputSymbols, outputDiff, outputManifest, prevTxt];

  let manifestFiles: SelectedFile[] | undefined;
  let selectionOmissions: ContextOmission[] = [];
  let normalizedRequestedPaths: string[] | undefined;
  let selectionKind: ContextPacket["selectionKind"] = "discovery";
  let missingPolicy: V5MissingPolicy = options.missingPolicy ?? "record";
  let gitSelection: GitDiffSelection | undefined;
  if (options.gitDiff !== undefined) {
    gitSelection = await readGitDiffSelection(path.resolve(options.cwds[0]), options.gitDiff);
    selectionKind = "discovery";
  } else if (options.manifestSource !== undefined) {
    const manifestPaths = await readPathManifest(options.manifestSource, invocationCwd);
    if (manifestPaths.length === 0) throw new Error("Path manifest contains no file paths");
    missingPolicy = options.missingPolicy ?? "error";
    const resolved = await resolveManifestFiles(path.resolve(options.cwds[0]), manifestPaths, missingPolicy);
    manifestFiles = resolved.files;
    selectionOmissions = resolved.omissions;
    normalizedRequestedPaths = resolved.requestedPaths;
    selectionKind = "manifest";
    await assertManifestDoesNotContainOutputs(manifestFiles, outputPaths);
  } else {
    const pipedPaths = await readImplicitStdinPaths(invocationCwd);
    if (pipedPaths !== undefined) {
      if (options.cwds.length !== 1) {
        throw new Error("Piped path manifests accept exactly one --cwd; paths are resolved from it");
      }
      const resolved = await resolveManifestFiles(path.resolve(options.cwds[0]), pipedPaths, missingPolicy);
      manifestFiles = resolved.files;
      selectionOmissions = resolved.omissions;
      normalizedRequestedPaths = resolved.requestedPaths;
      if (manifestFiles.length === 0) throw new Error("Piped path manifest contains no usable file paths");
      selectionKind = "stdin";
      await assertManifestDoesNotContainOutputs(manifestFiles, outputPaths);
    }
  }

  const task = options.taskFile === undefined
    ? options.task
    : await readUtf8File(path.resolve(invocationCwd, options.taskFile), options.taskFile);
  const version = await readVersion();
  const graft = await loadGraft();
  const collected = await collectContextFiles({
    options,
    manifestFiles,
    missingPolicy,
    outputPaths,
    createRepoWorkspace: graft?.createRepoWorkspace,
  });
  const packet: ContextPacket = {
    protocol: CONTEXT_PROTOCOL,
    mode: "lossless",
    rootLabel: options.cwds.length === 1
      ? path.basename(path.resolve(options.cwds[0])) || "mktxt"
      : path.basename(invocationCwd) || "mktxt",
    selectionKind,
    selectionOrder: manifestFiles === undefined ? "git" : "manifest",
    generatorVersion: version,
    analyzerName: graft === undefined ? "unavailable" : "graft",
    ...(graft === undefined ? {} : { analyzerVersion: graft.GRAFT_VERSION }),
    files: applyExactFileAliases(collected.files),
    omissions: [...selectionOmissions, ...collected.omissions],
    edgeStatus: "unavailable",
    edgeReason: "module resolution not implemented",
    edges: [],
    ...(task === undefined ? {} : { task }),
  };

  const profile = options.profile ?? (gitSelection === undefined ? "exact-selection" : "review");
  const analysisProfile: ContextProfile = profile === "exact-selection" ? "lossless" : profile;
  const v4Files = collected.files.map((file): V4File => {
    const source = collected.sourceByFileId.get(file.id);
    if (source === undefined) throw new Error(`Missing exact source bytes for ${file.path}`);
    decodeValidUtf8(source, file.path);
    const allSymbols = file.symbols;
    const symbols = selectSymbols(allSymbols, file.language, options.symbolPolicy);
    return {
      id: file.id,
      path: file.path,
      ...(file.language === undefined ? {} : { language: file.language }),
      source,
      sourceLines: v4SourceLineCount(source),
      sourceHash: v4Sha256(source),
      projection: "exact",
      projectionReason: "selected",
      outlineStatus: file.outlineStatus,
      ...(file.outlineReason === undefined ? {} : { outlineReason: file.outlineReason }),
      symbolPolicy: options.symbolPolicy,
      symbolTotal: allSymbols.length,
      symbols,
      estimatedTokens: estimateTokens(source.byteLength),
    };
  });
  const edgeAnalysis = analyzeModuleEdges(v4Files);
  const projectedV4Files = applyV4Aliases(applyProjectionProfile(v4Files, edgeAnalysis.edges, {
    profile: analysisProfile,
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    ...(gitSelection === undefined ? {} : { changedPaths: gitSelection.changedPaths }),
    ...(options.lineNumbers ? { numbered: true } : {}),
  }));
  const fileIdsByPath = new Map(projectedV4Files.map((file) => [file.path, file.id]));
  const v4Packet: V4Packet = {
    protocol: CONTEXT_V4_PROTOCOL,
    profile: analysisProfile,
    rootLabel: packet.rootLabel,
    selectionKind: gitSelection === undefined ? selectionKind : "git-diff",
    selectionOrder: manifestFiles === undefined ? "git" : "manifest",
    generatorVersion: version,
    analyzerName: packet.analyzerName,
    ...(packet.analyzerVersion === undefined ? {} : { analyzerVersion: packet.analyzerVersion }),
    symbolPolicy: options.symbolPolicy,
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    files: projectedV4Files,
    omissions: packet.omissions,
    edgeStatus: edgeAnalysis.status,
    edgeReason: edgeAnalysis.reason,
    edges: edgeAnalysis.edges,
    ...(gitSelection === undefined ? {} : { vcs: attachChangeFileIds(gitSelection.provenance, fileIdsByPath) }),
    ...(task === undefined ? {} : { task }),
  };

  const v5Files: V5File[] = projectedV4Files.map((file) => ({ ...file }));
  const resolvedCandidates = normalizedRequestedPaths ?? collected.resolvedCandidates;
  const rootLabels = options.cwds.length === 1
    ? [packet.rootLabel]
    : options.cwds.map((_, index) => `root-${index + 1}`);
  const selectionRequest: V5SelectionRequest = {
    reproducibility: manifestFiles !== undefined
      ? "exact-request-replayable"
      : options.cwds.length === 1
      ? "policy-replayable"
      : "descriptive-only",
    caller: {
      kind: gitSelection !== undefined
        ? "git-diff"
        : manifestFiles !== undefined
        ? "path-list"
        : "repository-discovery",
      ...(manifestFiles === undefined ? {} : { paths: resolvedCandidates }),
      rootLabels,
      ...(gitSelection === undefined ? {} : { baseRef: gitSelection.provenance.baseRef }),
    },
    policy: {
      order: manifestFiles === undefined ? "git" : "manifest",
      includeExtensions: [...options.includeExts].sort(),
      excludeExtensions: [...options.excludeExts].sort(),
      excludeTests: options.noTests,
      discoveryVisibility: manifestFiles === undefined
        ? "git-ls-files-cached-and-others-exclude-standard"
        : "not-applicable",
      projectionProfile: profile,
      symbolPolicy: options.symbolPolicy,
      numbered: options.lineNumbers,
      missingPolicy,
      ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    },
    resolvedCandidates,
  };
  const v5Packet: V5Packet = {
    protocol: CONTEXT_V5_PROTOCOL,
    projectionProfile: profile,
    rootLabel: packet.rootLabel,
    selectionKind: gitSelection === undefined ? selectionKind : "git-diff",
    selectionOrder: manifestFiles === undefined ? "git" : "manifest",
    generatorVersion: version,
    analyzerName: packet.analyzerName,
    ...(packet.analyzerVersion === undefined ? {} : { analyzerVersion: packet.analyzerVersion }),
    symbolPolicy: options.symbolPolicy,
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
    normalizedRequested: v5Files.length + packet.omissions.length,
    missingPolicy,
    selectionRequest,
    files: v5Files,
    omissions: packet.omissions,
    edgeStatus: edgeAnalysis.status,
    edgeReason: edgeAnalysis.reason,
    edges: edgeAnalysis.edges,
    ...(gitSelection === undefined ? {} : { vcs: attachChangeFileIds(gitSelection.provenance, fileIdsByPath) }),
    ...(task === undefined ? {} : { task }),
  };

  const contextV5 = options.format === "context-v5" ? renderContextV5(v5Packet) : undefined;
  const contextV4 = options.format === "context-v4" ? renderContextV4(v4Packet) : undefined;
  const contextV3 = options.format === "context-v3" ? renderContextV3(packet) : undefined;
  const rendered = contextV5 ?? contextV4 ?? contextV3 ?? renderLegacyAggregate(packet);
  const manifestJson = contextV5?.manifestJson ?? contextV4?.manifestJson ?? contextV3?.manifestJson;

  const emitSidecars = options.format === "legacy" || options.emitSidecars;
  if (emitSidecars) await rotatePreviousOutput(outputTxt, prevTxt);
  await Promise.all([
    fs.writeFile(outputTxt, contextV5?.bytes ?? contextV4?.bytes ?? rendered.text),
    ...(emitSidecars ? [
      fs.writeFile(outputToc, rendered.toc, "utf8"),
      fs.writeFile(outputSymbols, rendered.symbolsCsv, "utf8"),
    ] : []),
    ...(options.format !== "legacy" && options.emitManifest && manifestJson !== undefined
      ? [fs.writeFile(outputManifest, manifestJson, "utf8")]
      : []),
  ]);
  if (emitSidecars) await generateUnifiedDiff(prevTxt, outputTxt, outputDiff);

  const outputs = [outputTxt];
  if (emitSidecars) outputs.push(outputToc, outputSymbols, outputDiff);
  if (options.format !== "legacy" && options.emitManifest) outputs.push(outputManifest);
  console.log(`Aggregation complete (${options.format}):\n${outputs.map((output) => `  - ${output}`).join("\n")}`);
}

function parseArgs(args: readonly string[]): CliOptions {
  const cwds: string[] = [];
  const includeExts = new Set<string>();
  const excludeExts = new Set<string>();
  let explicitOut: string | undefined;
  let manifestSource: string | undefined;
  let noTests = false;
  let format: ContextV5Format = "context-v5";
  let mode: ContextMode | undefined;
  let task: string | undefined;
  let taskFile: string | undefined;
  let emitManifest = false;
  let emitSidecars = false;
  let lineNumbers = false;
  let gitDiff: string | undefined;
  let profile: V5ProjectionProfile | undefined;
  let symbolPolicy: SymbolPolicy = "useful";
  let tokenBudget: number | undefined;
  let missingPolicy: V5MissingPolicy | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--cwd=")) {
      cwds.push(requireValue("--cwd", arg.slice("--cwd=".length)));
    } else if (arg === "--cwd") {
      cwds.push(requireValue("--cwd", args[++i]));
    } else if (arg.startsWith("--include-ext=") || arg.startsWith("--only=")) {
      includeExts.add(normalizeExt(requireValue(arg.split("=")[0], arg.slice(arg.indexOf("=") + 1))));
    } else if (arg.startsWith("--exclude-ext=")) {
      excludeExts.add(normalizeExt(requireValue("--exclude-ext", arg.slice("--exclude-ext=".length))));
    } else if (arg.startsWith("--out=")) {
      explicitOut = requireValue("--out", arg.slice("--out=".length));
    } else if (arg === "--out") {
      explicitOut = requireValue("--out", args[++i]);
    } else if (arg.startsWith("--files-from=")) {
      manifestSource = requireValue("--files-from", arg.slice("--files-from=".length));
    } else if (arg === "--files-from") {
      manifestSource = requireValue("--files-from", args[++i]);
    } else if (arg.startsWith("--format=")) {
      format = parseFormat(arg.slice("--format=".length));
    } else if (arg === "--format") {
      format = parseFormat(requireValue("--format", args[++i]));
    } else if (arg.startsWith("--mode=")) {
      mode = parseMode(arg.slice("--mode=".length));
    } else if (arg === "--mode") {
      mode = parseMode(requireValue("--mode", args[++i]));
    } else if (arg.startsWith("--task=")) {
      task = arg.slice("--task=".length);
    } else if (arg === "--task") {
      task = requireValue("--task", args[++i]);
    } else if (arg.startsWith("--task-file=")) {
      taskFile = requireValue("--task-file", arg.slice("--task-file=".length));
    } else if (arg === "--task-file") {
      taskFile = requireValue("--task-file", args[++i]);
    } else if (arg === "--emit-manifest") {
      emitManifest = true;
    } else if (arg === "--emit-sidecars") {
      emitSidecars = true;
    } else if (arg === "--line-numbers") {
      lineNumbers = true;
    } else if (arg.startsWith("--git-diff=")) {
      gitDiff = requireValue("--git-diff", arg.slice("--git-diff=".length));
    } else if (arg === "--git-diff") {
      gitDiff = requireValue("--git-diff", args[++i]);
    } else if (arg.startsWith("--profile=")) {
      profile = parseProfile(arg.slice("--profile=".length));
    } else if (arg === "--profile") {
      profile = parseProfile(requireValue("--profile", args[++i]));
    } else if (arg.startsWith("--symbols=")) {
      symbolPolicy = parseSymbolPolicy(arg.slice("--symbols=".length));
    } else if (arg === "--symbols") {
      symbolPolicy = parseSymbolPolicy(requireValue("--symbols", args[++i]));
    } else if (arg.startsWith("--budget-tokens=")) {
      tokenBudget = parsePositiveInteger("--budget-tokens", arg.slice("--budget-tokens=".length));
    } else if (arg === "--budget-tokens") {
      tokenBudget = parsePositiveInteger("--budget-tokens", requireValue("--budget-tokens", args[++i]));
    } else if (arg.startsWith("--missing=")) {
      missingPolicy = parseMissingPolicy(arg.slice("--missing=".length));
    } else if (arg === "--missing") {
      missingPolicy = parseMissingPolicy(requireValue("--missing", args[++i]));
    } else if (arg === "--no-tests") {
      noTests = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      cwds.push(arg);
    }
  }

  if (cwds.length === 0) cwds.push(process.cwd());
  if (manifestSource !== undefined) {
    if (cwds.length !== 1) {
      throw new Error("--files-from accepts exactly one --cwd; manifest paths are resolved from it");
    }
    if (includeExts.size > 0 || excludeExts.size > 0 || noTests) {
      throw new Error("--files-from cannot be combined with extension filters or --no-tests");
    }
  }
  if (gitDiff !== undefined && manifestSource !== undefined) {
    throw new Error("--git-diff and --files-from are mutually exclusive");
  }
  if (gitDiff !== undefined && cwds.length !== 1) {
    throw new Error("--git-diff accepts exactly one --cwd repository");
  }
  if (task !== undefined && taskFile !== undefined) {
    throw new Error("--task and --task-file are mutually exclusive");
  }
  if (format === "legacy" &&
      (mode !== undefined || task !== undefined || taskFile !== undefined || emitManifest || lineNumbers ||
       gitDiff !== undefined || profile !== undefined || tokenBudget !== undefined || symbolPolicy !== "useful")) {
    throw new Error("Context, Git, projection, budget, and manifest options require a context format");
  }
  if (format === "context-v3" &&
      (gitDiff !== undefined || profile !== undefined || tokenBudget !== undefined || symbolPolicy !== "useful")) {
    throw new Error("--git-diff, --profile, --symbols, and --budget-tokens require --format=context-v5 or context-v4");
  }
  if (format !== "context-v5" && missingPolicy !== undefined) {
    throw new Error("--missing requires --format=context-v5");
  }

  return {
    cwds,
    includeExts,
    excludeExts,
    ...(explicitOut === undefined ? {} : { explicitOut }),
    ...(manifestSource === undefined ? {} : { manifestSource }),
    noTests,
    format,
    ...(mode === undefined ? {} : { mode }),
    ...(task === undefined ? {} : { task }),
    ...(taskFile === undefined ? {} : { taskFile }),
    emitManifest,
    emitSidecars,
    lineNumbers,
    ...(gitDiff === undefined ? {} : { gitDiff }),
    ...(profile === undefined ? {} : { profile }),
    symbolPolicy,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(missingPolicy === undefined ? {} : { missingPolicy }),
  };
}

function parseMissingPolicy(value: string): V5MissingPolicy {
  if (value === "error" || value === "record") return value;
  throw new Error(`Unsupported missing policy: ${value}; expected error or record`);
}

function parseFormat(value: string): ContextV5Format {
  if (value === "legacy" || value === "context-v3" || value === "context-v4" || value === "context-v5") return value;
  if (value === "context-v2") {
    throw new Error("Format context-v2 was superseded by context-v3; use --format=context-v3");
  }
  throw new Error(`Unsupported format: ${value}; expected legacy, context-v3, context-v4, or context-v5`);
}

function parseProfile(value: string): V5ProjectionProfile {
  if (value === "exact-selection" || value === "review" || value === "structure") return value;
  if (value === "lossless") return "exact-selection";
  throw new Error(`Unsupported profile: ${value}; expected exact-selection, review, or structure`);
}

function parseSymbolPolicy(value: string): SymbolPolicy {
  if (value === "useful" || value === "full" || value === "none") return value;
  throw new Error(`Unsupported symbol policy: ${value}; expected useful, full, or none`);
}

function parsePositiveInteger(option: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

function parseMode(value: string): ContextMode {
  if (value === "lossless") return value;
  if (value === "balanced" || value === "focused" || value === "structure-only") {
    throw new Error(`Mode ${value} is reserved but not implemented; use --mode=lossless`);
  }
  throw new Error(`Unsupported mode: ${value}`);
}

function requireValue(option: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) throw new Error(`${option} requires a value`);
  return value;
}

async function loadGraft(): Promise<GraftModule | undefined> {
  try {
    return await import("@flyingrobots/graft");
  } catch (error) {
    console.warn(`Warning: Graft is unavailable; files will be included without outlines: ${errorMessage(error)}`);
    return undefined;
  }
}

async function collectContextFiles(args: {
  readonly options: CliOptions;
  readonly manifestFiles?: readonly SelectedFile[];
  readonly missingPolicy: V5MissingPolicy;
  readonly outputPaths: readonly string[];
  readonly createRepoWorkspace?: CreateRepoWorkspace;
}): Promise<CollectedContext> {
  const collected: ContextFile[] = [];
  const omissions: ContextOmission[] = [];
  const sourceByFileId = new Map<string, Buffer>();
  const resolvedCandidates: string[] = [];
  const processedFiles = new Set<string>();
  const resolvedOutputs = new Set(args.outputPaths.map((output) => path.resolve(output)));
  const selections = args.options.cwds.map((cwd) => {
    const absoluteCwd = path.resolve(cwd);
    const rootPrefix = args.options.cwds.length === 1
      ? ""
      : `${path.basename(absoluteCwd) || "root"}-${sha256(absoluteCwd).slice(0, 8)}/`;
    const selectedFiles = args.manifestFiles ?? getFiles(absoluteCwd).map((relativePath) => ({
      fullPath: path.resolve(absoluteCwd, relativePath),
      displayPath: `${rootPrefix}${normalizePath(relativePath)}`,
      outlinePath: normalizePath(relativePath),
    }));
    return { absoluteCwd, selectedFiles };
  });
  const fileIds = assignStableFileIds(
    selections.flatMap(({ selectedFiles }) => selectedFiles.map((file) => file.displayPath)),
  );

  for (const { absoluteCwd, selectedFiles } of selections) {
    let workspace: Awaited<ReturnType<CreateRepoWorkspace>> | undefined;
    if (args.createRepoWorkspace !== undefined) {
      try {
        workspace = await args.createRepoWorkspace({ cwd: absoluteCwd });
      } catch (error) {
        console.warn(`Warning: Could not initialize Graft in ${absoluteCwd}: ${errorMessage(error)}`);
      }
    }
    // Process files in chunks to bound concurrency and avoid EMFILE
    const chunkedFiles = [];
    for (let i = 0; i < selectedFiles.length; i += 8) {
      chunkedFiles.push(selectedFiles.slice(i, i + 8));
    }

    for (const chunk of chunkedFiles) {
      const chunkResults = await Promise.all(chunk.map(async (selectedFile) => {
        if (processedFiles.has(selectedFile.displayPath)) return null;
        processedFiles.add(selectedFile.displayPath);
        resolvedCandidates.push(selectedFile.displayPath);
        const extension = normalizeExt(path.extname(selectedFile.displayPath));
        if (args.options.noTests && isTestFile(selectedFile.displayPath)) {
          handleSelectionOmission(omissions, {
            path: selectedFile.displayPath,
            reason: "excluded-test",
            detail: "excluded by --no-tests",
          }, args.missingPolicy);
          return null;
        }
        if (args.options.includeExts.size > 0 && !args.options.includeExts.has(extension)) {
          handleSelectionOmission(omissions, {
            path: selectedFile.displayPath,
            reason: "excluded-extension",
            detail: "not included by --include-ext",
          }, args.missingPolicy);
          return null;
        }
        if (args.options.excludeExts.has(extension)) {
          handleSelectionOmission(omissions, {
            path: selectedFile.displayPath,
            reason: "excluded-extension",
            detail: "explicitly excluded by --exclude-ext",
          }, args.missingPolicy);
          return null;
        }
        if (resolvedOutputs.has(path.resolve(selectedFile.fullPath))) {
          handleSelectionOmission(omissions, {
            path: selectedFile.displayPath,
            reason: "output-file",
            detail: "candidate is an output path",
          }, args.missingPolicy);
          return null;
        }

        try {
          let sourceBuffer = await fs.readFile(selectedFile.fullPath);
          if (sourceBuffer.includes(0)) {
            let converted = false;
            if (selectedFile.displayPath.toLowerCase().endsWith(".pdf")) {
              try {
                // Convert PDF to text via stdout to avoid temporary files
                const { stdout } = await execFileAsync("pdftotext", [selectedFile.fullPath, "-"], { maxBuffer: 1024 * 1024 * 50, encoding: "buffer" });
                sourceBuffer = stdout;
                converted = true;
              } catch (err) {
                // Fall through to binary error if pdftotext is missing or fails
              }
            }
            if (!converted) {
              throw new Error(`Selected file is binary: ${selectedFile.displayPath}`);
            }
          }
          const content = decodeUtf8(sourceBuffer, selectedFile.displayPath);
          let outlineStatus: ContextFile["outlineStatus"] = "unavailable";
          let outlineReason: string | undefined;
          let symbols: ContextFile["symbols"] = [];
          const fileId = fileIds.get(selectedFile.displayPath);
          if (fileId === undefined) throw new Error(`Could not assign stable file ID: ${selectedFile.displayPath}`);

          if (workspace !== undefined && selectedFile.outlinePath !== undefined) {
            try {
              const result = await workspace.fileOutline({ path: selectedFile.outlinePath });
              if (!("outline" in result)) {
                outlineStatus = "refused";
                outlineReason = `${result.reason}: ${result.reasonDetail}`;
              } else if (result.reason === "UNSUPPORTED_LANGUAGE") {
                outlineStatus = "unsupported";
                outlineReason = result.reason;
              } else if (result.error !== undefined) {
                outlineStatus = "error";
                outlineReason = result.error;
              } else {
                outlineStatus = result.partial ? "partial" : "available";
                symbols = buildContextSymbols(fileId, result.outline, result.jumpTable);
              }
            } catch (error) {
              outlineStatus = "error";
              outlineReason = errorMessage(error);
              console.warn(`Warning: Could not outline ${selectedFile.displayPath}: ${outlineReason}`);
            }
          }

          sourceByFileId.set(fileId, sourceBuffer);
          return {
            id: fileId,
            path: selectedFile.displayPath,
            ...(languageFromPath(selectedFile.displayPath) === undefined
              ? {}
              : { language: languageFromPath(selectedFile.displayPath) }),
            content,
            sourceBytes: sourceBuffer.byteLength,
            sourceLines: sourceLineCount(content),
            sourceHash: sha256(sourceBuffer),
            projection: (args.options.lineNumbers ? "numbered" : "exact") as ContentRepresentation,
            projectionReason: (args.options.lineNumbers ? "citation-gutter" : "selected") as "selected" | "citation-gutter",
            outlineStatus,
            ...(outlineReason === undefined ? {} : { outlineReason }),
            symbols,
          };
        } catch (error) {
          const message = errorMessage(error);
          const omission: ContextOmission = {
            path: selectedFile.displayPath,
            reason: message.includes("binary")
              ? "selected-binary"
              : message.includes("valid UTF-8")
              ? "selected-invalid-utf8"
              : "processing-error",
            detail: message,
          };
          handleSelectionOmission(omissions, omission, args.missingPolicy);
          if (args.missingPolicy === "record") {
            console.warn(`Warning: Could not process ${selectedFile.displayPath}: ${errorMessage(error)}`);
          }
          return null;
        }
      }));

      for (const res of chunkResults) {
        if (res !== null) collected.push(res);
      }
    }
  }

  return { files: collected, omissions, sourceByFileId, resolvedCandidates };
}

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json does not contain a valid version");
  }
  return packageJson.version;
}


async function runMcp(): Promise<void> {
  const mcpServerPath = new URL("./mcp-server.js", import.meta.url).pathname;
  // Dynamic import the MCP server module
  await import(mcpServerPath);
}

async function runVerify(args: readonly string[]): Promise<void> {
  let json = false;
  let source: string | undefined;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-" ) && arg !== "-") throw new Error(`Unknown verify option: ${arg}`);
    else if (source === undefined) source = arg;
    else throw new Error("verify accepts exactly one packet path or - for stdin");
  }
  if (source === undefined) throw new Error("Usage: mktxt verify <packet.mktctx|-> [--json]");
  const packet = source === "-" ? await readStdinBytes() : await fs.readFile(path.resolve(source));
  const result = packet.subarray(0, CONTEXT_V5_PROTOCOL.length + 1)
    .equals(Buffer.from(`${CONTEXT_V5_PROTOCOL}\n`))
    ? verifyContextV5(packet)
    : verifyContextV4(packet);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Verified ${result.protocol} ${result.packetId}`);
  console.log(`  envelope: ${result.envelopeSha256}`);
  console.log(`  manifest: ${result.manifestSha256} (recomputed canonical JSON)`);
  console.log(`  packet estimate: ${result.packetEstimatedTokens} tokens (${"utf8-bytes-div-4-v1"})`);
  console.log(`  files: ${result.filesDeclared} declared, ${result.exactFilesVerified} exact,` +
    ` ${result.aliasesVerified} aliases, ${result.projectedFilesVerified} non-exact projections`);
  if ("missingPolicy" in result) {
    console.log(`  selection: complete=${result.selectionComplete} missing_policy=${result.missingPolicy}` +
      ` policy_compliant=${result.policyCompliant} diagnostics=${result.diagnostics.length}`);
  }
  console.log(`  checks: ${result.checks.join(", ")}`);
}

async function readStdinBytes(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function resolveManifestFiles(
  root: string,
  manifestPaths: readonly string[],
  missingPolicy: V5MissingPolicy,
): Promise<ResolvedSelection> {
  const files: SelectedFile[] = [];
  const omissions: ContextOmission[] = [];
  const requestedPaths: string[] = [];
  const seenLexical = new Set<string>();
  const seenCanonical = new Set<string>();
  const canonicalRoot = await fs.realpath(root);

  for (const manifestPath of manifestPaths) {
    const resolvedPath = path.resolve(root, manifestPath);
    const lexicalKey = normalizePath(path.normalize(resolvedPath));
    if (seenLexical.has(lexicalKey)) continue;
    seenLexical.add(lexicalKey);
    const redactedPath = redactRequestedPath(canonicalRoot, resolvedPath);
    let canonicalPath: string;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      canonicalPath = await fs.realpath(resolvedPath);
      stat = await fs.stat(canonicalPath);
    } catch {
      requestedPaths.push(redactedPath);
      handleSelectionOmission(omissions, {
        path: redactedPath,
        reason: "selected-missing",
        detail: `Selected path does not exist: ${manifestPath}`,
      }, missingPolicy);
      console.warn(`Warning: Skipping missing piped path: ${manifestPath}`);
      continue;
    }
    if (seenCanonical.has(canonicalPath)) continue;
    seenCanonical.add(canonicalPath);
    const relativePath = path.relative(canonicalRoot, canonicalPath);
    const isInsideRoot = relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath);
    const normalizedRelativePath = normalizePath(relativePath);
    const displayPath = isInsideRoot
      ? normalizedRelativePath
      : `external/${sha256(canonicalPath).slice(0, 8)}/${path.basename(canonicalPath)}`;
    requestedPaths.push(displayPath);
    if (!stat.isFile()) {
      handleSelectionOmission(omissions, {
        path: displayPath,
        reason: "selected-not-file",
        detail: `Selected path is not a file: ${manifestPath}`,
      }, missingPolicy);
      console.warn(`Warning: Skipping non-file piped path: ${manifestPath}`);
      continue;
    }
    files.push({
      fullPath: canonicalPath,
      displayPath,
      ...(isInsideRoot ? { outlinePath: normalizedRelativePath } : {}),
    });
  }
  return { files, omissions, requestedPaths };
}

function handleSelectionOmission(
  omissions: ContextOmission[],
  omission: ContextOmission,
  policy: V5MissingPolicy,
): void {
  if (policy === "error") {
    const diagnostic = diagnosticForV5Omission(omission, policy);
    throw new Error(
      `Selection diagnostic severity=${diagnostic.severity} code=${diagnostic.code}` +
      ` path=${JSON.stringify(diagnostic.path)} reason=${diagnostic.reason}` +
      (diagnostic.detail === undefined ? "" : ` detail=${JSON.stringify(diagnostic.detail)}`),
    );
  }
  omissions.push(omission);
}

function redactRequestedPath(root: string, resolvedPath: string): string {
  const relativePath = path.relative(root, resolvedPath);
  const isInsideRoot = relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);
  return isInsideRoot
    ? normalizePath(relativePath)
    : `external/${sha256(resolvedPath).slice(0, 8)}/${path.basename(resolvedPath) || "path"}`;
}

async function readImplicitStdinPaths(invocationCwd: string): Promise<string[] | undefined> {
  if (process.stdin.isTTY) return undefined;
  const paths = await readPathManifest("-", invocationCwd);
  return paths.length === 0 ? undefined : paths;
}

async function assertManifestDoesNotContainOutputs(
  files: readonly SelectedFile[],
  outputs: readonly string[],
): Promise<void> {
  const canonicalOutputs = await Promise.all(outputs.map(async (output) => {
    try {
      return await fs.realpath(output);
    } catch {
      return path.resolve(output);
    }
  }));
  const outputPaths = new Set(canonicalOutputs);
  const selectedOutput = files.find((file) => outputPaths.has(file.fullPath));
  if (selectedOutput !== undefined) {
    throw new Error(`Path manifest cannot include an output file: ${selectedOutput.displayPath}`);
  }
}

function normalizeExt(extension: string): string {
  return extension.startsWith(".") ? extension.slice(1) : extension;
}

function getFiles(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd,
      maxBuffer: 128 * 1024 * 1024,
    });
    return output.toString().split("\0").filter((file) => file.length > 0);
  } catch {
    return [];
  }
}

function isTestFile(file: string): boolean {
  const testPatterns = [
    /_test\./, /\.test\./, /\.spec\./, /test_/, /test\./,
    /Test\./, /Tests\./, /Spec\./, /_spec\./,
    /^test\//, /^tests\//, /\/__tests__\//, /\/__snapshots__\//,
  ];
  return testPatterns.some((pattern) => pattern.test(file));
}

function decodeUtf8(source: Uint8Array, displayPath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    throw new Error(`Selected file is not valid UTF-8: ${displayPath}`);
  }
}

async function readUtf8File(filePath: string, displayPath: string): Promise<string> {
  let source: Uint8Array;
  try {
    source = await fs.readFile(filePath);
  } catch {
    throw new Error(`Task file does not exist: ${displayPath}`);
  }
  return decodeUtf8(source, displayPath);
}

async function rotatePreviousOutput(output: string, previous: string): Promise<void> {
  try {
    await fs.access(output);
    await fs.rename(output, previous);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function printHelp(): void {
  console.log(`Usage: mktxt [directories...] [options]
       mktxt verify <packet.mktctx|-> [--json]

Aggregate selected UTF-8 source files for humans or language models.

Options:
  --cwd=DIR                 Add a source directory
  --files-from=PATH|-       Package exactly the listed paths
                            Non-empty piped stdin is detected automatically
  --include-ext=EXT         Include only an extension (repeatable)
  --exclude-ext=EXT         Exclude an extension (repeatable)
  --no-tests                Exclude common test paths during discovery
  --out=NAME                Override the output basename
  --format=context-v5       Emit the ${CONTEXT_V5_PROTOCOL} context protocol (default)
  --format=context-v4       Emit the historical ${CONTEXT_V4_PROTOCOL} protocol
  --format=context-v3       Emit the historical ${CONTEXT_PROTOCOL} protocol
  --format=legacy           Emit the original aggregate and sidecars
  --profile=exact-selection Exact selected valid UTF-8 bytes (default)
  --profile=review          Exact changes and neighbors; structural remainder
  --profile=structure       Outlines and identities without source bodies
  --symbols=useful|full|none
                            Select derived symbol detail (default: useful)
  --budget-tokens=N         Apply the declared bytes-div-4 heuristic budget
  --missing=error|record    Fail before output or record structured diagnostics
                            Defaults: error for --files-from; record otherwise
  --git-diff=REF            Capture Git provenance and review REF..working-tree
  --line-numbers            Emit a numbered citation view instead of exact chunks
  --task=TEXT               Append one optional instruction after context data
  --task-file=PATH          Read the task from a UTF-8 file
  --emit-manifest           Emit <basename>.manifest.json with a context format
  --emit-sidecars           Emit derived TOC, symbol CSV, previous file, and diff
  -V, --version             Print the installed version
  -h, --help                Show this help`);
}

main().catch((error) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});
