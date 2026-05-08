import { useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { AccountMeta } from '@solana/web3.js'
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { base64ToBytes, bytesToBase64 } from '../lib/base64'
import {
  MEMO_PROGRAM_ID,
  bytesToJsonByteMap,
  decodePreviewFromWire,
  getCreateSignErrorMessage,
  isValidSolanaAddress,
  parseInstructionData,
} from '../lib/tx'
import type { DataEncoding, TxPreview } from '../lib/tx'
import { enrichDecodedTx } from '../lib/enrichment'
import type { EnrichmentResult } from '../lib/enrichment'
import AccountChip from './AccountChip'

type IxType = 'system-transfer' | 'memo' | 'custom'

type SystemTransferIx = {
  id: string
  type: 'system-transfer'
  fromPubkey: string
  toPubkey: string
  amountSol: string
}

type MemoIx = {
  id: string
  type: 'memo'
  text: string
}

type AccountInput = {
  id: string
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

type CustomIx = {
  id: string
  type: 'custom'
  programId: string
  accounts: AccountInput[]
  dataEncoding: DataEncoding
  data: string
}

type BuilderIx = SystemTransferIx | MemoIx | CustomIx

type BlockhashMode = 'rpc' | 'manual'

type BuildResult = {
  txKind: 'legacy' | 'versioned'
  unsignedTransactionBase64: string
  signedTransactionBase64: string | null
  signatures: string[]
  decodedPreview: TxPreview
  enrichment: EnrichmentResult
  lastValidBlockHeight: number | null
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

function makeSystemTransfer(defaultFrom: string): SystemTransferIx {
  return {
    id: nextId('ix'),
    type: 'system-transfer',
    fromPubkey: defaultFrom,
    toPubkey: '',
    amountSol: '0.001',
  }
}

function makeMemo(): MemoIx {
  return {
    id: nextId('ix'),
    type: 'memo',
    text: '',
  }
}

function makeCustom(): CustomIx {
  return {
    id: nextId('ix'),
    type: 'custom',
    programId: '',
    accounts: [],
    dataEncoding: 'base64',
    data: '',
  }
}

function makeAccount(): AccountInput {
  return {
    id: nextId('acc'),
    pubkey: '',
    isSigner: false,
    isWritable: false,
  }
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

function buildInstruction(ix: BuilderIx): TransactionInstruction {
  if (ix.type === 'system-transfer') {
    if (!ix.fromPubkey) throw new Error('Transfer "from" is required.')
    if (!isValidSolanaAddress(ix.fromPubkey)) {
      throw new Error('Transfer "from" is not a valid Solana address.')
    }
    if (!ix.toPubkey) throw new Error('Transfer "to" is required.')
    if (!isValidSolanaAddress(ix.toPubkey)) {
      throw new Error('Transfer "to" is not a valid Solana address.')
    }
    const amount = Number(ix.amountSol)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Transfer amount must be a positive number (in SOL).')
    }
    const lamports = BigInt(Math.round(amount * LAMPORTS_PER_SOL))
    return SystemProgram.transfer({
      fromPubkey: new PublicKey(ix.fromPubkey),
      toPubkey: new PublicKey(ix.toPubkey),
      lamports,
    })
  }

  if (ix.type === 'memo') {
    return new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(new TextEncoder().encode(ix.text)),
    })
  }

  if (!ix.programId) throw new Error('Custom instruction programId is required.')
  if (!isValidSolanaAddress(ix.programId)) {
    throw new Error('Custom instruction programId is not a valid Solana address.')
  }

  const keys: AccountMeta[] = ix.accounts.map((acc, idx) => {
    if (!acc.pubkey) throw new Error(`Custom instruction account #${idx + 1} is empty.`)
    if (!isValidSolanaAddress(acc.pubkey)) {
      throw new Error(
        `Custom instruction account #${idx + 1} is not a valid Solana address.`,
      )
    }
    return {
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    }
  })

  const dataBytes = parseInstructionData(ix.data, ix.dataEncoding)

  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys,
    data: Buffer.from(dataBytes),
  })
}

function describeIx(ix: BuilderIx): string {
  if (ix.type === 'system-transfer') return 'System Transfer'
  if (ix.type === 'memo') return 'Memo'
  return 'Custom'
}

export default function BuildAndSign() {
  const { publicKey, connected, signTransaction } = useWallet()
  const { connection } = useConnection()
  const walletBase58 = publicKey ? publicKey.toBase58() : ''

  const [feePayer, setFeePayer] = useState('')
  const [useVersioned, setUseVersioned] = useState(false)
  const [blockhashMode, setBlockhashMode] = useState<BlockhashMode>('rpc')
  const [manualBlockhash, setManualBlockhash] = useState('')
  const [instructions, setInstructions] = useState<BuilderIx[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)

  const effectiveFeePayer = feePayer.trim() || walletBase58

  const canSign = connected && !!publicKey && !!signTransaction

  const addType: IxType = 'system-transfer'
  const [pendingType, setPendingType] = useState<IxType>(addType)

  const addInstruction = () => {
    if (pendingType === 'system-transfer') {
      setInstructions((prev) => [...prev, makeSystemTransfer(walletBase58)])
    } else if (pendingType === 'memo') {
      setInstructions((prev) => [...prev, makeMemo()])
    } else {
      setInstructions((prev) => [...prev, makeCustom()])
    }
  }

  const removeInstruction = (id: string) => {
    setInstructions((prev) => prev.filter((ix) => ix.id !== id))
  }

  const moveInstruction = (id: string, dir: -1 | 1) => {
    setInstructions((prev) => {
      const idx = prev.findIndex((ix) => ix.id === id)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = prev.slice()
      const [item] = next.splice(idx, 1)
      next.splice(newIdx, 0, item)
      return next
    })
  }

  const updateIx = <T extends BuilderIx>(id: string, updater: (ix: T) => T) => {
    setInstructions((prev) =>
      prev.map((ix) => (ix.id === id ? updater(ix as T) : ix)),
    )
  }

  const handleBuild = async (alsoSign: boolean) => {
    setError(null)
    setResult(null)

    if (!effectiveFeePayer) {
      setError('Fee payer is required (connect a wallet or enter one).')
      return
    }
    if (!isValidSolanaAddress(effectiveFeePayer)) {
      setError('Fee payer is not a valid Solana address.')
      return
    }
    if (instructions.length === 0) {
      setError('Add at least one instruction.')
      return
    }
    if (alsoSign && !canSign) {
      setError('Connect a wallet first to sign.')
      return
    }
    if (blockhashMode === 'manual' && !manualBlockhash.trim()) {
      setError('Manual blockhash is empty.')
      return
    }

    setLoading(true)
    try {
      let recentBlockhash: string
      let lastValidBlockHeight: number | null = null
      if (blockhashMode === 'manual') {
        recentBlockhash = manualBlockhash.trim()
      } else {
        const latest = await connection.getLatestBlockhash('finalized')
        recentBlockhash = latest.blockhash
        lastValidBlockHeight = latest.lastValidBlockHeight
      }

      const built: TransactionInstruction[] = instructions.map(buildInstruction)
      const feePayerKey = new PublicKey(effectiveFeePayer)

      let unsignedBytes: Uint8Array
      let signedBytes: Uint8Array | null = null
      let signatures: string[] = []
      let txKind: 'legacy' | 'versioned'

      if (useVersioned) {
        txKind = 'versioned'
        const messageV0 = new TransactionMessage({
          payerKey: feePayerKey,
          recentBlockhash,
          instructions: built,
        }).compileToV0Message()

        const vtx = new VersionedTransaction(messageV0)
        unsignedBytes = vtx.serialize()

        if (alsoSign && signTransaction) {
          const signed = (await signTransaction(vtx)) as VersionedTransaction
          signatures = signed.signatures
            .map((sig) => {
              const allZero = sig.every((b) => b === 0)
              return allZero ? null : bs58.encode(sig)
            })
            .filter((s): s is string => s !== null)
          signedBytes = signed.serialize()
        }
      } else {
        txKind = 'legacy'
        const tx = new Transaction({
          feePayer: feePayerKey,
          recentBlockhash,
        })
        tx.add(...built)

        unsignedBytes = tx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })

        if (alsoSign && signTransaction) {
          const signed = (await signTransaction(tx)) as Transaction
          signatures = signed.signatures
            .map((pair) => (pair.signature ? bs58.encode(pair.signature) : null))
            .filter((s): s is string => s !== null)
          signedBytes = signed.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
        }
      }

      const previewBytes = signedBytes ?? unsignedBytes
      const decodedPreview = decodePreviewFromWire(previewBytes)

      const enrichment = await enrichDecodedTx(connection, {
        accounts: [
          ...(decodedPreview.feePayer ? [decodedPreview.feePayer] : []),
          ...decodedPreview.instructions.flatMap((ix) => [
            ix.programId,
            ...ix.accounts,
          ]),
        ],
        instructions: decodedPreview.instructions.map((ix) => ({
          programId: ix.programId,
          accounts: ix.accounts,
          dataBase64: ix.dataBase64,
        })),
      })

      setResult({
        txKind,
        unsignedTransactionBase64: bytesToBase64(unsignedBytes),
        signedTransactionBase64: signedBytes ? bytesToBase64(signedBytes) : null,
        signatures,
        decodedPreview,
        enrichment,
        lastValidBlockHeight,
      })
    } catch (e) {
      setError(getCreateSignErrorMessage(e, connection.rpcEndpoint))
    } finally {
      setLoading(false)
    }
  }

  const ixSummary = useMemo(
    () => instructions.map((ix, i) => `${i + 1}. ${describeIx(ix)}`).join(' · '),
    [instructions],
  )

  return (
    <section className="card">
      <h2 className="cardTitle">Build custom transaction</h2>
      <p className="cardHelp">
        Compose any number of instructions (system transfers, memos, or raw
        custom instructions) into one transaction. The wallet signs locally; nothing
        is sent.
      </p>
      <p className="cardHelp">
        RPC endpoint: <span className="mono">{connection.rpcEndpoint}</span>
      </p>

      <div className="grid2">
        <div className="field">
          <label className="label" htmlFor="feePayer">
            Fee payer
          </label>
          <input
            id="feePayer"
            className="input"
            value={feePayer}
            onChange={(e) => setFeePayer(e.target.value)}
            placeholder={walletBase58 || 'Base58 address'}
          />
          <div className="row">
            <button
              type="button"
              className="btn secondary"
              onClick={() => setFeePayer(walletBase58)}
              disabled={!walletBase58}
            >
              Use connected wallet
            </button>
          </div>
        </div>

        <div className="field">
          <label className="label">Recent blockhash</label>
          <div className="row" style={{ display: 'flex', gap: 16 }}>
            <label className="check">
              <input
                type="radio"
                name="blockhashMode"
                checked={blockhashMode === 'rpc'}
                onChange={() => setBlockhashMode('rpc')}
              />
              Fetch from RPC
            </label>
            <label className="check">
              <input
                type="radio"
                name="blockhashMode"
                checked={blockhashMode === 'manual'}
                onChange={() => setBlockhashMode('manual')}
              />
              Manual
            </label>
          </div>
          {blockhashMode === 'manual' ? (
            <input
              className="input"
              value={manualBlockhash}
              onChange={(e) => setManualBlockhash(e.target.value)}
              placeholder="Base58 blockhash"
              style={{ marginTop: 6 }}
            />
          ) : null}
        </div>
      </div>

      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={useVersioned}
            onChange={(e) => setUseVersioned(e.target.checked)}
          />
          Use versioned transaction (v0)
        </label>
      </div>

      <div className="resultRow" style={{ marginTop: 16 }}>
        <strong>Instructions ({instructions.length})</strong>
        {ixSummary ? <div className="cardHelp">{ixSummary}</div> : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {instructions.map((ix, idx) => (
          <div
            key={ix.id}
            className="card"
            style={{ borderRadius: 12, padding: 12 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <strong>
                #{idx + 1} {describeIx(ix)}
              </strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => moveInstruction(ix.id, -1)}
                  disabled={idx === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => moveInstruction(ix.id, 1)}
                  disabled={idx === instructions.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => removeInstruction(ix.id)}
                >
                  Remove
                </button>
              </div>
            </div>

            {ix.type === 'system-transfer' ? (
              <SystemTransferEditor
                ix={ix}
                walletBase58={walletBase58}
                onChange={(next) =>
                  updateIx<SystemTransferIx>(ix.id, () => next)
                }
              />
            ) : null}

            {ix.type === 'memo' ? (
              <MemoEditor
                ix={ix}
                onChange={(next) => updateIx<MemoIx>(ix.id, () => next)}
              />
            ) : null}

            {ix.type === 'custom' ? (
              <CustomEditor
                ix={ix}
                onChange={(next) => updateIx<CustomIx>(ix.id, () => next)}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <select
          className="input"
          value={pendingType}
          onChange={(e) => setPendingType(e.target.value as IxType)}
          style={{ maxWidth: 240 }}
        >
          <option value="system-transfer">System Transfer</option>
          <option value="memo">Memo</option>
          <option value="custom">Custom instruction</option>
        </select>
        <button type="button" className="btn" onClick={addInstruction}>
          + Add instruction
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn secondary"
          onClick={() => handleBuild(false)}
          disabled={loading}
        >
          {loading ? 'Working...' : 'Build (no sign)'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => handleBuild(true)}
          disabled={loading || !canSign}
        >
          {loading ? 'Signing...' : 'Build & Sign'}
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {result ? (
        <div className="result">
          <div className="resultRow">
            <strong>Detected:</strong> <span>{result.txKind}</span>
          </div>

          <div className="resultRow">
            <strong>Unsigned tx (base64):</strong>
            <textarea
              className="textarea textareaSmall"
              value={result.unsignedTransactionBase64}
              readOnly
            />
          </div>

          {result.signatures.length > 0 ? (
            <div className="resultRow">
              <strong>Signatures:</strong>
              <pre className="pre">{result.signatures.join('\n')}</pre>
            </div>
          ) : null}

          {result.signedTransactionBase64 ? (
            <div className="resultRow">
              <strong>Signed tx (base64):</strong>
              <textarea
                className="textarea textareaSmall"
                value={result.signedTransactionBase64}
                readOnly
              />
            </div>
          ) : null}

          <div className="resultRow" style={{ marginTop: 18 }}>
            <strong>Preview (decoded):</strong>
          </div>

          <div className="resultRow">
            <strong>Fee payer:</strong>{' '}
            <span className="mono">{result.decodedPreview.feePayer ?? '—'}</span>
          </div>

          <div className="resultRow">
            <strong>Recent blockhash:</strong>{' '}
            <span className="mono">
              {result.decodedPreview.recentBlockhash ?? '—'}
            </span>
          </div>

          {result.lastValidBlockHeight !== null ? (
            <div className="resultRow">
              <strong>lastValidBlockHeight:</strong>{' '}
              <span className="mono">{result.lastValidBlockHeight}</span>
            </div>
          ) : null}

          <div className="resultRow">
            <strong>Instructions:</strong>{' '}
            <span>{result.decodedPreview.instructionCount}</span>
          </div>

          <div className="ixList">
            {result.decodedPreview.instructions.map((ix, i) => {
              const idl = result.enrichment.idlDecodedByIndex.get(i)
              const headerLabel = idl
                ? `${idl.programLabel} · ${idl.method}`
                : ix.known
                  ? `${ix.known.programLabel} · ${ix.known.kindLabel}`
                  : ix.programId
              const programChip = { pubkey: ix.programId, role: 'program' }
              const accountChips = ix.accounts.map((acc, j) => ({
                pubkey: acc,
                role: idl?.accountRoles[j] ?? ix.known?.accountRoles?.[j],
              }))
              return (
                <div key={`${ix.programId}-${i}`} className="ixCard">
                  <div className="ixCardHeader">
                    <div>
                      <span className="ixIndex">#{i + 1}</span>{' '}
                      <strong>{headerLabel}</strong>
                    </div>
                  </div>

                  {idl && idl.args.length > 0 ? (
                    <div className="ixIdlArgs">
                      <strong>IDL args</strong>
                      <pre
                        className="pre"
                        style={{ margin: '6px 0 0', padding: 8 }}
                      >
                        {idl.args
                          .map((a) => `${a.name} (${a.type}): ${a.value}`)
                          .join('\n')}
                      </pre>
                    </div>
                  ) : ix.known && ix.known.fields.length > 0 ? (
                    <div className="ixIdlArgs">
                      <strong>Fields</strong>
                      <pre
                        className="pre"
                        style={{ margin: '6px 0 0', padding: 8 }}
                      >
                        {ix.known.fields
                          .map((f) => `${f.name}: ${f.value}`)
                          .join('\n')}
                      </pre>
                    </div>
                  ) : null}

                  <div className="ixContext">
                    <div className="ixContextLabel">
                      Accounts (click to expand)
                    </div>
                    <div className="chipRow">
                      <AccountChip
                        key={`${i}-prog`}
                        pubkey={programChip.pubkey}
                        role={programChip.role}
                        decoded={result.enrichment.accountInfo.get(
                          programChip.pubkey,
                        )}
                        mintLookup={result.enrichment.mintLookup}
                      />
                      {accountChips.map((c, j) => (
                        <AccountChip
                          key={`${i}-${j}-${c.pubkey}`}
                          pubkey={c.pubkey}
                          role={c.role}
                          decoded={result.enrichment.accountInfo.get(c.pubkey)}
                          mintLookup={result.enrichment.mintLookup}
                        />
                      ))}
                    </div>
                  </div>

                  {!idl && !ix.known ? (
                    <details style={{ marginTop: 8 }}>
                      <summary className="ixContextLabel">
                        Raw data (base64)
                      </summary>
                      <pre
                        className="pre"
                        style={{ margin: '6px 0 0', padding: 8 }}
                      >
                        {ix.dataBase64 || '(empty)'}
                      </pre>
                      {ix.dataText ? (
                        <pre
                          className="pre"
                          style={{ margin: '6px 0 0', padding: 8 }}
                        >
                          utf-8: {ix.dataText}
                        </pre>
                      ) : null}
                    </details>
                  ) : null}
                </div>
              )
            })}
          </div>

          {result.enrichment.errors.length > 0 ? (
            <div className="error" style={{ marginTop: 12 }}>
              {result.enrichment.errors.join('\n')}
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => copyToClipboard(result.unsignedTransactionBase64)}
            >
              Copy unsigned base64
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                copyToClipboard(
                  bytesToJsonByteMap(
                    base64ToBytes(result.unsignedTransactionBase64),
                    {
                      wrapperKey: 'serializedTx',
                      format: 'compact',
                      extra:
                        result.lastValidBlockHeight !== null
                          ? {
                              lastValidBlockHeight:
                                result.lastValidBlockHeight,
                            }
                          : undefined,
                    },
                  ),
                )
              }
            >
              Copy unsigned JSON
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                copyToClipboard(
                  bytesToJsonByteMap(
                    base64ToBytes(result.unsignedTransactionBase64),
                    {
                      wrapperKey: 'serializedTx',
                      format: 'escaped-string',
                      extra:
                        result.lastValidBlockHeight !== null
                          ? {
                              lastValidBlockHeight:
                                result.lastValidBlockHeight,
                            }
                          : undefined,
                    },
                  ),
                )
              }
              title='One-line, backslash-escaped, no outer braces — drop into another JSON body (e.g. \"serializedTx\":{\"0\":3,...})'
            >
              Copy unsigned JSON-escaped
            </button>
            {result.signedTransactionBase64 ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    copyToClipboard(result.signedTransactionBase64 ?? '')
                  }
                >
                  Copy signed base64
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    copyToClipboard(
                      bytesToJsonByteMap(
                        base64ToBytes(result.signedTransactionBase64 ?? ''),
                        {
                          wrapperKey: 'serializedTx',
                          format: 'compact',
                          extra:
                            result.lastValidBlockHeight !== null
                              ? {
                                  lastValidBlockHeight:
                                    result.lastValidBlockHeight,
                                }
                              : undefined,
                        },
                      ),
                    )
                  }
                >
                  Copy signed JSON
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    copyToClipboard(
                      bytesToJsonByteMap(
                        base64ToBytes(result.signedTransactionBase64 ?? ''),
                        {
                          wrapperKey: 'serializedTx',
                          format: 'escaped-string',
                          extra:
                            result.lastValidBlockHeight !== null
                              ? {
                                  lastValidBlockHeight:
                                    result.lastValidBlockHeight,
                                }
                              : undefined,
                        },
                      ),
                    )
                  }
                  title='One-line, backslash-escaped, no outer braces — drop into another JSON body (e.g. \"serializedTx\":{\"0\":3,...})'
                >
                  Copy signed JSON-escaped
                </button>
              </>
            ) : null}
            {result.signatures.length > 0 ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => copyToClipboard(result.signatures[0] ?? '')}
              >
                Copy first signature
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SystemTransferEditor({
  ix,
  walletBase58,
  onChange,
}: {
  ix: SystemTransferIx
  walletBase58: string
  onChange: (next: SystemTransferIx) => void
}) {
  return (
    <div>
      <div className="grid2">
        <div className="field">
          <label className="label">From</label>
          <input
            className="input"
            value={ix.fromPubkey}
            onChange={(e) => onChange({ ...ix, fromPubkey: e.target.value })}
            placeholder={walletBase58 || 'Base58 address'}
          />
          <div className="row">
            <button
              type="button"
              className="btn secondary"
              onClick={() => onChange({ ...ix, fromPubkey: walletBase58 })}
              disabled={!walletBase58}
            >
              Use connected wallet
            </button>
          </div>
        </div>
        <div className="field">
          <label className="label">To</label>
          <input
            className="input"
            value={ix.toPubkey}
            onChange={(e) => onChange({ ...ix, toPubkey: e.target.value })}
            placeholder="Base58 address"
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Amount (SOL)</label>
        <input
          className="input"
          value={ix.amountSol}
          onChange={(e) => onChange({ ...ix, amountSol: e.target.value })}
          placeholder="0.001"
        />
      </div>
    </div>
  )
}

function MemoEditor({
  ix,
  onChange,
}: {
  ix: MemoIx
  onChange: (next: MemoIx) => void
}) {
  return (
    <div className="field">
      <label className="label">Memo text</label>
      <input
        className="input"
        value={ix.text}
        onChange={(e) => onChange({ ...ix, text: e.target.value })}
        placeholder="Any text"
      />
    </div>
  )
}

function CustomEditor({
  ix,
  onChange,
}: {
  ix: CustomIx
  onChange: (next: CustomIx) => void
}) {
  const updateAccount = (id: string, patch: Partial<AccountInput>) => {
    onChange({
      ...ix,
      accounts: ix.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })
  }

  const removeAccount = (id: string) => {
    onChange({ ...ix, accounts: ix.accounts.filter((a) => a.id !== id) })
  }

  return (
    <div>
      <div className="field">
        <label className="label">Program ID</label>
        <input
          className="input"
          value={ix.programId}
          onChange={(e) => onChange({ ...ix, programId: e.target.value })}
          placeholder="Base58 program address"
        />
      </div>

      <div className="field">
        <label className="label">Accounts ({ix.accounts.length})</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ix.accounts.map((acc, i) => (
            <div
              key={acc.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span className="mono" style={{ minWidth: 28 }}>
                #{i + 1}
              </span>
              <input
                className="input"
                value={acc.pubkey}
                onChange={(e) => updateAccount(acc.id, { pubkey: e.target.value })}
                placeholder="Base58 address"
                style={{ flex: 1, minWidth: 220 }}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={acc.isSigner}
                  onChange={(e) =>
                    updateAccount(acc.id, { isSigner: e.target.checked })
                  }
                />
                signer
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acc.isWritable}
                  onChange={(e) =>
                    updateAccount(acc.id, { isWritable: e.target.checked })
                  }
                />
                writable
              </label>
              <button
                type="button"
                className="btn secondary"
                onClick={() => removeAccount(acc.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              onChange({ ...ix, accounts: [...ix.accounts, makeAccount()] })
            }
          >
            + Add account
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="label">Data encoding</label>
          <select
            className="input"
            value={ix.dataEncoding}
            onChange={(e) =>
              onChange({ ...ix, dataEncoding: e.target.value as DataEncoding })
            }
          >
            <option value="base64">base64</option>
            <option value="hex">hex</option>
            <option value="utf-8">utf-8</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Data</label>
          <textarea
            className="textarea"
            value={ix.data}
            onChange={(e) => onChange({ ...ix, data: e.target.value })}
            placeholder={
              ix.dataEncoding === 'base64'
                ? 'Base64-encoded instruction data'
                : ix.dataEncoding === 'hex'
                  ? '0xabcdef... (hex)'
                  : 'Raw text'
            }
            rows={3}
          />
        </div>
      </div>
    </div>
  )
}
