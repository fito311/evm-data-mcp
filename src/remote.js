#!/usr/bin/env node
/**
 * 47620 EVM Data — remote MCP server (Streamable HTTP), standalone.
 *
 * Standalone:  PORT=8789 node src/remote.js   →  http://127.0.0.1:8789/mcp
 * In production it is mounted at https://47620.xyz/mcp/evm by the API service.
 */
import express from "express";
import { createRemoteMcpRouter } from "./core.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/mcp", await createRemoteMcpRouter());
const port = Number(process.env.PORT || 8789);
app.listen(port, () => console.log(`47620 EVM remote MCP on :${port}/mcp`));
