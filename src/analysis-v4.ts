import * as path from "node:path";
import {
  decodeValidUtf8,
  estimateTokens,
  type ContextProfile,
  type SymbolPolicy,
  type V4Edge,
  type V4File,
  type V4Projection,
  type V4ProjectionReason,
  type V4Symbol,
} from "./context-v4.js";

const CODE_LANGUAGES = new Set([
  "typescript", "javascript", "python", "rust", "go", "java", "kotlin", "swift", "ruby",
  "c", "cpp", "csharp", "shell", "sql", "graphql",
]);
const STRUCTURED_LANGUAGES = new Set(["json", "jsonl", "yaml", "toml"]);
const MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

export interface EdgeAnalysis {
  readonly status: "partial" | "unavailable";
  readonly reason: string;
  readonly edges: readonly V4Edge[];
}

export interface ProjectionOptions {
  readonly profile: ContextProfile;
  readonly tokenBudget?: number;
  readonly changedPaths?: ReadonlySet<string>;
  readonly numbered?: boolean;
}

export function selectSymbols(
  symbols: readonly V4Symbol[],
  language: string | undefined,
  policy: SymbolPolicy,
): V4Symbol[] {
  if (policy === "none") return [];
  if (policy === "full") return [...symbols];
  const selected = symbols.filter((symbol) => {
    if (symbol.startLine === undefined || symbol.endLine === undefined) return false;
    if (STRUCTURED_LANGUAGES.has(language ?? "")) return symbol.depth <= 1;
    if (language === "markdown") return symbol.depth <= 2;
    if (CODE_LANGUAGES.has(language ?? "")) return true;
    return symbol.depth === 0;
  });
  return repairParentLinks(selected);
}

export function analyzeModuleEdges(files: readonly V4File[]): EdgeAnalysis {
  const byPath = new Map(files.map((file) => [normalize(file.path), file]));
  const edges: V4Edge[] = [];
  const seen = new Set<string>();
  let analyzable = 0;
  for (const file of files) {
    if (file.language !== "typescript" && file.language !== "javascript") continue;
    analyzable += 1;
    const text = decodeValidUtf8(file.source, file.path);
    for (const extracted of extractModuleSpecifiers(text)) {
      const resolved = resolveSpecifier(file.path, extracted.specifier, byPath);
      const edge: V4Edge = {
        fromFileId: file.id,
        ...(resolved.file === undefined ? {} : { toFileId: resolved.file.id }),
        specifier: extracted.specifier,
        kind: extracted.kind,
        resolution: resolved.resolution,
        confidence: resolved.file === undefined ? "syntax" : "resolved",
        ...(extracted.symbols.length === 0 ? {} : { symbols: extracted.symbols }),
      };
      const key = JSON.stringify(edge);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }
  if (analyzable === 0) {
    return { status: "unavailable", reason: "no supported JavaScript or TypeScript files", edges: [] };
  }
  return {
    status: "partial",
    reason: "syntax extraction with selected-file relative resolution; package and tsconfig resolution unavailable",
    edges,
  };
}

export function applyProjectionProfile(
  files: readonly V4File[],
  edges: readonly V4Edge[],
  options: ProjectionOptions,
): V4File[] {
  const changedIds = new Set(files.filter((file) => options.changedPaths?.has(file.path)).map((file) => file.id));
  const distances = options.changedPaths === undefined
    ? new Map(files.map((file) => [file.id, 0]))
    : graphDistances(files, edges, changedIds);
  let remaining = options.tokenBudget ?? Number.POSITIVE_INFINITY;
  const ranked = files.map((file, index) => ({ file, index, distance: distances.get(file.id) ?? Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  const projections = new Map<string, { kind: V4Projection; reason: V4ProjectionReason }>();

  for (const { file, distance } of ranked) {
    let kind: V4Projection;
    let reason: V4ProjectionReason;
    if (options.profile === "structure") {
      kind = file.symbols.length > 0 ? "outline" : "reference";
      reason = "structure-profile";
    } else if (options.profile === "review") {
      if (distance === 0) {
        kind = options.numbered ? "numbered" : "exact";
        reason = options.numbered ? "citation-gutter" : "changed";
      } else if (distance === 1) {
        kind = options.numbered ? "numbered" : "exact";
        reason = options.numbered ? "citation-gutter" : "dependency-neighbor";
      } else if (distance === 2 && file.symbols.length > 0) {
        kind = "signatures";
        reason = "budget";
      } else {
        kind = file.symbols.length > 0 ? "outline" : "reference";
        reason = "budget";
      }
    } else {
      kind = options.numbered ? "numbered" : "exact";
      reason = options.numbered ? "citation-gutter" : "selected";
    }

    const exactCost = estimateTokens(file.source.byteLength);
    if ((kind === "exact" || kind === "numbered") && Number.isFinite(remaining)) {
      const requiredChanged = options.profile === "review" && distance === 0;
      if (!requiredChanged && exactCost > remaining) {
        kind = file.symbols.length > 0 ? "signatures" : "reference";
        reason = "budget";
      } else {
        remaining -= exactCost;
      }
    }
    projections.set(file.id, { kind, reason });
  }

  return files.map((file) => {
    const projection = projections.get(file.id)!;
    const symbols = projection.kind === "reference"
      ? []
      : projection.kind === "signatures"
      ? repairParentLinks(file.symbols.filter((symbol) => symbol.depth === 0 || symbol.exported))
      : [...file.symbols];
    const structuralBytes = Buffer.byteLength(symbols.map((symbol) =>
      `${symbol.kind} ${symbol.name} ${symbol.signature ?? ""}\n`).join(""), "utf8");
    const estimatedTokens = projection.kind === "exact" || projection.kind === "numbered"
      ? estimateTokens(file.source.byteLength)
      : estimateTokens(structuralBytes);
    return {
      ...file,
      projection: projection.kind,
      projectionReason: projection.reason,
      symbols,
      estimatedTokens,
    };
  });
}

export function applyV4Aliases(files: readonly V4File[]): V4File[] {
  const canonicalByHash = new Map<string, string>();
  return files.map((file) => {
    if (file.projection !== "exact") return file;
    const canonical = canonicalByHash.get(file.sourceHash);
    if (canonical === undefined) {
      canonicalByHash.set(file.sourceHash, file.id);
      return file;
    }
    return {
      ...file,
      projection: "alias",
      projectionReason: "identical-sha256",
      canonicalFileId: canonical,
      symbols: [],
      estimatedTokens: 0,
    };
  });
}

function repairParentLinks(symbols: readonly V4Symbol[]): V4Symbol[] {
  const retained = new Set(symbols.map((symbol) => symbol.id));
  return symbols.map((symbol) => ({
    ...symbol,
    ...(symbol.parentId !== undefined && retained.has(symbol.parentId) ? { parentId: symbol.parentId } : { parentId: undefined }),
  }));
}

function graphDistances(
  files: readonly V4File[],
  edges: readonly V4Edge[],
  seeds: ReadonlySet<string>,
): Map<string, number> {
  if (seeds.size === 0) return new Map();
  const adjacency = new Map(files.map((file) => [file.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.toFileId === undefined) continue;
    adjacency.get(edge.fromFileId)?.add(edge.toFileId);
    adjacency.get(edge.toFileId)?.add(edge.fromFileId);
  }
  const distances = new Map<string, number>();
  const queue = [...seeds];
  for (const seed of seeds) distances.set(seed, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const distance = distances.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

function extractModuleSpecifiers(text: string): Array<{
  kind: V4Edge["kind"];
  specifier: string;
  symbols: string[];
}> {
  const found: Array<{ kind: V4Edge["kind"]; specifier: string; symbols: string[] }> = [];
  const staticPattern = /\b(import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(text)) !== null) {
    found.push({
      kind: match[1] === "export" ? "re-export" : "import",
      specifier: match[3],
      symbols: extractImportedSymbols(match[2]),
    });
  }
  const sideEffectPattern = /\bimport\s+["']([^"']+)["']/g;
  while ((match = sideEffectPattern.exec(text)) !== null) {
    found.push({ kind: "import", specifier: match[1], symbols: [] });
  }
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicPattern.exec(text)) !== null) {
    found.push({ kind: "dynamic-import", specifier: match[1], symbols: [] });
  }
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requirePattern.exec(text)) !== null) {
    found.push({ kind: "require", specifier: match[1], symbols: [] });
  }
  return found;
}

function extractImportedSymbols(clause: string): string[] {
  const braces = /\{([^}]+)\}/.exec(clause);
  if (braces === null) return [];
  return braces[1].split(",").map((entry) => entry.trim().split(/\s+as\s+/)[0]).filter(Boolean);
}

function resolveSpecifier(
  fromPath: string,
  specifier: string,
  files: ReadonlyMap<string, V4File>,
): { resolution: V4Edge["resolution"]; file?: V4File } {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return { resolution: "external" };
  const clean = specifier.replace(/[?#].*$/, "");
  const base = normalize(path.posix.resolve(path.posix.dirname(`/${normalize(fromPath)}`), clean).slice(1));
  const candidates = new Set<string>([base]);
  const extension = path.posix.extname(base);
  if (extension !== "") {
    const stem = base.slice(0, -extension.length);
    for (const candidateExtension of MODULE_EXTENSIONS) candidates.add(`${stem}${candidateExtension}`);
  } else {
    for (const candidateExtension of MODULE_EXTENSIONS) {
      candidates.add(`${base}${candidateExtension}`);
      candidates.add(`${base}/index${candidateExtension}`);
    }
  }
  for (const candidate of candidates) {
    const file = files.get(candidate);
    if (file !== undefined) return { resolution: "resolved", file };
  }
  return { resolution: "unresolved" };
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
