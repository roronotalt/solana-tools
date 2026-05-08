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
import { bytesToBase64 } from '../lib/base64'
import {
  MEMO_PROGRAM_ID,
  decodePreviewFromWire,
  getCreateSignErrorMessage,
  isValidSolanaAddress,
} from '../lib/tx'
import type { TxPreview } from '../lib/tx'

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

type SignedResult = {
  txKind: 'legacy' | 'versioned'
  unsignedTransactionBase64: string
  signedTransactionBase64: string
  signatures: string[]
  decodedPreview: TxPreview
}

export default function GenerateAndSign() {
  const { publicKey, connected, signTransaction } = useWallet()
  const { connection } = useConnection()

  const [recipient, setRecipient] = useState('')
  const [amountSol, setAmountSol] = useState('0.001')
  const [memo, setMemo] = useState('')
  const [useVersioned, setUseVersioned] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SignedResult | null>(null)

  const canSign = connected && publicKey && signTransaction

  const handleCreateAndSign = async () => {
    setError(null)
    setResult(null)

    if (!canSign) {
      setError('Connect a wallet first.')
      return
    }
    if (!signTransaction) {
      setError('This wallet does not support signing transactions.')
      return
    }

    const to = recipient.trim()
    if (!to) {
      setError('Recipient is required.')
      return
    }
    if (!isValidSolanaAddress(to)) {
      setError('Recipient is not a valid Solana address.')
      return
    }

    const amount = Number(amountSol)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number (in SOL).')
      return
    }
    const lamports = BigInt(Math.round(amount * LAMPORTS_PER_SOL))

    setLoading(true)
    try {
      const latest = await connection.getLatestBlockhash('finalized')
      const recentBlockhash = latest.blockhash

      const transferIx = SystemProgram.transfer({
        fromPubkey: publicKey!,
        toPubkey: new PublicKey(to),
        lamports,
      })

      const instructions: TransactionInstruction[] = [transferIx]
      const memoTrimmed = memo.trim()
      if (memoTrimmed) {
        instructions.push(
          new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [],
            data: Buffer.from(new TextEncoder().encode(memoTrimmed)),
          }),
        )
      }

      if (useVersioned) {
        const messageV0 = new TransactionMessage({
          payerKey: publicKey!,
          recentBlockhash,
          instructions,
        }).compileToV0Message()

        const vtx = new VersionedTransaction(messageV0)
        const unsignedBytes = vtx.serialize()
        const unsignedTransactionBase64 = bytesToBase64(unsignedBytes)

        const signed = (await signTransaction(vtx)) as VersionedTransaction

        const signatures = signed.signatures.map((sig) => bs58.encode(sig))
        const signedBytes = signed.serialize()
        const signedTransactionBase64 = bytesToBase64(signedBytes)
        const decodedPreview = decodePreviewFromWire(signedBytes)

        setResult({
          txKind: 'versioned',
          unsignedTransactionBase64,
          signatures,
          signedTransactionBase64,
          decodedPreview,
        })
        return
      }

      const tx = new Transaction({
        feePayer: publicKey!,
        recentBlockhash,
      })
      tx.add(...instructions)

      const unsignedBytes = tx.serialize()
      const unsignedTransactionBase64 = bytesToBase64(unsignedBytes)

      const signed = (await signTransaction(tx)) as Transaction

      const signatures = signed.signatures
        .map((pair) => (pair.signature ? bs58.encode(pair.signature) : null))
        .filter((s): s is string => s !== null)

      const signedBytes = signed.serialize()
      const signedTransactionBase64 = bytesToBase64(signedBytes)
      const decodedPreview = decodePreviewFromWire(signedBytes)

      setResult({
        txKind: 'legacy',
        unsignedTransactionBase64,
        signatures,
        signedTransactionBase64,
        decodedPreview,
      })
    } catch (e) {
      setError(getCreateSignErrorMessage(e, connection.rpcEndpoint))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card">
      <h2 className="cardTitle">Generate and sign (no send)</h2>
      <p className="cardHelp">
        This builds a transfer transaction locally, asks your wallet to sign it,
        and shows the resulting signature + signed transaction base64.
      </p>
      <p className="cardHelp">
        Configured transaction network: <span className="mono">mainnet-beta</span>.
        Your wallet must also be on mainnet to sign.
      </p>
      <p className="cardHelp">
        RPC endpoint: <span className="mono">{connection.rpcEndpoint}</span>
      </p>

      <div className="grid2">
        <div className="field">
          <label className="label" htmlFor="recipient">
            Recipient
          </label>
          <input
            id="recipient"
            className="input"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Base58 address"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="amountSol">
            Amount (SOL)
          </label>
          <input
            id="amountSol"
            className="input"
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value)}
            placeholder="0.001"
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="memo">
          Memo (optional)
        </label>
        <input
          id="memo"
          className="input"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Any text you want to attach"
        />
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

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={handleCreateAndSign}
          disabled={loading || !canSign}
        >
          {loading ? 'Signing...' : 'Create & Sign'}
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

          <div className="resultRow">
            <strong>Signatures:</strong>
            <pre className="pre">{result.signatures.join('\n')}</pre>
          </div>

          <div className="resultRow">
            <strong>Signed tx (base64):</strong>
            <textarea
              className="textarea textareaSmall"
              value={result.signedTransactionBase64}
              readOnly
            />
          </div>

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

          <div className="resultRow">
            <strong>Instructions:</strong>{' '}
            <span>{result.decodedPreview.instructionCount}</span>
          </div>

          <div className="resultRow">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {result.decodedPreview.instructions.map((ix, idx) => (
                <details key={`${ix.programId}-${idx}`}>
                  <summary>
                    Instruction {idx + 1}:{' '}
                    <span className="mono">{ix.programId}</span>
                  </summary>
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div>
                      <strong>Accounts:</strong>
                      <pre className="pre" style={{ margin: 0 }}>
                        {ix.accounts.join('\n') || '—'}
                      </pre>
                    </div>
                    <div>
                      <strong>Data (base64):</strong>
                      <pre className="pre" style={{ margin: 0 }}>
                        {ix.dataBase64}
                      </pre>
                    </div>
                    {ix.dataText ? (
                      <div>
                        <strong>Data (utf-8 best-effort):</strong>
                        <pre className="pre" style={{ margin: 0 }}>
                          {ix.dataText}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </div>

          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() =>
                copyToClipboard(result.signatures[0] ?? '')
              }
              disabled={result.signatures.length === 0}
            >
              Copy first signature
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                copyToClipboard(result.signedTransactionBase64)
              }
            >
              Copy signed tx base64
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

