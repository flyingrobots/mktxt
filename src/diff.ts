import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";

export async function generateUnifiedDiff(
  previous: string,
  output: string,
  diffOutput: string,
): Promise<void> {
  try {
    await fs.access(previous);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await fs.writeFile(diffOutput, "", "utf8");
      return;
    }
    throw error;
  }

  const diffHandle = await fs.open(diffOutput, "w");
  let stderr = "";
  try {
    const child = spawn("diff", ["-u", previous, output], {
      stdio: ["ignore", diffHandle.fd, "pipe"],
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk;
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (status !== 0 && status !== 1) {
      throw new Error(`diff failed with status ${status}: ${stderr}`);
    }
  } finally {
    await diffHandle.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
