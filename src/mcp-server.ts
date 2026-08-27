import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

const server = new Server(
  {
    name: "mktxt-mcp",
    version: "5.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generate_context",
        description: "Generate a deterministic MKTCTX/5 codebase context packet for a specified directory. Returns the absolute path to the generated context file.",
        inputSchema: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "The absolute path to the repository directory to bundle.",
            },
            profile: {
              type: "string",
              enum: ["exact-selection", "review", "structure"],
              description: "The projection profile to use (default: exact-selection).",
            },
            gitDiff: {
              type: "string",
              description: "A git ref (e.g., origin/main) to generate a review packet of the diff.",
            },
          },
          required: ["cwd"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "generate_context") {
    const args = request.params.arguments as any;
    const cwd = args.cwd;
    const profile = args.profile || "exact-selection";
    
    const cliArgs = [
      path.join(import.meta.dirname, "index.js"),
      `--cwd=${cwd}`,
      `--profile=${profile}`,
      `--out=mcp-generated-context`
    ];

    if (args.gitDiff) {
      cliArgs.push(`--git-diff=${args.gitDiff}`);
    }

    try {
      await execFileAsync(process.execPath, cliArgs, { cwd });
      const outputPath = path.join(cwd, "mcp-generated-context.txt");
      
      // Verify file was created
      const stat = await fs.stat(outputPath);
      
      return {
        content: [
          {
            type: "text",
            text: `Success. Context packet generated at: ${outputPath} (${stat.size} bytes). Use a file reader tool to consume this payload.`
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to generate context: ${err.message || err.toString()}\n\n${err.stderr || ""}`
          }
        ]
      };
    }
  }

  throw new Error("Tool not found");
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch(console.error);
