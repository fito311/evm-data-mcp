/**
 * 47620 EVM Data — REMOTE MCP server (Streamable HTTP) for agents.
 *
 * Mounts an MCP server over HTTP for Base + Polygon onchain data so any
 * MCP-capable agent can connect by URL — no local install:
 *
 *     https://47620.xyz/mcp/evm      (Streamable HTTP transport)
 *
 * The 18 tools mirror the pay-per-call Base/Polygon Data API. When a tool is
 * called and the endpoint answers HTTP 402, the tool returns the x402 challenge
 * (which advertises USDC on Solana, Base and Polygon) plus the pay URL. The
 * agent (or its x402-aware runtime) completes payment non-custodially.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const BASE = (process.env.X402_PUBLIC_BASE || "https://47620.xyz").replace(/\/$/, "");
const PAY_URL = process.env.MCP_X402_PAY_URL || "";

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  path: string | ((a: Record<string, string>) => string);
};

function chainTools(chain: "base" | "polygon"): Tool[] {
  const P = `/x/${chain}-fac`;
  return [
    {
      name: `${chain}_health`,
      description: `${chain} network health: chain id, latest block, gas price, native token USD price. Cheapest call. Pay-per-call ($0.002 USDC).`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      path: `${P}/health`,
    },
    {
      name: `${chain}_block`,
      description: `Header + summary for a ${chain} block by number (or "latest"): hash, timestamp, tx count, gas used, base fee. Pay-per-call ($0.005 USDC).`,
      inputSchema: {
        type: "object",
        properties: { number: { type: "string", description: 'Block number or "latest"' } },
        additionalProperties: false,
      },
      path: (a) => `${P}/block/${encodeURIComponent(a.number || "latest")}`,
    },
    {
      name: `${chain}_balance`,
      description: `Native balance + live USD value for any ${chain} address. Pay-per-call ($0.005 USDC).`,
      inputSchema: {
        type: "object",
        properties: { address: { type: "string", description: `${chain} address (0x...)` } },
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
      description: `Live price, liquidity, 24h volume + DEX pairs for any ${chain} ERC-20 token (plus onchain name/symbol/decimals). Pay-per-call ($0.02 USDC).`,
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
      description: `Status (success/reverted), block, gas + transfer summary for a ${chain} tx hash. Pay-per-call ($0.01 USDC).`,
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
      description: `Whether a ${chain} address is a contract, bytecode size + ERC-20 metadata. Pay-per-call ($0.01 USDC).`,
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
      description: `Current ${chain} gas price (gwei + wei) + estimated cost of a 21k native transfer. Pay-per-call ($0.005 USDC).`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      path: `${P}/gas`,
    },
    {
      name: `${chain}_trending`,
      description: `Trending ${chain} DEX pairs by 24h volume (DexScreener boosts). Fresh feed for agents. Pay-per-call ($0.02 USDC).`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      path: `${P}/trending`,
    },
  ];
}

const TOOLS: Tool[] = [...chainTools("base"), ...chainTools("polygon")];
const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

async function readChallenge(res: Response) {
  const hdr = res.headers.get("payment-required") || res.headers.get("x-payment-required");
  if (hdr) {
    try { return JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); } catch { /* fall through */ }
  }
  try { return await res.json(); } catch { return null; }
}

async function payViaBroker(url: string, challenge: unknown) {
  const r = await fetch(PAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, challenge }),
  });
  const j = (await r.json()) as { header?: string };
  if (!j || !j.header) throw new Error("pay broker did not return a payment header");
  return j.header;
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return t; }
}

async function paidCall(tool: Tool, args: Record<string, string>) {
  const path = typeof tool.path === "function" ? tool.path(args) : tool.path;
  const url = BASE + path;
  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (res.status !== 402) {
    return { url, status: res.status, data: safeJson(await res.text()) };
  }

  const challenge = (await readChallenge(res)) as any;
  const a0 = challenge?.accepts?.[0];
  const price = a0?.maxAmountRequired || a0?.amount;

  if (!PAY_URL) {
    return {
      url,
      status: 402,
      payment_required: true,
      price_atomic: price || null,
      networks_offered: (challenge?.accepts || []).map((a: any) => a.network),
      payTo: a0?.payTo || null,
      asset: a0?.asset || null,
      pay: `x402 (HTTP 402): pay ${url} in USDC on Solana, Base or Polygon.`,
      challenge,
    };
  }

  let header: string;
  try {
    header = await payViaBroker(url, challenge);
  } catch (e) {
    return { url, status: 402, payment_required: true, error: `payment failed: ${(e as Error).message}`, price_atomic: price || null };
  }

  const retry = await fetch(url, {
    headers: { Accept: "application/json", "PAYMENT-SIGNATURE": header, "X-PAYMENT": header },
  });
  return { url, status: retry.status, data: safeJson(await retry.text()) };
}

function buildServer() {
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
    const out = await paidCall(tool, (req.params.arguments as Record<string, string>) || {});
    return {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      isError: out.status >= 400 && !(out as any).payment_required,
    };
  });
  return server;
}

/** Register the remote EVM MCP routes on the Fastify app. */
export async function registerMcpEvmRoutes(app: FastifyInstance) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport as StreamableHTTPServerTransport);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await buildServer().connect(transport);
    }
    reply.hijack();
    await transport.handleRequest(
      req.raw as unknown as IncomingMessage,
      reply.raw as unknown as ServerResponse,
      req.body
    );
  };

  app.post("/mcp/evm", handle);
  app.get("/mcp/evm", async (req, reply) => {
    const accept = String(req.headers["accept"] || "");
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId && !accept.includes("text/event-stream")) {
      reply.header("Cache-Control", "public, max-age=300");
      return evmManifest();
    }
    return handle(req, reply);
  });
  app.delete("/mcp/evm", handle);

  app.get("/mcp/evm/server-card", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return {
      name: "47620-evm-data",
      description: "Pay-per-call Base + Polygon onchain data for AI agents over x402.",
      transport: { type: "streamable-http", url: `${BASE}/mcp/evm` },
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    };
  });
}

function evmManifest() {
  return {
    name: "47620-evm-data",
    description:
      "Pay-per-call Base + Polygon onchain data for AI agents over x402. 18 tools: health, block, balance, stables, token, tx, contract, gas, trending (per chain).",
    version: "1.0.0",
    repository: "https://github.com/fito311/evm-data-mcp",
    transports: {
      "streamable-http": { url: `${BASE}/mcp/evm` },
      stdio: { install: "npx -y 47620-evm-mcp" },
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  };
}
