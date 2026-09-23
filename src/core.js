/**
 * 47620 EVM Data — shared MCP core (Base + Polygon).
 *
 * Exposes pay-per-call EVM (Base + Polygon) onchain data as MCP tools. Each tool
 * call is an x402 (HTTP 402) paid request settled in USDC on Solana, Base or
 * Polygon — whichever the caller's wallet supports. Non-custodial.
 *
 * Payment modes (auto-detected, first available wins):
 *   1. X402_PAY_URL   — an HTTP "pay broker": given {url, challenge} returns a
 *                       payment header. Use this from the hosted server.
 *   2. none           — returns the 402 challenge plus a ready-to-run pay command.
 *
 * Hosted remote (Streamable HTTP): https://47620.xyz/mcp/evm
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

const BASE = (process.env.X402_BASE_URL || "https://47620.xyz").replace(/\/$/, "");
const PAY_URL = process.env.X402_PAY_URL || "";

const CHAINS = ["base", "polygon"];

function chainTools(chain) {
  const P = `/x/${chain}`;
  return [
    {
      name: `${chain}_health`,
      description: `${chain} network health: chain id, latest block, gas price and native token USD price. Pay-per-call ($0.002 USDC).`,
      inputSchema: { type: "object", properties: { fields: { type: "string", description: "Optional comma-separated subset of fields to return" } }, additionalProperties: false },
      path: () => `${P}/health`,
    },
    {
      name: `${chain}_block`,
      description: `Header + summary for a ${chain} block by number (or "latest"): hash, timestamp, tx count, gas used, base fee. Pay-per-call ($0.005 USDC).`,
      inputSchema: {
        type: "object",
        properties: { number: { type: "string", description: 'Block number or "latest"' }, fields: { type: "string" } },
        additionalProperties: false,
      },
      path: (a) => `${P}/block/${encodeURIComponent(a.number || "latest")}`,
    },
    {
      name: `${chain}_balance`,
      description: `Native balance and live USD value for any ${chain} address. Pay-per-call ($0.005 USDC).`,
      inputSchema: {
        type: "object",
        properties: { address: { type: "string", description: `${chain} address (0x...)` }, fields: { type: "string" } },
        required: ["address"],
        additionalProperties: false,
      },
      path: (a) => `${P}/balance/${encodeURIComponent(a.address)}`,
    },
    {
      name: `${chain}_stables`,
      description: `USDC/USDT/DAI balances for a ${chain} address in one call. Pay-per-call ($0.01 USDC).`,
      inputSchema: {
        type: "object",
        properties: { address: { type: "string", description: `${chain} address (0x...)` } },
        required: ["address"],
        additionalProperties: false,
      },
      path: (a) => `${P}/stables/${encodeURIComponent(a.address)}`,
    },
    {
      name: `${chain}_token`,
      description: `Live price, liquidity, 24h volume and DEX pairs for any ${chain} ERC-20 token (plus onchain name/symbol/decimals). Pay-per-call ($0.02 USDC).`,
      inputSchema: {
        type: "object",
        properties: { token: { type: "string", description: `${chain} ERC-20 token address` } },
        required: ["token"],
        additionalProperties: false,
      },
      path: (a) => `${P}/token/${encodeURIComponent(a.token)}`,
    },
    {
      name: `${chain}_tx`,
      description: `Status, block, gas and transfer summary for a ${chain} transaction hash. Pay-per-call ($0.01 USDC).`,
      inputSchema: {
        type: "object",
        properties: { hash: { type: "string", description: "Transaction hash (0x...)" } },
        required: ["hash"],
        additionalProperties: false,
      },
      path: (a) => `${P}/tx/${encodeURIComponent(a.hash)}`,
    },
    {
      name: `${chain}_contract`,
      description: `Whether a ${chain} address is a contract, bytecode size, and ERC-20 metadata if applicable. Pay-per-call ($0.01 USDC).`,
      inputSchema: {
        type: "object",
        properties: { address: { type: "string", description: `${chain} address (0x...)` } },
        required: ["address"],
        additionalProperties: false,
      },
      path: (a) => `${P}/contract/${encodeURIComponent(a.address)}`,
    },
    {
      name: `${chain}_gas`,
      description: `Current ${chain} gas price (gwei + wei) and estimated cost of a 21k native transfer. Pay-per-call ($0.005 USDC).`,
      inputSchema: { type: "object", properties: { fields: { type: "string" } }, additionalProperties: false },
      path: () => `${P}/gas`,
    },
    {
      name: `${chain}_trending`,
      description: `Trending ${chain} DEX pairs by 24h volume (DexScreener boosts). Fresh feed for agents. Pay-per-call ($0.02 USDC).`,
      inputSchema: { type: "object", properties: { fields: { type: "string" } }, additionalProperties: false },
      path: () => `${P}/trending`,
    },
  ];
}

export const TOOLS = CHAINS.flatMap(chainTools);
const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

async function readChallenge(res) {
  const hdr = res.headers.get("payment-required") || res.headers.get("x-payment-required");
  if (hdr) {
    try { return JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); } catch { /* fall through */ }
  }
  try { return await res.json(); } catch { return null; }
}

async function payViaBroker(url, challenge) {
  const r = await fetch(PAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, challenge }),
  });
  const j = await r.json();
  if (!j || !j.header) throw new Error("pay broker did not return a payment header");
  return j.header;
}

function safeJson(t) {
  try { return JSON.parse(t); } catch { return t; }
}

export async function paidCall(tool, args) {
  const path = typeof tool.path === "function" ? tool.path(args) : tool.path;
  const qs = args.fields ? `?fields=${encodeURIComponent(args.fields)}` : "";
  const url = BASE + path + qs;
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (res.status !== 402) {
    const text = await res.text();
    return { url, status: res.status, data: safeJson(text) };
  }

  const challenge = await readChallenge(res);
  const a0 = challenge?.accepts?.[0];
  const price = a0?.maxAmountRequired || a0?.amount;

  if (!PAY_URL) {
    return {
      url,
      status: 402,
      payment_required: true,
      price_atomic: price || null,
      network: a0?.network || null,
      payTo: a0?.payTo || null,
      asset: a0?.asset || null,
      networks_offered: (challenge?.accepts || []).map((a) => a.network),
      how_to_pay: [
        `Pay this URL over x402 (HTTP 402) with a USDC-capable x402 client.`,
        `Set X402_PAY_URL (pay broker) in this MCP server's env to pay automatically.`,
      ],
      challenge,
    };
  }

  let header;
  try {
    header = await payViaBroker(url, challenge);
  } catch (e) {
    return { url, status: 402, payment_required: true, error: `payment failed: ${e.message}`, price_atomic: price || null };
  }

  const retry = await fetch(url, { headers: { Accept: "application/json", "PAYMENT-SIGNATURE": header, "X-PAYMENT": header } });
  const text = await retry.text();
  return { url, status: retry.status, data: safeJson(text) };
}

export function buildServer() {
  const server = new Server(
    { name: "47620-evm-data", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName[req.params.name];
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    const out = await paidCall(tool, req.params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: out.status >= 400 && !out.payment_required };
  });
  return server;
}

export async function createRemoteMcpRouter() {
  const { Router } = await import("express");
  const router = Router();
  const transports = new Map();
  const handle = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => transports.set(sid, transport),
      });
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
      await buildServer().connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  };
  router.post("/", handle);
  router.get("/", handle);
  router.delete("/", handle);
  router.get("/.well-known/mcp", (_req, res) => {
    res.json({
      name: "47620-evm-data",
      description: "Pay-per-call Base + Polygon onchain data for AI agents over x402.",
      transport: { type: "streamable-http", url: `${BASE}/mcp/evm` },
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  });
  return router;
}
