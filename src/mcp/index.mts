#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMakeTasksServer } from './server.mjs';

void serveStdio(() => createMakeTasksServer());
console.error('Make Run Tasks MCP server is listening on stdio.');
