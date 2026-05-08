import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import type { AccountMeta } from '@solana/web3.js'
import { Buffer } from 'buffer'
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  MEMO_PROGRAM_V1_ID,
  MEMO_PROGRAM_V2_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './instructionDecoder'
import type { DecodedInstruction } from './instructionDecoder'
import { isValidSolanaAddress, parseInstructionData } from './tx'
import type { DataEncoding } from './tx'
import {
  encodeIdlInstructionData,
  isPrimitiveIdlType,
} from './idl'
import type {
  IdlAccountInput,
  IdlDecodedInstruction,
  IdlField,
  IdlInstruction,
} from './idl'
import { base64ToBytes, bytesToBase64 } from './base64'

export type ChipEntry = { pubkey: string; role?: string }

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export type EditableAccount = {
  id: string
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

type Common = { id: string; hint?: string }

export type EditableSystemTransfer = Common & {
  kind: 'system-transfer'
  from: string
  to: string
  lamports: string
}

export type EditableMemo = Common & {
  kind: 'memo'
  programId: string
  text: string
}

export type EditableTokenTransfer = Common & {
  kind: 'spl-token-transfer'
  tokenProgram: string
  source: string
  destination: string
  owner: string
  amount: string
}

export type EditableTokenTransferChecked = Common & {
  kind: 'spl-token-transfer-checked'
  tokenProgram: string
  source: string
  mint: string
  destination: string
  owner: string
  amount: string
  decimals: string
}

export type EditableTokenSyncNative = Common & {
  kind: 'spl-token-sync-native'
  tokenProgram: string
  account: string
}

export type EditableTokenCloseAccount = Common & {
  kind: 'spl-token-close-account'
  tokenProgram: string
  account: string
  destination: string
  owner: string
}

export type EditableComputeUnitLimit = Common & {
  kind: 'compute-set-unit-limit'
  units: string
}

export type EditableComputeUnitPrice = Common & {
  kind: 'compute-set-unit-price'
  microLamports: string
}

export type EditableCustom = Common & {
  kind: 'custom'
  programId: string
  accounts: EditableAccount[]
  dataEncoding: DataEncoding
  data: string
}

export type EditableIdlArg = {
  name: string
  type: string  // serialized IdlType (string for primitives, JSON for composites)
  value: string  // user-editable string
  editable: boolean  // false for composite types
}

export type EditableIdlInstruction = Common & {
  kind: 'idl-instruction'
  programId: string
  programLabel: string
  method: string
  discriminatorBase64: string
  argSpec: IdlField[]
  argValues: EditableIdlArg[]
  accountSpec: IdlAccountInput[]
  accounts: EditableAccount[]
  rawDataBase64: string  // fallback if encoding fails
}

export type EditableIx =
  | EditableSystemTransfer
  | EditableMemo
  | EditableTokenTransfer
  | EditableTokenTransferChecked
  | EditableTokenSyncNative
  | EditableTokenCloseAccount
  | EditableComputeUnitLimit
  | EditableComputeUnitPrice
  | EditableIdlInstruction
  | EditableCustom

export const EDITABLE_KIND_LABEL: Record<EditableIx['kind'], string> = {
  'system-transfer': 'System Transfer',
  memo: 'Memo',
  'spl-token-transfer': 'SPL Token · Transfer',
  'spl-token-transfer-checked': 'SPL Token · TransferChecked',
  'spl-token-sync-native': 'SPL Token · SyncNative',
  'spl-token-close-account': 'SPL Token · CloseAccount',
  'compute-set-unit-limit': 'ComputeBudget · SetComputeUnitLimit',
  'compute-set-unit-price': 'ComputeBudget · SetComputeUnitPrice',
  'idl-instruction': 'IDL instruction',
  custom: 'Custom',
}

function fieldByName(
  known: DecodedInstruction,
  name: string,
): string | undefined {
  return known.fields.find((f) => f.name === name)?.value
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type IdlMatch = {
  idlInstruction: IdlInstruction
  decoded: IdlDecodedInstruction
  discriminator: Uint8Array
  programLabel: string
}

export function editableFromDecoded(args: {
  programId: string
  accounts: string[]
  accountMetas?: { isSigner: boolean; isWritable: boolean }[]
  dataBase64: string
  data: Uint8Array
  known: DecodedInstruction | null
  idlMatch?: IdlMatch
  idlSummary?: string
}): EditableIx {
  const {
    programId,
    accounts,
    accountMetas,
    dataBase64,
    known,
    idlMatch,
    idlSummary,
  } = args
  void args.data

  if (idlMatch && !known) {
    const argValues: EditableIdlArg[] = idlMatch.idlInstruction.args.map(
      (arg) => {
        const decodedArg = idlMatch.decoded.args.find(
          (a) => a.name === arg.name,
        )
        return {
          name: arg.name,
          type:
            typeof arg.type === 'string' ? arg.type : JSON.stringify(arg.type),
          value: decodedArg?.value ?? '',
          editable: isPrimitiveIdlType(arg.type),
        }
      },
    )

    return {
      id: nextId('eix'),
      kind: 'idl-instruction',
      programId,
      programLabel: idlMatch.programLabel,
      method: idlMatch.decoded.method,
      discriminatorBase64: bytesToBase64(idlMatch.discriminator),
      argSpec: idlMatch.idlInstruction.args,
      argValues,
      accountSpec: idlMatch.idlInstruction.accounts,
      accounts: accounts.map((pk, i) => {
        const fromMeta = accountMetas?.[i]
        const fromIdl = idlMatch.idlInstruction.accounts[i]
        return {
          id: nextId('acc'),
          pubkey: pk,
          isSigner:
            fromMeta?.isSigner ??
            fromIdl?.isSigner ??
            fromIdl?.signer ??
            false,
          isWritable:
            fromMeta?.isWritable ??
            fromIdl?.isMut ??
            fromIdl?.writable ??
            false,
        }
      }),
      rawDataBase64: dataBase64,
    }
  }

  if (known) {
    if (
      known.programLabel === 'System Program' &&
      known.kindLabel === 'Transfer' &&
      accounts.length >= 2
    ) {
      return {
        id: nextId('eix'),
        kind: 'system-transfer',
        from: accounts[0],
        to: accounts[1],
        lamports: fieldByName(known, 'lamports') ?? '0',
      }
    }

    if (known.programLabel === 'Memo') {
      return {
        id: nextId('eix'),
        kind: 'memo',
        programId,
        text: fieldByName(known, 'text') ?? '',
      }
    }

    if (
      known.programLabel === 'SPL Token' ||
      known.programLabel === 'SPL Token-2022'
    ) {
      if (known.kindLabel === 'Transfer' && accounts.length >= 3) {
        return {
          id: nextId('eix'),
          kind: 'spl-token-transfer',
          tokenProgram: programId,
          source: accounts[0],
          destination: accounts[1],
          owner: accounts[2],
          amount: fieldByName(known, 'amount') ?? '0',
        }
      }
      if (known.kindLabel === 'TransferChecked' && accounts.length >= 4) {
        return {
          id: nextId('eix'),
          kind: 'spl-token-transfer-checked',
          tokenProgram: programId,
          source: accounts[0],
          mint: accounts[1],
          destination: accounts[2],
          owner: accounts[3],
          amount: fieldByName(known, 'amount (raw)') ?? '0',
          decimals: fieldByName(known, 'decimals') ?? '0',
        }
      }
      if (known.kindLabel === 'SyncNative' && accounts.length >= 1) {
        return {
          id: nextId('eix'),
          kind: 'spl-token-sync-native',
          tokenProgram: programId,
          account: accounts[0],
        }
      }
      if (known.kindLabel === 'CloseAccount' && accounts.length >= 3) {
        return {
          id: nextId('eix'),
          kind: 'spl-token-close-account',
          tokenProgram: programId,
          account: accounts[0],
          destination: accounts[1],
          owner: accounts[2],
        }
      }
    }

    if (known.programLabel === 'Compute Budget') {
      if (known.kindLabel === 'SetComputeUnitLimit') {
        return {
          id: nextId('eix'),
          kind: 'compute-set-unit-limit',
          units: fieldByName(known, 'units') ?? '0',
        }
      }
      if (known.kindLabel === 'SetComputeUnitPrice') {
        return {
          id: nextId('eix'),
          kind: 'compute-set-unit-price',
          microLamports: fieldByName(known, 'microLamports') ?? '0',
        }
      }
    }
  }

  return {
    id: nextId('eix'),
    kind: 'custom',
    programId,
    accounts: accounts.map((pk, i) => ({
      id: nextId('acc'),
      pubkey: pk,
      isSigner: accountMetas?.[i]?.isSigner ?? false,
      isWritable: accountMetas?.[i]?.isWritable ?? false,
    })),
    dataEncoding: 'base64',
    data: dataBase64,
    hint:
      idlSummary ??
      (known ? `${known.programLabel} · ${known.kindLabel}` : undefined),
  }
}

function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

function writeU64LE(buf: Uint8Array, offset: number, value: bigint): void {
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((value >> BigInt(i * 8)) & 0xffn)
  }
}

function parseBigIntU64(value: string, fieldName: string): bigint {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${fieldName} is empty.`)
  let parsed: bigint
  try {
    parsed = BigInt(trimmed)
  } catch {
    throw new Error(`${fieldName} must be an integer.`)
  }
  if (parsed < 0n || parsed > 0xffffffffffffffffn) {
    throw new Error(`${fieldName} must fit in u64.`)
  }
  return parsed
}

function parseU32(value: string, fieldName: string): number {
  const n = Number(value.trim())
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`${fieldName} must be a u32 integer.`)
  }
  return n
}

function parseU8(value: string, fieldName: string): number {
  const n = Number(value.trim())
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    throw new Error(`${fieldName} must be a u8 integer.`)
  }
  return n
}

function pubkey(value: string, fieldName: string): PublicKey {
  if (!value.trim()) throw new Error(`${fieldName} is empty.`)
  if (!isValidSolanaAddress(value)) {
    throw new Error(`${fieldName} is not a valid Solana address.`)
  }
  return new PublicKey(value)
}

function isKnownTokenProgram(programId: string): boolean {
  return (
    programId === TOKEN_PROGRAM_ID.toBase58() ||
    programId === TOKEN_2022_PROGRAM_ID.toBase58()
  )
}

export function buildEditableIx(eix: EditableIx): TransactionInstruction {
  if (eix.kind === 'system-transfer') {
    const lamports = parseBigIntU64(eix.lamports, 'lamports')
    return SystemProgram.transfer({
      fromPubkey: pubkey(eix.from, 'from'),
      toPubkey: pubkey(eix.to, 'to'),
      lamports,
    })
  }

  if (eix.kind === 'memo') {
    const programId = eix.programId.trim()
    if (!programId) throw new Error('memo programId is empty.')
    if (!isValidSolanaAddress(programId)) {
      throw new Error('memo programId is invalid.')
    }
    return new TransactionInstruction({
      programId: new PublicKey(programId),
      keys: [],
      data: Buffer.from(new TextEncoder().encode(eix.text)),
    })
  }

  if (eix.kind === 'spl-token-transfer') {
    if (!isKnownTokenProgram(eix.tokenProgram)) {
      // allow any program-id as long as it's valid (forks); just warn upstream
      pubkey(eix.tokenProgram, 'tokenProgram')
    }
    const amount = parseBigIntU64(eix.amount, 'amount')
    const data = new Uint8Array(9)
    data[0] = 3
    writeU64LE(data, 1, amount)
    const keys: AccountMeta[] = [
      { pubkey: pubkey(eix.source, 'source'), isSigner: false, isWritable: true },
      { pubkey: pubkey(eix.destination, 'destination'), isSigner: false, isWritable: true },
      { pubkey: pubkey(eix.owner, 'owner'), isSigner: true, isWritable: false },
    ]
    return new TransactionInstruction({
      programId: new PublicKey(eix.tokenProgram),
      keys,
      data: Buffer.from(data),
    })
  }

  if (eix.kind === 'spl-token-transfer-checked') {
    const amount = parseBigIntU64(eix.amount, 'amount')
    const decimals = parseU8(eix.decimals, 'decimals')
    const data = new Uint8Array(10)
    data[0] = 12
    writeU64LE(data, 1, amount)
    data[9] = decimals
    const keys: AccountMeta[] = [
      { pubkey: pubkey(eix.source, 'source'), isSigner: false, isWritable: true },
      { pubkey: pubkey(eix.mint, 'mint'), isSigner: false, isWritable: false },
      { pubkey: pubkey(eix.destination, 'destination'), isSigner: false, isWritable: true },
      { pubkey: pubkey(eix.owner, 'owner'), isSigner: true, isWritable: false },
    ]
    return new TransactionInstruction({
      programId: new PublicKey(eix.tokenProgram),
      keys,
      data: Buffer.from(data),
    })
  }

  if (eix.kind === 'spl-token-sync-native') {
    return new TransactionInstruction({
      programId: new PublicKey(eix.tokenProgram),
      keys: [
        { pubkey: pubkey(eix.account, 'account'), isSigner: false, isWritable: true },
      ],
      data: Buffer.from([17]),
    })
  }

  if (eix.kind === 'spl-token-close-account') {
    return new TransactionInstruction({
      programId: new PublicKey(eix.tokenProgram),
      keys: [
        { pubkey: pubkey(eix.account, 'account'), isSigner: false, isWritable: true },
        { pubkey: pubkey(eix.destination, 'destination'), isSigner: false, isWritable: true },
        { pubkey: pubkey(eix.owner, 'owner'), isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    })
  }

  if (eix.kind === 'compute-set-unit-limit') {
    const units = parseU32(eix.units, 'units')
    const data = new Uint8Array(5)
    data[0] = 2
    writeU32LE(data, 1, units)
    return new TransactionInstruction({
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [],
      data: Buffer.from(data),
    })
  }

  if (eix.kind === 'compute-set-unit-price') {
    const microLamports = parseBigIntU64(eix.microLamports, 'microLamports')
    const data = new Uint8Array(9)
    data[0] = 3
    writeU64LE(data, 1, microLamports)
    return new TransactionInstruction({
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [],
      data: Buffer.from(data),
    })
  }

  if (eix.kind === 'idl-instruction') {
    const programId = pubkey(eix.programId, 'programId')
    const keys: AccountMeta[] = eix.accounts.map((acc, idx) => {
      const pk = pubkey(acc.pubkey, `account #${idx + 1}`)
      return {
        pubkey: pk,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      }
    })

    // If any composite arg is present, we can't fully re-encode — fall back to raw bytes.
    const hasNonPrimitive = eix.argSpec.some((s) => !isPrimitiveIdlType(s.type))
    if (hasNonPrimitive) {
      // Use the original wire bytes; user can switch to 'custom' kind to edit raw.
      return new TransactionInstruction({
        programId,
        keys,
        data: Buffer.from(base64ToBytes(eix.rawDataBase64)),
      })
    }

    const dataBytes = encodeIdlInstructionData({
      discriminator: base64ToBytes(eix.discriminatorBase64),
      argSpec: eix.argSpec,
      argValues: eix.argValues.map((a) => ({
        name: a.name,
        value: a.value,
      })),
    })
    return new TransactionInstruction({
      programId,
      keys,
      data: Buffer.from(dataBytes),
    })
  }

  // custom
  const programId = pubkey(eix.programId, 'programId')
  const keys: AccountMeta[] = eix.accounts.map((acc, idx) => {
    const pk = pubkey(acc.pubkey, `account #${idx + 1}`)
    return { pubkey: pk, isSigner: acc.isSigner, isWritable: acc.isWritable }
  })
  const dataBytes = parseInstructionData(eix.data, eix.dataEncoding)
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(dataBytes),
  })
}

export function makeAccount(): EditableAccount {
  return {
    id: nextId('acc'),
    pubkey: '',
    isSigner: false,
    isWritable: false,
  }
}

export function makeBlankCustom(): EditableCustom {
  return {
    id: nextId('eix'),
    kind: 'custom',
    programId: '',
    accounts: [],
    dataEncoding: 'base64',
    data: '',
  }
}

export function requiredSignersForEditable(args: {
  feePayer: string
  instructions: EditableIx[]
}): string[] {
  const signers = new Set<string>()
  const fp = args.feePayer.trim()
  if (fp) signers.add(fp)
  for (const ix of args.instructions) {
    switch (ix.kind) {
      case 'system-transfer':
        if (ix.from.trim()) signers.add(ix.from.trim())
        break
      case 'spl-token-transfer':
      case 'spl-token-transfer-checked':
      case 'spl-token-close-account':
        if (ix.owner.trim()) signers.add(ix.owner.trim())
        break
      case 'spl-token-sync-native':
      case 'memo':
      case 'compute-set-unit-limit':
      case 'compute-set-unit-price':
        break
      case 'idl-instruction':
      case 'custom':
        for (const acc of ix.accounts) {
          if (acc.isSigner && acc.pubkey.trim()) {
            signers.add(acc.pubkey.trim())
          }
        }
        break
    }
  }
  return [...signers]
}

export function programIdForEditable(eix: EditableIx): string {
  switch (eix.kind) {
    case 'system-transfer':
      return SystemProgram.programId.toBase58()
    case 'memo':
      return eix.programId
    case 'spl-token-transfer':
    case 'spl-token-transfer-checked':
    case 'spl-token-sync-native':
    case 'spl-token-close-account':
      return eix.tokenProgram
    case 'compute-set-unit-limit':
    case 'compute-set-unit-price':
      return COMPUTE_BUDGET_PROGRAM_ID.toBase58()
    case 'idl-instruction':
    case 'custom':
      return eix.programId
  }
}

export function chipsForEditable(
  eix: EditableIx,
  idlAccountRoles?: string[],
): ChipEntry[] {
  const programId = programIdForEditable(eix)
  const programChip: ChipEntry = { pubkey: programId, role: 'program' }

  switch (eix.kind) {
    case 'system-transfer':
      return [
        programChip,
        { pubkey: eix.from, role: 'from' },
        { pubkey: eix.to, role: 'to' },
      ].filter((c) => c.pubkey)
    case 'memo':
      return [programChip].filter((c) => c.pubkey)
    case 'spl-token-transfer':
      return [
        programChip,
        { pubkey: eix.source, role: 'source' },
        { pubkey: eix.destination, role: 'destination' },
        { pubkey: eix.owner, role: 'owner' },
      ].filter((c) => c.pubkey)
    case 'spl-token-transfer-checked':
      return [
        programChip,
        { pubkey: eix.source, role: 'source' },
        { pubkey: eix.mint, role: 'mint' },
        { pubkey: eix.destination, role: 'destination' },
        { pubkey: eix.owner, role: 'owner' },
      ].filter((c) => c.pubkey)
    case 'spl-token-sync-native':
      return [programChip, { pubkey: eix.account, role: 'account' }].filter(
        (c) => c.pubkey,
      )
    case 'spl-token-close-account':
      return [
        programChip,
        { pubkey: eix.account, role: 'account' },
        { pubkey: eix.destination, role: 'destination' },
        { pubkey: eix.owner, role: 'owner' },
      ].filter((c) => c.pubkey)
    case 'compute-set-unit-limit':
    case 'compute-set-unit-price':
      return [programChip]
    case 'idl-instruction':
      return [
        programChip,
        ...eix.accounts
          .map((a, i) => ({
            pubkey: a.pubkey,
            role: eix.accountSpec[i]?.name ?? idlAccountRoles?.[i],
          }))
          .filter((c) => c.pubkey),
      ]
    case 'custom':
      return [
        programChip,
        ...eix.accounts
          .map((a, i) => ({
            pubkey: a.pubkey,
            role: idlAccountRoles?.[i],
          }))
          .filter((c) => c.pubkey),
      ]
  }
}

// Suppress unused warnings for internal helpers exported for future use
export const __internal = {
  MEMO_PROGRAM_V1_ID,
  MEMO_PROGRAM_V2_ID,
  bytesToHex,
}
