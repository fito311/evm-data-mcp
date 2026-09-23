#!/usr/bin/env node
/**
 * 47620 EVM Data — MCP server (stdio).
 *
 * Gives any MCP-capable AI agent native access to 47620's pay-per-call Base and
 * Polygon onchain data endpoints. Each tool call is an x402 (HTTP 402) paid
 * request settled in USDC on Solana, Base or Polygon — whichever the caller
 * supports. Non-custodial.
 *
 * Set X402_PAY_URL to a pay broker to pay automatically; otherwise the tool
 * returns the 402 challenge and instructions.
 *
 * Hosted remote (Streamable HTTP): https://47620.xyz/mcp/evm
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./core.js";

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
