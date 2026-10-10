import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { listMakeTargets } from './target-service.mjs';

const packageVersion = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

const targetSchema = z.object({
  name: z.string(),
  description: z.string(),
  usage: z.string().optional(),
  category: z.string().optional(),
  line: z.number().int().nonnegative(),
});

const resultSchema = z.object({
  makefile: z.string(),
  targets: z.array(targetSchema),
});

export function createMakeTasksServer(
  root: string = process.env.MAKE_TASKS_MCP_ROOT ?? process.cwd(),
): McpServer {
  const server = new McpServer({
    name: 'make-run-tasks',
    version: packageVersion,
  });

  server.registerTool(
    'list_make_targets',
    {
      title: 'List documented Make targets',
      description: 'Parse one Makefile and return its documented targets without executing Make.',
      inputSchema: z.object({
        makefile: z.string().min(1).default('Makefile').describe('Workspace-relative path to a Makefile.'),
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ makefile }) => {
      try {
        const result = await listMakeTargets(root, makefile);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: `Unable to list Make targets: ${message}` }],
        };
      }
    },
  );

  return server;
}
