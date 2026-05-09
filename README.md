# solana-tools

A browser-based toolbox for working with Solana transactions and keys
**locally** — connect a wallet, build / decode / sign things, and convert
keys between formats. Nothing is broadcast on-chain unless you copy a
signed transaction out and submit it yourself.

Built with React + TypeScript + Vite, using `@solana/web3.js` and the
Solana wallet-adapter (Phantom, Solflare).

## Tools

- **Sign base64** — paste a serialized transaction (base64 or JSON byte
  map), decode and inspect it, optionally edit any field, then sign it
  with your connected wallet.
- **Generate + sign transfer** — quickly build a SOL transfer (with an
  optional memo) and sign it locally.
- **Build custom tx** — compose multiple instructions (system transfer,
  memo, custom) into one transaction; supports legacy and versioned
  (v0) transactions.
- **Wrap / Unwrap SOL** — wrap native SOL → wSOL via
  create-idempotent-ATA + transfer + syncNative, or unwrap by closing
  the wSOL ATA.
- **Key converter** — convert a private key between formats: byte
  array, hex, base58 → keypair JSON (Solana CLI format), base58 full
  keypair (Phantom / Solflare export format), base58 seed only, and
  derived public key. Accepts 32-byte seeds and 64-byte full keypairs.

## Setup

```bash
# install deps
bun install        # or: npm install / yarn / pnpm install

# configure your RPC endpoint
cp .env.example .env
# then edit .env and set VITE_SOLANA_RPC_URL

# run the dev server
bun run dev        # or: npm run dev
```

The app then runs at <http://localhost:5173>.

### Environment variables

See [`.env.example`](./.env.example).

| Var                   | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `VITE_SOLANA_RPC_URL` | No\*     | Mainnet RPC endpoint. Defaults to the public `mainnet-beta` endpoint if unset, which is heavily rate-limited — set your own (Helius / QuickNode / Triton / Alchemy / etc.) for anything beyond casual use. |

\* Strongly recommended in practice.

## Build

```bash
bun run build      # type-check + vite build → ./dist
bun run preview    # serve the production build locally
```

## Security notes

- **Never paste a private key you actually use into a website you don't
  fully trust.** This app does everything client-side and makes no
  network calls with key material — but you should still verify the
  source / build it yourself before pasting real keys.
- **Signing an arbitrary transaction can approve actions you did not
  intend.** Decode and inspect every instruction before signing. The
  "Sign base64" tab shows decoded instructions, IDL-aware arg parsing
  (when the program has an on-chain IDL), and per-account roles to
  help with this.
- Don't commit your `.env` — it's in `.gitignore`. Use `.env.example`
  as the template.
