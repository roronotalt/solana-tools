import { Connection } from '@solana/web3.js'
import { base64ToBytes } from './base64'
import {
  fetchAndDecodeAccounts,
} from './accountFetcher'
import type { DecodedAccount } from './accountFetcher'
import { fetchAndDecodeWithIdls } from './idl'
import type { Idl, IdlDecodedInstruction } from './idl'

export type EnrichmentInstruction = {
  programId: string
  accounts: string[]
  dataBase64: string
}

export type EnrichmentInput = {
  accounts: string[]
  instructions: EnrichmentInstruction[]
}

export type EnrichmentResult = {
  accountInfo: Map<string, DecodedAccount>
  mintLookup: Map<string, number>
  idlsByProgram: Map<string, Idl | null>
  idlDecodedByIndex: Map<number, IdlDecodedInstruction>
  errors: string[]
}

export async function enrichDecodedTx(
  connection: Connection,
  input: EnrichmentInput,
): Promise<EnrichmentResult> {
  const errors: string[] = []
  let accountInfo = new Map<string, DecodedAccount>()
  const mintLookup = new Map<string, number>()
  let idlsByProgram = new Map<string, Idl | null>()
  let idlDecodedByIndex = new Map<number, IdlDecodedInstruction>()

  const accountsTask = (async () => {
    try {
      accountInfo = await fetchAndDecodeAccounts(connection, input.accounts)

      const tokenMints = new Set<string>()
      for (const decoded of accountInfo.values()) {
        if (decoded.kind === 'token-account') tokenMints.add(decoded.mint)
      }
      const newMints = [...tokenMints].filter((m) => !accountInfo.has(m))
      if (newMints.length > 0) {
        const mintInfos = await fetchAndDecodeAccounts(connection, newMints)
        for (const [k, v] of mintInfos) accountInfo.set(k, v)
      }

      for (const [k, v] of accountInfo) {
        if (v.kind === 'mint') mintLookup.set(k, v.decimals)
      }
    } catch (e) {
      errors.push(
        `Account fetch failed: ${e instanceof Error ? e.message : 'unknown'}`,
      )
    }
  })()

  const idlsTask = (async () => {
    try {
      const items = input.instructions.map((ix) => ({
        programId: ix.programId,
        accounts: ix.accounts,
        data: base64ToBytes(ix.dataBase64),
      }))
      const r = await fetchAndDecodeWithIdls(connection, items)
      idlsByProgram = r.idlsByProgram
      idlDecodedByIndex = r.decodedByIndex
    } catch (e) {
      errors.push(
        `IDL fetch failed: ${e instanceof Error ? e.message : 'unknown'}`,
      )
    }
  })()

  await Promise.all([accountsTask, idlsTask])

  return { accountInfo, mintLookup, idlsByProgram, idlDecodedByIndex, errors }
}
