import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'

export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
)
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
)
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
)
export const NATIVE_MINT = new PublicKey(
  'So11111111111111111111111111111111111111112',
)
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111',
)
export const MEMO_PROGRAM_V1_ID = new PublicKey(
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
)
export const MEMO_PROGRAM_V2_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
)

const LAMPORTS_PER_SOL_BI = BigInt(LAMPORTS_PER_SOL)

export type DecodedField = { name: string; value: string }

export type DecodedInstruction = {
  programLabel: string
  kindLabel: string
  fields: DecodedField[]
  accountRoles?: string[]
}

function lamportsToSolString(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL_BI
  const frac = lamports % LAMPORTS_PER_SOL_BI
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString()
}

function readU32LE(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) throw new Error('readU32LE out of range')
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24) >>> 0
  )
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) throw new Error('readU64LE out of range')
  let r = 0n
  for (let i = 0; i < 8; i++) {
    r |= BigInt(data[offset + i]) << BigInt(i * 8)
  }
  return r
}

function tokenAmountWithDecimals(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString()
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString()
}

function decodeSystem(
  programId: string,
  accountKeys: string[],
  data: Uint8Array,
): DecodedInstruction | null {
  try {
    const ix = new TransactionInstruction({
      programId: new PublicKey(programId),
      keys: accountKeys.map((pk) => ({
        pubkey: new PublicKey(pk),
        isSigner: false,
        isWritable: false,
      })),
      data: Buffer.from(data),
    })

    const type = SystemInstruction.decodeInstructionType(ix)
    switch (type) {
      case 'Transfer': {
        const d = SystemInstruction.decodeTransfer(ix)
        const lamports = BigInt(d.lamports.toString())
        return {
          programLabel: 'System Program',
          kindLabel: 'Transfer',
          fields: [
            { name: 'from', value: d.fromPubkey.toBase58() },
            { name: 'to', value: d.toPubkey.toBase58() },
            { name: 'lamports', value: lamports.toString() },
            { name: 'sol', value: lamportsToSolString(lamports) },
          ],
          accountRoles: ['from', 'to'],
        }
      }
      case 'TransferWithSeed': {
        const d = SystemInstruction.decodeTransferWithSeed(ix)
        const lamports = BigInt(d.lamports.toString())
        return {
          programLabel: 'System Program',
          kindLabel: 'TransferWithSeed',
          fields: [
            { name: 'from', value: d.fromPubkey.toBase58() },
            { name: 'to', value: d.toPubkey.toBase58() },
            { name: 'lamports', value: lamports.toString() },
            { name: 'sol', value: lamportsToSolString(lamports) },
            { name: 'seed', value: d.seed },
            { name: 'programId', value: d.programId.toBase58() },
          ],
          accountRoles: ['from', 'base', 'to'],
        }
      }
      case 'Create': {
        const d = SystemInstruction.decodeCreateAccount(ix)
        return {
          programLabel: 'System Program',
          kindLabel: 'CreateAccount',
          fields: [
            { name: 'fromPubkey', value: d.fromPubkey.toBase58() },
            { name: 'newAccountPubkey', value: d.newAccountPubkey.toBase58() },
            { name: 'lamports', value: d.lamports.toString() },
            { name: 'space', value: d.space.toString() },
            { name: 'programId', value: d.programId.toBase58() },
          ],
          accountRoles: ['from', 'newAccount'],
        }
      }
      case 'CreateWithSeed': {
        const d = SystemInstruction.decodeCreateWithSeed(ix)
        return {
          programLabel: 'System Program',
          kindLabel: 'CreateAccountWithSeed',
          fields: [
            { name: 'fromPubkey', value: d.fromPubkey.toBase58() },
            { name: 'newAccountPubkey', value: d.newAccountPubkey.toBase58() },
            { name: 'basePubkey', value: d.basePubkey.toBase58() },
            { name: 'seed', value: d.seed },
            { name: 'lamports', value: d.lamports.toString() },
            { name: 'space', value: d.space.toString() },
            { name: 'programId', value: d.programId.toBase58() },
          ],
          accountRoles: ['from', 'newAccount', 'base'],
        }
      }
      case 'Allocate': {
        const d = SystemInstruction.decodeAllocate(ix)
        return {
          programLabel: 'System Program',
          kindLabel: 'Allocate',
          fields: [
            { name: 'accountPubkey', value: d.accountPubkey.toBase58() },
            { name: 'space', value: d.space.toString() },
          ],
          accountRoles: ['account'],
        }
      }
      case 'Assign': {
        const d = SystemInstruction.decodeAssign(ix)
        return {
          programLabel: 'System Program',
          kindLabel: 'Assign',
          fields: [
            { name: 'accountPubkey', value: d.accountPubkey.toBase58() },
            { name: 'programId', value: d.programId.toBase58() },
          ],
          accountRoles: ['account'],
        }
      }
      default:
        return {
          programLabel: 'System Program',
          kindLabel: type,
          fields: [],
        }
    }
  } catch {
    return {
      programLabel: 'System Program',
      kindLabel: 'Unknown',
      fields: [],
    }
  }
}

function tokenInstructionLabel(disc: number): string {
  switch (disc) {
    case 0: return 'InitializeMint'
    case 1: return 'InitializeAccount'
    case 2: return 'InitializeMultisig'
    case 3: return 'Transfer'
    case 4: return 'Approve'
    case 5: return 'Revoke'
    case 6: return 'SetAuthority'
    case 7: return 'MintTo'
    case 8: return 'Burn'
    case 9: return 'CloseAccount'
    case 10: return 'FreezeAccount'
    case 11: return 'ThawAccount'
    case 12: return 'TransferChecked'
    case 13: return 'ApproveChecked'
    case 14: return 'MintToChecked'
    case 15: return 'BurnChecked'
    case 16: return 'InitializeAccount2'
    case 17: return 'SyncNative'
    case 18: return 'InitializeAccount3'
    case 21: return 'InitializeMint2'
    default: return `Unknown (discriminator ${disc})`
  }
}

function decodeToken(
  programLabel: string,
  data: Uint8Array,
): DecodedInstruction | null {
  if (data.length === 0) {
    return { programLabel, kindLabel: 'Empty', fields: [] }
  }
  const disc = data[0]
  const kindLabel = tokenInstructionLabel(disc)

  switch (disc) {
    case 3: {
      if (data.length < 9) break
      const amount = readU64LE(data, 1)
      return {
        programLabel,
        kindLabel,
        fields: [{ name: 'amount', value: amount.toString() }],
        accountRoles: ['source', 'destination', 'owner'],
      }
    }
    case 7: {
      if (data.length < 9) break
      const amount = readU64LE(data, 1)
      return {
        programLabel,
        kindLabel,
        fields: [{ name: 'amount', value: amount.toString() }],
        accountRoles: ['mint', 'destination', 'authority'],
      }
    }
    case 8: {
      if (data.length < 9) break
      const amount = readU64LE(data, 1)
      return {
        programLabel,
        kindLabel,
        fields: [{ name: 'amount', value: amount.toString() }],
        accountRoles: ['account', 'mint', 'authority'],
      }
    }
    case 9: {
      return {
        programLabel,
        kindLabel,
        fields: [],
        accountRoles: ['account', 'destination', 'owner'],
      }
    }
    case 12: {
      if (data.length < 10) break
      const amount = readU64LE(data, 1)
      const decimals = data[9]
      return {
        programLabel,
        kindLabel,
        fields: [
          { name: 'amount (raw)', value: amount.toString() },
          { name: 'decimals', value: decimals.toString() },
          {
            name: 'amount (adjusted)',
            value: tokenAmountWithDecimals(amount, decimals),
          },
        ],
        accountRoles: ['source', 'mint', 'destination', 'owner'],
      }
    }
    case 14: {
      if (data.length < 10) break
      const amount = readU64LE(data, 1)
      const decimals = data[9]
      return {
        programLabel,
        kindLabel,
        fields: [
          { name: 'amount (raw)', value: amount.toString() },
          { name: 'decimals', value: decimals.toString() },
          {
            name: 'amount (adjusted)',
            value: tokenAmountWithDecimals(amount, decimals),
          },
        ],
        accountRoles: ['mint', 'destination', 'authority'],
      }
    }
    case 15: {
      if (data.length < 10) break
      const amount = readU64LE(data, 1)
      const decimals = data[9]
      return {
        programLabel,
        kindLabel,
        fields: [
          { name: 'amount (raw)', value: amount.toString() },
          { name: 'decimals', value: decimals.toString() },
          {
            name: 'amount (adjusted)',
            value: tokenAmountWithDecimals(amount, decimals),
          },
        ],
        accountRoles: ['account', 'mint', 'authority'],
      }
    }
    case 17: {
      return {
        programLabel,
        kindLabel,
        fields: [],
        accountRoles: ['account'],
      }
    }
  }

  return { programLabel, kindLabel, fields: [] }
}

function decodeAssociatedToken(data: Uint8Array): DecodedInstruction | null {
  let kindLabel: string
  if (data.length === 0) {
    kindLabel = 'Create'
  } else if (data[0] === 0) {
    kindLabel = 'Create'
  } else if (data[0] === 1) {
    kindLabel = 'CreateIdempotent'
  } else if (data[0] === 2) {
    kindLabel = 'RecoverNested'
  } else {
    kindLabel = `Unknown (${data[0]})`
  }
  return {
    programLabel: 'Associated Token',
    kindLabel,
    fields: [],
    accountRoles: [
      'funder',
      'ata',
      'owner',
      'mint',
      'systemProgram',
      'tokenProgram',
    ],
  }
}

function decodeComputeBudget(data: Uint8Array): DecodedInstruction | null {
  if (data.length === 0) return null
  const disc = data[0]
  switch (disc) {
    case 0: {
      if (data.length < 9) break
      const units = readU32LE(data, 1)
      const additionalFee = readU32LE(data, 5)
      return {
        programLabel: 'Compute Budget',
        kindLabel: 'RequestUnits (deprecated)',
        fields: [
          { name: 'units', value: units.toString() },
          { name: 'additionalFee', value: additionalFee.toString() },
        ],
      }
    }
    case 1: {
      if (data.length < 5) break
      const bytes = readU32LE(data, 1)
      return {
        programLabel: 'Compute Budget',
        kindLabel: 'RequestHeapFrame',
        fields: [{ name: 'bytes', value: bytes.toString() }],
      }
    }
    case 2: {
      if (data.length < 5) break
      const units = readU32LE(data, 1)
      return {
        programLabel: 'Compute Budget',
        kindLabel: 'SetComputeUnitLimit',
        fields: [{ name: 'units', value: units.toString() }],
      }
    }
    case 3: {
      if (data.length < 9) break
      const microLamports = readU64LE(data, 1)
      return {
        programLabel: 'Compute Budget',
        kindLabel: 'SetComputeUnitPrice',
        fields: [
          { name: 'microLamports', value: microLamports.toString() },
        ],
      }
    }
    case 4: {
      if (data.length < 5) break
      const accountDataSize = readU32LE(data, 1)
      return {
        programLabel: 'Compute Budget',
        kindLabel: 'SetLoadedAccountsDataSizeLimit',
        fields: [
          { name: 'bytes', value: accountDataSize.toString() },
        ],
      }
    }
  }
  return {
    programLabel: 'Compute Budget',
    kindLabel: `Unknown (discriminator ${disc})`,
    fields: [],
  }
}

function decodeMemo(data: Uint8Array): DecodedInstruction {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(data)
  } catch {
    text = ''
  }
  return {
    programLabel: 'Memo',
    kindLabel: 'Memo',
    fields: [{ name: 'text', value: text }],
  }
}

export function decodeKnownInstruction(
  programId: string,
  accountKeys: string[],
  data: Uint8Array,
): DecodedInstruction | null {
  if (programId === SystemProgram.programId.toBase58()) {
    return decodeSystem(programId, accountKeys, data)
  }
  if (programId === TOKEN_PROGRAM_ID.toBase58()) {
    return decodeToken('SPL Token', data)
  }
  if (programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
    return decodeToken('SPL Token-2022', data)
  }
  if (programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
    return decodeAssociatedToken(data)
  }
  if (programId === COMPUTE_BUDGET_PROGRAM_ID.toBase58()) {
    return decodeComputeBudget(data)
  }
  if (
    programId === MEMO_PROGRAM_V1_ID.toBase58() ||
    programId === MEMO_PROGRAM_V2_ID.toBase58()
  ) {
    return decodeMemo(data)
  }
  return null
}
