import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { tokenAmountWithDecimals } from '../lib/accountFetcher'
import type { DecodedAccount } from '../lib/accountFetcher'

const LAMPORTS_PER_SOL_BI = BigInt(LAMPORTS_PER_SOL)

function lamportsToSol(lamports: number): string {
  const big = BigInt(lamports)
  const whole = big / LAMPORTS_PER_SOL_BI
  const frac = big % LAMPORTS_PER_SOL_BI
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString()
}

function shorten(pk: string): string {
  if (pk.length <= 12) return pk
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

function chipPill(d: DecodedAccount | undefined): string | null {
  if (!d) return null
  switch (d.kind) {
    case 'token-account':
      return d.programLabel === 'SPL Token-2022' ? 'token-2022' : 'token'
    case 'mint':
      return `mint·${d.decimals}d`
    case 'system-account':
      return 'system'
    case 'executable':
      return 'program'
    case 'unknown':
      return 'unknown'
    case 'not-found':
      return 'not on-chain'
  }
}

function formatDetails(
  d: DecodedAccount,
  mintLookup: Map<string, number>,
): string[] {
  if (d.kind === 'not-found') return ['(account does not exist on-chain)']

  if (d.kind === 'token-account') {
    const decimals = mintLookup.get(d.mint)
    const lines = [
      `program: ${d.programLabel}`,
      `mint: ${d.mint}`,
      `owner: ${d.owner}`,
      `amount (raw): ${d.amount}`,
    ]
    if (decimals !== undefined) {
      lines.push(
        `amount (×10^-${decimals}): ${tokenAmountWithDecimals(d.amount, decimals)}`,
      )
    }
    lines.push(
      `state: ${d.state}`,
      `wrapped SOL: ${d.isNativeRentReserve ? 'yes' : 'no'}`,
      `lamports: ${d.lamports} (${lamportsToSol(d.lamports)} SOL)`,
    )
    if (d.delegate) lines.push(`delegate: ${d.delegate}`)
    if (d.closeAuthority) lines.push(`closeAuthority: ${d.closeAuthority}`)
    if (d.hasExtensions) lines.push('Token-2022 extensions present')
    return lines
  }

  if (d.kind === 'mint') {
    const lines = [
      `program: ${d.programLabel}`,
      `decimals: ${d.decimals}`,
      `supply: ${d.supply}`,
      `supply (×10^-${d.decimals}): ${tokenAmountWithDecimals(d.supply, d.decimals)}`,
      `lamports: ${d.lamports} (${lamportsToSol(d.lamports)} SOL)`,
    ]
    if (d.mintAuthority) lines.push(`mintAuthority: ${d.mintAuthority}`)
    if (d.freezeAuthority) lines.push(`freezeAuthority: ${d.freezeAuthority}`)
    if (d.hasExtensions) lines.push('Token-2022 extensions present')
    return lines
  }

  if (d.kind === 'system-account') {
    return [
      'kind: system account',
      `lamports: ${d.lamports} (${lamportsToSol(d.lamports)} SOL)`,
    ]
  }

  if (d.kind === 'executable') {
    return [
      'kind: executable program',
      `owner: ${d.owner}`,
      `size: ${d.size} bytes`,
    ]
  }

  return [
    `owner: ${d.owner}`,
    `size: ${d.size} bytes`,
    `lamports: ${d.lamports} (${lamportsToSol(d.lamports)} SOL)`,
  ]
}

type Props = {
  pubkey: string
  role?: string | null
  decoded?: DecodedAccount
  mintLookup: Map<string, number>
}

export default function AccountChip({
  pubkey,
  role,
  decoded,
  mintLookup,
}: Props) {
  const isLookup = pubkey.startsWith('lookup:')
  const pill = chipPill(decoded)

  return (
    <details className="accountChip">
      <summary>
        {role ? <span className="chipRole">{role}</span> : null}
        <code className="chipPubkey">{shorten(pubkey)}</code>
        {pill ? <span className="chipKind">{pill}</span> : null}
      </summary>
      <div className="chipBody">
        <div className="chipPubkeyRow">
          <code className="mono chipFullKey">{pubkey}</code>
          {!isLookup ? (
            <button
              type="button"
              className="btn ghost btnSm"
              onClick={() => navigator.clipboard.writeText(pubkey)}
            >
              Copy
            </button>
          ) : null}
        </div>
        {decoded ? (
          <pre className="chipDecoded">
            {formatDetails(decoded, mintLookup).join('\n')}
          </pre>
        ) : isLookup ? (
          <p className="cardHelp" style={{ marginTop: 0 }}>
            Resolved through an address lookup table — not yet decoded.
          </p>
        ) : (
          <p className="cardHelp" style={{ marginTop: 0 }}>
            No on-chain data fetched.
          </p>
        )}
      </div>
    </details>
  )
}
