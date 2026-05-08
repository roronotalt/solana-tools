import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { base64ToBytes, bytesToBase64 } from './base64'
import { decodeKnownInstruction } from './instructionDecoder'
import type { DecodedInstruction as KnownIx } from './instructionDecoder'

export const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
)

export type TxKind = 'legacy' | 'versioned'

export type AccountMetaFlags = { isSigner: boolean; isWritable: boolean }

export type TxPreviewInstruction = {
  programId: string
  accounts: string[]
  accountMetas: AccountMetaFlags[]
  dataBase64: string
  dataText?: string
  known: KnownIx | null
}

export type TxSignerInfo = {
  pubkey: string
  signature: string | null
}

export type TxPreview = {
  txKind: TxKind
  feePayer: string | null
  recentBlockhash: string | null
  instructionCount: number
  instructions: TxPreviewInstruction[]
  signers: TxSignerInfo[]
}

export function isValidSolanaAddress(s: string): boolean {
  try {
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

export function tryDecodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder().decode(bytes)
    const printable = text.replace(/\s/g, '').length > 0
    return printable ? text : undefined
  } catch {
    return undefined
  }
}

export function decodeShortvecLength(
  bytes: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  let result = 0
  let shift = 0
  let i = offset
  while (true) {
    if (i >= bytes.length) throw new Error('Invalid transaction bytes.')
    const b = bytes[i]
    result |= (b & 0x7f) << shift
    i += 1
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 28) throw new Error('Invalid transaction length encoding.')
  }
  return { value: result, nextOffset: i }
}

export function detectTxKindFromWire(bytes: Uint8Array): TxKind {
  const { value: signatureCount, nextOffset } = decodeShortvecLength(bytes, 0)
  const messageOffset = nextOffset + signatureCount * 64
  if (messageOffset >= bytes.length) throw new Error('Invalid transaction bytes.')
  const firstMessageByte = bytes[messageOffset]
  const isVersioned = (firstMessageByte & 0x80) !== 0
  return isVersioned ? 'versioned' : 'legacy'
}

export function decodePreviewFromWire(bytes: Uint8Array): TxPreview {
  const kind = detectTxKindFromWire(bytes)

  if (kind === 'versioned') {
    const vtx = VersionedTransaction.deserialize(bytes)
    const staticKeys = vtx.message.staticAccountKeys.map((k) => k.toBase58())
    const feePayer = staticKeys.length ? staticKeys[0] : null
    const recentBlockhash = vtx.message.recentBlockhash ?? null

    const instructions: TxPreviewInstruction[] =
      vtx.message.compiledInstructions.map((ci) => {
        const programId =
          ci.programIdIndex < staticKeys.length
            ? staticKeys[ci.programIdIndex]
            : `lookup:${ci.programIdIndex}`

        const accounts = ci.accountKeyIndexes.map((idx) =>
          idx < staticKeys.length ? staticKeys[idx] : `lookup:${idx}`,
        )

        const accountMetas: AccountMetaFlags[] = ci.accountKeyIndexes.map(
          (idx) => ({
            isSigner: vtx.message.isAccountSigner(idx),
            isWritable: vtx.message.isAccountWritable(idx),
          }),
        )

        const dataBase64 = bytesToBase64(ci.data)
        const dataText = tryDecodeUtf8(ci.data)
        const known = decodeKnownInstruction(programId, accounts, ci.data)
        return {
          programId,
          accounts,
          accountMetas,
          dataBase64,
          dataText,
          known,
        }
      })

    const numSigners = vtx.message.header.numRequiredSignatures
    const signers: TxSignerInfo[] = []
    for (let i = 0; i < numSigners; i++) {
      const pubkey =
        i < vtx.message.staticAccountKeys.length
          ? vtx.message.staticAccountKeys[i].toBase58()
          : `lookup:${i}`
      const sig = vtx.signatures[i]
      const signed = sig && sig.some((b: number) => b !== 0)
      signers.push({
        pubkey,
        signature: signed ? bs58.encode(sig) : null,
      })
    }

    return {
      txKind: 'versioned',
      feePayer,
      recentBlockhash,
      instructionCount: vtx.message.compiledInstructions.length,
      instructions,
      signers,
    }
  }

  const tx = Transaction.from(bytes)
  const feePayer = tx.feePayer ? tx.feePayer.toBase58() : null
  const recentBlockhash = tx.recentBlockhash ?? null

  const instructions: TxPreviewInstruction[] = tx.instructions.map((ix) => {
    const dataBase64 = bytesToBase64(ix.data)
    const dataText = tryDecodeUtf8(ix.data)
    const programId = ix.programId.toBase58()
    const accounts = ix.keys.map((k) => k.pubkey.toBase58())
    const accountMetas: AccountMetaFlags[] = ix.keys.map((k) => ({
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    }))
    const known = decodeKnownInstruction(programId, accounts, ix.data)
    return {
      programId,
      accounts,
      accountMetas,
      dataBase64,
      dataText,
      known,
    }
  })

  const signers: TxSignerInfo[] = tx.signatures.map((s) => ({
    pubkey: s.publicKey.toBase58(),
    signature: s.signature ? bs58.encode(s.signature) : null,
  }))

  return {
    txKind: 'legacy',
    feePayer,
    recentBlockhash,
    instructionCount: tx.instructions.length,
    instructions,
    signers,
  }
}

export function getCreateSignErrorMessage(
  error: unknown,
  rpcEndpoint: string,
): string {
  const fallback = 'Failed to create/sign transaction.'
  if (!(error instanceof Error)) return fallback

  const message = error.message
  const lower = message.toLowerCase()

  const mentionsMainnet = lower.includes('mainnet')
  const mentionsDevnet = lower.includes('devnet')
  const networkMismatchHint =
    lower.includes('network mismatch') ||
    lower.includes('wrong network') ||
    (lower.includes('network') && mentionsMainnet && mentionsDevnet)

  if (networkMismatchHint || (mentionsMainnet && mentionsDevnet)) {
    if (mentionsMainnet && mentionsDevnet) {
      return 'Your current network is set to devnet, but this transaction is for mainnet. Switch to the correct network before signing.'
    }
    if (mentionsDevnet) {
      return 'Your current network is set to devnet, but this transaction is for mainnet. Switch to the correct network before signing.'
    }
    if (mentionsMainnet) {
      return 'Your current network is set to mainnet, but this transaction is for devnet. Switch to the correct network before signing.'
    }
    return 'Your current network does not match this transaction network. Switch to the correct network before signing.'
  }

  const rpcAccessForbidden =
    (lower.includes('failed to get recent blockhash') ||
      lower.includes('getlatestblockhash')) &&
    (lower.includes('403') || lower.includes('access forbidden'))
  if (rpcAccessForbidden) {
    return `Failed to get recent blockhash from RPC endpoint (${rpcEndpoint}): Access forbidden (403). Set a mainnet RPC in VITE_SOLANA_RPC_URL and restart the app.`
  }

  return message || fallback
}

export type TxInputMeta = {
  lastValidBlockHeight?: number
  success?: boolean
}

export type TxInputResult = {
  bytes: Uint8Array
  meta?: TxInputMeta
  source: 'base64' | 'json'
}

export function parseTxInput(raw: string): TxInputResult {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Input is empty.')

  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (looksLikeJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'unknown error'
      throw new Error(`Input looks like JSON but failed to parse: ${detail}`)
    }
    const inner = extractFromJson(parsed)
    return { ...inner, source: 'json' }
  }

  return { bytes: base64ToBytes(trimmed), source: 'base64' }
}

function extractFromJson(value: unknown): { bytes: Uint8Array; meta?: TxInputMeta } {
  if (typeof value === 'string') {
    return { bytes: base64ToBytes(value) }
  }

  if (Array.isArray(value)) {
    return { bytes: numberArrayToBytes(value) }
  }

  if (!value || typeof value !== 'object') {
    throw new Error('JSON does not contain transaction bytes.')
  }

  const obj = value as Record<string, unknown>

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return { bytes: numberArrayToBytes(obj.data), meta: pickMeta(obj) }
  }

  const wrapperKeys = [
    'serializedTransaction',
    'serializedTx',
    'transaction',
    'tx',
    'serialized',
    'bytes',
    'data',
  ]
  for (const key of wrapperKeys) {
    const inner = obj[key]
    if (inner !== undefined && inner !== null) {
      const extracted = extractFromJson(inner)
      const outerMeta = pickMeta(obj)
      const meta = mergeMeta(extracted.meta, outerMeta)
      return meta ? { bytes: extracted.bytes, meta } : { bytes: extracted.bytes }
    }
  }

  return { bytes: byteMapToBytes(obj), meta: pickMeta(obj) }
}

function mergeMeta(
  a: TxInputMeta | undefined,
  b: TxInputMeta | undefined,
): TxInputMeta | undefined {
  if (!a) return b
  if (!b) return a
  return { ...a, ...b }
}

function pickMeta(obj: Record<string, unknown>): TxInputMeta | undefined {
  const meta: TxInputMeta = {}
  let hasAny = false
  if (typeof obj.lastValidBlockHeight === 'number') {
    meta.lastValidBlockHeight = obj.lastValidBlockHeight
    hasAny = true
  }
  if (typeof obj.success === 'boolean') {
    meta.success = obj.success
    hasAny = true
  }
  return hasAny ? meta : undefined
}

function numberArrayToBytes(arr: unknown[]): Uint8Array {
  return new Uint8Array(arr.map(coerceByte))
}

function byteMapToBytes(obj: Record<string, unknown>): Uint8Array {
  const indexed: Array<[number, number]> = []
  for (const [k, v] of Object.entries(obj)) {
    if (!/^\d+$/.test(k)) continue
    const idx = Number(k)
    if (!Number.isInteger(idx) || idx < 0) continue
    indexed.push([idx, coerceByte(v)])
  }
  if (indexed.length === 0) {
    throw new Error('JSON object has no numeric-keyed byte entries.')
  }
  indexed.sort((a, b) => a[0] - b[0])
  const max = indexed[indexed.length - 1][0]
  const out = new Uint8Array(max + 1)
  for (const [idx, byte] of indexed) out[idx] = byte
  return out
}

function coerceByte(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) {
    throw new Error('Byte value must be an integer between 0 and 255.')
  }
  return v
}

export type JsonByteMapFormat = 'pretty' | 'compact' | 'escaped-string'

export function bytesToJsonByteMap(
  bytes: Uint8Array,
  opts: {
    wrapperKey?: string | null
    format?: JsonByteMapFormat
    extra?: Record<string, unknown>
  } = {},
): string {
  const { wrapperKey = 'serializedTx', format = 'compact', extra } = opts
  const byteMap: Record<string, number> = {}
  for (let i = 0; i < bytes.length; i++) {
    byteMap[String(i)] = bytes[i]
  }
  const root = wrapperKey
    ? { [wrapperKey]: byteMap, ...(extra ?? {}) }
    : extra
      ? { ...byteMap, ...extra }
      : byteMap
  const json =
    format === 'pretty' ? JSON.stringify(root, null, 2) : JSON.stringify(root)
  if (format === 'escaped-string') {
    // Strip outer {} and produce backslash-escaped inner content, suitable for
    // dropping into another JSON object's body between commas.
    const inner = json.slice(1, -1)
    return JSON.stringify(inner).slice(1, -1)
  }
  return json
}

export type DataEncoding = 'base64' | 'hex' | 'utf-8'

export function parseInstructionData(
  value: string,
  encoding: DataEncoding,
): Uint8Array {
  if (encoding === 'utf-8') {
    return new TextEncoder().encode(value)
  }
  if (encoding === 'hex') {
    const cleaned = value.trim().replace(/^0x/i, '').replace(/\s+/g, '')
    if (cleaned.length === 0) return new Uint8Array(0)
    if (cleaned.length % 2 !== 0) {
      throw new Error('Hex data must have an even number of digits.')
    }
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
      throw new Error('Hex data contains non-hex characters.')
    }
    const out = new Uint8Array(cleaned.length / 2)
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  }
  // base64
  const trimmed = value.trim()
  if (trimmed.length === 0) return new Uint8Array(0)
  let normalized = trimmed.replace(/[\r\n\s]/g, '')
  normalized = normalized.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = normalized.length % 4
  if (remainder === 2) normalized += '=='
  else if (remainder === 3) normalized += '='
  else if (remainder === 1) {
    throw new Error('Invalid base64 data length.')
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
