import { useState } from 'react'
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
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { base64ToBytes, bytesToBase64 } from '../lib/base64'
import {
  bytesToJsonByteMap,
  decodePreviewFromWire,
  getCreateSignErrorMessage,
} from '../lib/tx'
import type { TxPreview } from '../lib/tx'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '../lib/instructionDecoder'
import { enrichDecodedTx } from '../lib/enrichment'
import type { EnrichmentResult } from '../lib/enrichment'
import AccountChip from './AccountChip'

type Mode = 'wrap' | 'unwrap'

type WrapResult = {
  txKind: 'legacy' | 'versioned'
  ata: string
  unsignedTransactionBase64: string
  signedTransactionBase64: string | null
  signatures: string[]
  decodedPreview: TxPreview
  enrichment: EnrichmentResult
  lastValidBlockHeight: number | null
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

function deriveWsolAta(owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), NATIVE_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

function createAssociatedTokenAccountIdempotentIx(
  funder: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  })
}

function syncNativeIx(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  })
}

function closeAccountIx(
  account: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  })
}

export default function WrapUnwrapSol() {
  const { publicKey, connected, signTransaction } = useWallet()
  const { connection } = useConnection()

  const [mode, setMode] = useState<Mode>('wrap')
  const [amountSol, setAmountSol] = useState('0.01')
  const [useVersioned, setUseVersioned] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WrapResult | null>(null)

  const canSign = connected && !!publicKey && !!signTransaction
  const ataPreview = publicKey ? deriveWsolAta(publicKey).toBase58() : '—'

  const handleRun = async (alsoSign: boolean) => {
    setError(null)
    setResult(null)

    if (!publicKey) {
      setError('Connect a wallet first.')
      return
    }
    if (alsoSign && !canSign) {
      setError('Connect a wallet first to sign.')
      return
    }

    let lamports: bigint = 0n
    if (mode === 'wrap') {
      const amount = Number(amountSol)
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Amount must be a positive number (in SOL).')
        return
      }
      lamports = BigInt(Math.round(amount * LAMPORTS_PER_SOL))
    }

    setLoading(true)
    try {
      const ata = deriveWsolAta(publicKey)
      const latest = await connection.getLatestBlockhash('finalized')
      const recentBlockhash = latest.blockhash
      const lastValidBlockHeight = latest.lastValidBlockHeight

      const instructions: TransactionInstruction[] =
        mode === 'wrap'
          ? [
              createAssociatedTokenAccountIdempotentIx(
                publicKey,
                ata,
                publicKey,
                NATIVE_MINT,
              ),
              SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: ata,
                lamports,
              }),
              syncNativeIx(ata),
            ]
          : [closeAccountIx(ata, publicKey, publicKey)]

      let unsignedBytes: Uint8Array
      let signedBytes: Uint8Array | null = null
      let signatures: string[] = []
      let txKind: 'legacy' | 'versioned'

      if (useVersioned) {
        txKind = 'versioned'
        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash,
          instructions,
        }).compileToV0Message()
        const vtx = new VersionedTransaction(messageV0)
        unsignedBytes = vtx.serialize()

        if (alsoSign && signTransaction) {
          const signed = (await signTransaction(vtx)) as VersionedTransaction
          signatures = signed.signatures
            .map((sig) =>
              sig.every((b) => b === 0) ? null : bs58.encode(sig),
            )
            .filter((s): s is string => s !== null)
          signedBytes = signed.serialize()
        }
      } else {
        txKind = 'legacy'
        const tx = new Transaction({
          feePayer: publicKey,
          recentBlockhash,
        })
        tx.add(...instructions)
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
          ata.toBase58(),
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
        ata: ata.toBase58(),
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

  return (
    <section className="card">
      <h2 className="cardTitle">Wrap / Unwrap SOL</h2>
      <p className="cardHelp">
        Wraps native SOL into wSOL (mint{' '}
        <span className="mono">{NATIVE_MINT.toBase58()}</span>) using
        create-idempotent ATA + transfer + syncNative, or unwraps by closing
        the wSOL ATA (refunds the held SOL plus rent).
      </p>
      <p className="cardHelp">
        Your wSOL ATA: <span className="mono">{ataPreview}</span>
      </p>
      <p className="cardHelp">
        RPC endpoint: <span className="mono">{connection.rpcEndpoint}</span>
      </p>

      <div className="row" style={{ display: 'flex', gap: 16 }}>
        <label className="check">
          <input
            type="radio"
            name="mode"
            checked={mode === 'wrap'}
            onChange={() => setMode('wrap')}
          />
          Wrap SOL → wSOL
        </label>
        <label className="check">
          <input
            type="radio"
            name="mode"
            checked={mode === 'unwrap'}
            onChange={() => setMode('unwrap')}
          />
          Unwrap wSOL → SOL
        </label>
      </div>

      {mode === 'wrap' ? (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="wrapAmount">
            Amount (SOL)
          </label>
          <input
            id="wrapAmount"
            className="input"
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value)}
            placeholder="0.01"
          />
        </div>
      ) : (
        <p className="cardHelp" style={{ marginTop: 12 }}>
          Closing the wSOL ATA returns its full SOL balance (the wrapped
          amount + the rent reserve) to your wallet.
        </p>
      )}

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

      <div className="actions">
        <button
          type="button"
          className="btn secondary"
          onClick={() => handleRun(false)}
          disabled={loading || !connected}
        >
          {loading ? 'Working...' : 'Build (no sign)'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => handleRun(true)}
          disabled={loading || !canSign}
        >
          {loading ? 'Signing...' : 'Build & Sign'}
        </button>
      </div>

      {!canSign ? (
        <p className="cardHelp" style={{ marginTop: 8 }}>
          Connect a wallet to enable signing.
        </p>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {result ? (
        <div className="result">
          <div className="resultRow">
            <strong>Detected:</strong> <span>{result.txKind}</span>
          </div>

          <div className="resultRow">
            <strong>wSOL ATA:</strong>{' '}
            <span className="mono">{result.ata}</span>
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
            <span className="mono">
              {result.decodedPreview.feePayer ?? '—'}
            </span>
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
                        pubkey={ix.programId}
                        role="program"
                        decoded={result.enrichment.accountInfo.get(
                          ix.programId,
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
          </div>
        </div>
      ) : null}
    </section>
  )
}
