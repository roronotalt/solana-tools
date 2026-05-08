import { Connection, PublicKey } from '@solana/web3.js'
import type { AccountInfo } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from './instructionDecoder'

const SYSTEM_PROGRAM_ID_BASE58 = '11111111111111111111111111111111'

export type TokenProgramLabel = 'SPL Token' | 'SPL Token-2022'

export type TokenAccountState = 'uninitialized' | 'initialized' | 'frozen'

export type TokenAccountDecoded = {
  kind: 'token-account'
  programLabel: TokenProgramLabel
  mint: string
  owner: string
  amount: string
  delegate: string | null
  state: TokenAccountState
  isNativeRentReserve: string | null
  delegatedAmount: string
  closeAuthority: string | null
  hasExtensions: boolean
  lamports: number
}

export type MintDecoded = {
  kind: 'mint'
  programLabel: TokenProgramLabel
  mintAuthority: string | null
  supply: string
  decimals: number
  isInitialized: boolean
  freezeAuthority: string | null
  hasExtensions: boolean
  lamports: number
}

export type SystemAccountDecoded = {
  kind: 'system-account'
  lamports: number
}

export type ExecutableDecoded = {
  kind: 'executable'
  owner: string
  lamports: number
  size: number
}

export type UnknownDecoded = {
  kind: 'unknown'
  owner: string
  size: number
  lamports: number
}

export type NotFoundDecoded = { kind: 'not-found' }

export type DecodedAccount =
  | TokenAccountDecoded
  | MintDecoded
  | SystemAccountDecoded
  | ExecutableDecoded
  | UnknownDecoded
  | NotFoundDecoded

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let r = 0n
  for (let i = 0; i < 8; i++) {
    r |= BigInt(data[offset + i]) << BigInt(i * 8)
  }
  return r
}

function readPubkey(data: Uint8Array, offset: number): string {
  const slice = data.subarray(offset, offset + 32)
  return new PublicKey(slice).toBase58()
}

function readOptionTag(data: Uint8Array, offset: number): boolean {
  return readU32LE(data, offset) === 1
}

function decodeTokenAccount(
  data: Uint8Array,
  programId: string,
  lamports: number,
): TokenAccountDecoded | null {
  if (data.length < 165) return null

  const mint = readPubkey(data, 0)
  const owner = readPubkey(data, 32)
  const amount = readU64LE(data, 64).toString()
  const delegate = readOptionTag(data, 72) ? readPubkey(data, 76) : null
  const stateByte = data[108]
  const state: TokenAccountState =
    stateByte === 0
      ? 'uninitialized'
      : stateByte === 1
        ? 'initialized'
        : stateByte === 2
          ? 'frozen'
          : 'uninitialized'
  const isNativeRentReserve = readOptionTag(data, 109)
    ? readU64LE(data, 113).toString()
    : null
  const delegatedAmount = readU64LE(data, 121).toString()
  const closeAuthority = readOptionTag(data, 129)
    ? readPubkey(data, 133)
    : null

  const programLabel: TokenProgramLabel =
    programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'SPL Token-2022' : 'SPL Token'

  return {
    kind: 'token-account',
    programLabel,
    mint,
    owner,
    amount,
    delegate,
    state,
    isNativeRentReserve,
    delegatedAmount,
    closeAuthority,
    hasExtensions: data.length > 165,
    lamports,
  }
}

function decodeMint(
  data: Uint8Array,
  programId: string,
  lamports: number,
): MintDecoded | null {
  if (data.length < 82) return null

  const mintAuthority = readOptionTag(data, 0) ? readPubkey(data, 4) : null
  const supply = readU64LE(data, 36).toString()
  const decimals = data[44]
  const isInitialized = data[45] === 1
  const freezeAuthority = readOptionTag(data, 46) ? readPubkey(data, 50) : null

  const programLabel: TokenProgramLabel =
    programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'SPL Token-2022' : 'SPL Token'

  return {
    kind: 'mint',
    programLabel,
    mintAuthority,
    supply,
    decimals,
    isInitialized,
    freezeAuthority,
    hasExtensions: data.length > 82,
    lamports,
  }
}

function decodeAccount(
  info: AccountInfo<Buffer> | null,
): DecodedAccount {
  if (!info) return { kind: 'not-found' }

  const owner = info.owner.toBase58()
  const data = new Uint8Array(info.data)
  const lamports = info.lamports

  if (info.executable) {
    return { kind: 'executable', owner, lamports, size: data.length }
  }

  const isTokenProgram =
    owner === TOKEN_PROGRAM_ID.toBase58() ||
    owner === TOKEN_2022_PROGRAM_ID.toBase58()

  if (isTokenProgram) {
    if (data.length === 165 || (data.length > 165 && data.length !== 82)) {
      const decoded = decodeTokenAccount(data, owner, lamports)
      if (decoded) return decoded
    }
    if (data.length === 82 || data.length > 82) {
      const decoded = decodeMint(data, owner, lamports)
      if (decoded) return decoded
    }
  }

  if (owner === SYSTEM_PROGRAM_ID_BASE58) {
    return { kind: 'system-account', lamports }
  }

  return { kind: 'unknown', owner, size: data.length, lamports }
}

function isLookupRef(pk: string): boolean {
  return pk.startsWith('lookup:')
}

export async function fetchAndDecodeAccounts(
  connection: Connection,
  pubkeys: string[],
): Promise<Map<string, DecodedAccount>> {
  const result = new Map<string, DecodedAccount>()
  if (pubkeys.length === 0) return result

  const seen = new Set<string>()
  const validKeys: string[] = []
  for (const pk of pubkeys) {
    if (isLookupRef(pk)) continue
    if (seen.has(pk)) continue
    seen.add(pk)
    try {
      new PublicKey(pk)
      validKeys.push(pk)
    } catch {
      // skip invalid
    }
  }

  for (let i = 0; i < validKeys.length; i += 100) {
    const batch = validKeys.slice(i, i + 100)
    const pubKeys = batch.map((k) => new PublicKey(k))
    const infos = await connection.getMultipleAccountsInfo(pubKeys, 'confirmed')
    for (let j = 0; j < batch.length; j++) {
      result.set(batch[j], decodeAccount(infos[j]))
    }
  }

  return result
}

export function summarizeAccountKind(decoded: DecodedAccount): string {
  switch (decoded.kind) {
    case 'token-account':
      return `${decoded.programLabel} · Token Account`
    case 'mint':
      return `${decoded.programLabel} · Mint (${decoded.decimals} decimals)`
    case 'system-account':
      return 'System account'
    case 'executable':
      return 'Program (executable)'
    case 'unknown':
      return `Unknown (owner ${decoded.owner.slice(0, 8)}…)`
    case 'not-found':
      return 'Not found on-chain'
  }
}

export function tokenAmountWithDecimals(
  amount: string,
  decimals: number,
): string {
  if (decimals <= 0) return amount
  const big = BigInt(amount)
  const factor = 10n ** BigInt(decimals)
  const whole = big / factor
  const frac = big % factor
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString()
}
