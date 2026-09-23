# 47620 Base + Polygon Data API — MCP server

[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![x402](https://img.shields.io/badge/payments-x402-purple)](https://x402.org)

Pay-per-call **Base** and **Polygon** onchain data for AI agents. No signup, no API
key — every call is an [x402](https://x402.org) (HTTP 402) request settled in **USDC**,
non-custodially. Pay on **Solana, Base or Polygon** — whichever your wallet supports.

## Tools (18)

Per chain (`base_*`, `polygon_*`):

| Tool | Price | What it returns |
|---|---|---|
| `{chain}_health` | $0.002 | chain id, latest block, gas price, native USD price |
| `{chain}_block` | $0.005 | block header + summary (hash, txs, gas, base fee) |
| `{chain}_balance` | $0.005 | native balance + live USD value |
| `{chain}_stables` | $0.01 | USDC / USDT / DAI balances in one call |
| `{chain}_token` | $0.02 | price, liquidity, 24h volume, DEX pairs, ERC-20 metadata |
| `{chain}_tx` | $0.01 | status, block, gas, from/to/value |
| `{chain}_contract` | $0.01 | is-contract, bytecode size, ERC-20 metadata |
| `{chain}_gas` | $0.005 | gas price (gwei/wei) + 21k transfer cost |
| `{chain}_trending` | $0.02 | trending DEX pairs by 24h volume |

## Use it (remote — no install)

Connect any MCP client to:

```
https://47620.xyz/mcp/evm
```

Streamable HTTP transport. Tool calls return the x402 challenge; an x402-capable
runtime completes the USDC payment and retries. Works with Claude, Cursor,
OpenClaw, Windsurf and any MCP-capable agent.

## Use it (local, stdio)

```bash
npx -y 47620-evm-mcp
```

Claude Desktop / Cursor config:

```json
{
  "mcpServers": {
    "47620-evm-data": {
      "command": "npx",
      "args": ["-y", "47620-evm-mcp"],
      "env": { "X402_PAY_URL": "https://your-pay-broker.example/pay" }
    }
  }
}
```

- `X402_PAY_URL` (optional): an HTTP pay broker that, given `{url, challenge}`,
  returns `{header}` — a base64 `PAYMENT-SIGNATURE`. Without it, tools return the
  402 challenge and payment instructions.

## HTTP API

| Method | URL |
|---|---|
| GET | `https://47620.xyz/x/base` | catalog |
| GET | `https://47620.xyz/x/polygon` | catalog |
| GET | `https://47620.xyz/x/base/{health,gas,trending}` | paid |
| GET | `https://47620.xyz/x/base/{block/:n,balance/:a,stables/:a,token/:t,tx/:h,contract/:a}` | paid |
| GET | `https://47620.xyz/x/polygon/...` | same, Polygon |

Facilitated mirrors under `/x/base-fac/*` and `/x/polygon-fac/*` are used by the
remote MCP for marketplace discovery.

## Payment

Every endpoint advertises `accepts[]` on all three chains:

- **Solana** — USDC (SPL)
- **Base** (`eip155:8453`) — USDC
- **Polygon** (`eip155:137`) — USDC

1% platform fee is split at settlement; 99% goes to the merchant. Non-custodial.

## Links

- Remote MCP: https://47620.xyz/mcp/evm
- Manifest: https://47620.xyz/mcp/evm/server-card
- Repo: https://github.com/fito311/evm-data-mcp
- Registry: `xyz.47620/evm-data`

MIT.
