import { useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { base64ToBytes, bytesToBase64 } from '../lib/base64'
import {
  bytesToJsonByteMap,
  decodePreviewFromWire,
  parseTxInput,
} from '../lib/tx'
import type { TxInputMeta, TxPreview } from '../lib/tx'
import { decodeKnownInstruction } from '../lib/instructionDecoder'
import { enrichDecodedTx } from '../lib/enrichment'
import type { EnrichmentResult } from '../lib/enrichment'
import {
  EDITABLE_KIND_LABEL,
  buildEditableIx,
  chipsForEditable,
  editableFromDecoded,
  makeBlankCustom,
  requiredSignersForEditable,
} from '../lib/editableTx'
import type { EditableIx, IdlMatch } from '../lib/editableTx'
import {
  ComputeUnitLimitEditor,
  ComputeUnitPriceEditor,
  CustomEditor,
  IdlInstructionEditor,
  MemoEditor,
  SystemTransferEditor,
  TokenCloseAccountEditor,
  TokenSyncNativeEditor,
  TokenTransferCheckedEditor,
  TokenTransferEditor,
} from './IxEditors'
import AccountChip from './AccountChip'

type DecodedTx = {
  txKind: 'legacy' | 'versioned'
  feePayer: string
  recentBlockhash: string
  inputSource: 'base64' | 'json'
  inputMeta?: TxInputMeta
  preview: TxPreview
  enrichment: EnrichmentResult
  originalBytes: Uint8Array
}

type EditableTx = {
  feePayer: string
  recentBlockhash: string
  lastValidBlockHeight: number | null
  useVersioned: boolean
  instructions: EditableIx[]
}

type SignedOut = {
  txKind: 'legacy' | 'versioned'
  unsignedTransactionBase64: string
  signedTransactionBase64: string | null
  signatures: string[]
  preview: TxPreview
  enrichment: EnrichmentResult
  lastValidBlockHeight: number | null
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

function decodeBytesToTxFields(
  bytes: Uint8Array,
): { txKind: 'legacy' | 'versioned'; feePayer: string; recentBlockhash: string; preview: TxPreview } {
  const preview = decodePreviewFromWire(bytes)
  return {
    txKind: preview.txKind,
    feePayer: preview.feePayer ?? '',
    recentBlockhash: preview.recentBlockhash ?? '',
    preview,
  }
}

function buildEditableFromPreview(
  preview: TxPreview,
  enrichment: EnrichmentResult,
  useVersioned: boolean,
  feePayer: string,
  recentBlockhash: string,
  lastValidBlockHeight: number | null,
): EditableTx {
  const instructions: EditableIx[] = preview.instructions.map((ix, i) => {
    const data = base64ToBytes(ix.dataBase64)
    const idlDecoded = enrichment.idlDecodedByIndex.get(i)
    const idl = enrichment.idlsByProgram.get(ix.programId)

    let idlMatch: IdlMatch | undefined
    if (idlDecoded && idl) {
      const idlIx = idl.instructions.find((x) => x.name === idlDecoded.method)
      if (idlIx) {
        // discriminator = first 8 bytes of the instruction data
        const discriminator = data.slice(0, 8)
        idlMatch = {
          idlInstruction: idlIx,
          decoded: idlDecoded,
          discriminator,
          programLabel: idlDecoded.programLabel,
        }
      }
    }

    return editableFromDecoded({
      programId: ix.programId,
      accounts: ix.accounts,
      accountMetas: ix.accountMetas,
      dataBase64: ix.dataBase64,
      data,
      known: ix.known ?? decodeKnownInstruction(ix.programId, ix.accounts, data),
      idlMatch,
      idlSummary: idlDecoded
        ? `${idlDecoded.programLabel} · ${idlDecoded.method}`
        : undefined,
    })
  })

  return {
    feePayer,
    recentBlockhash,
    lastValidBlockHeight,
    useVersioned,
    instructions,
  }
}

function getDecodeErrorMessage(error: unknown): string {
  const fallback = 'Failed to decode the input.'
  if (!(error instanceof Error)) return fallback
  const msg = error.message
  if (msg.includes('Reached end of buffer unexpectedly')) {
    return 'Transaction bytes are incomplete.'
  }
  if (msg.includes('Invalid base64') || msg.includes('atob')) {
    return 'Invalid base64. Check the input.'
  }
  return msg || fallback
}

export default function SignArbitrary() {
  const { publicKey, connected, signTransaction } = useWallet()
  const { connection } = useConnection()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [decoded, setDecoded] = useState<DecodedTx | null>(null)
  const [editable, setEditable] = useState<EditableTx | null>(null)
  const [signed, setSigned] = useState<SignedOut | null>(null)

  const walletPubkey = publicKey ? publicKey.toBase58() : ''
  const canSign = connected && !!publicKey && !!signTransaction

  const handleDecode = async () => {
    setError(null)
    setDecoded(null)
    setEditable(null)
    setSigned(null)

    const trimmed = input.trim()
    if (!trimmed) {
      setError('Paste a serialized transaction first.')
      return
    }

    setLoading(true)
    try {
      const parsed = parseTxInput(trimmed)
      const { txKind, feePayer, recentBlockhash, preview } =
        decodeBytesToTxFields(parsed.bytes)

      const enrichment = await enrichDecodedTx(connection, {
        accounts: [
          ...(preview.feePayer ? [preview.feePayer] : []),
          ...preview.instructions.flatMap((ix) => [
            ix.programId,
            ...ix.accounts,
          ]),
        ],
        instructions: preview.instructions.map((ix) => ({
          programId: ix.programId,
          accounts: ix.accounts,
          dataBase64: ix.dataBase64,
        })),
      })

      const dec: DecodedTx = {
        txKind,
        feePayer,
        recentBlockhash,
        inputSource: parsed.source,
        inputMeta: parsed.meta,
        preview,
        enrichment,
        originalBytes: parsed.bytes,
      }
      setDecoded(dec)
      setEditable(
        buildEditableFromPreview(
          preview,
          enrichment,
          txKind === 'versioned',
          feePayer,
          recentBlockhash,
          parsed.meta?.lastValidBlockHeight ?? null,
        ),
      )
    } catch (e) {
      setError(getDecodeErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    if (!decoded) return
    setEditable(
      buildEditableFromPreview(
        decoded.preview,
        decoded.enrichment,
        decoded.txKind === 'versioned',
        decoded.feePayer,
        decoded.recentBlockhash,
        decoded.inputMeta?.lastValidBlockHeight ?? null,
      ),
    )
    setSigned(null)
  }

  const handleClear = () => {
    setInput('')
    setError(null)
    setDecoded(null)
    setEditable(null)
    setSigned(null)
  }

  const handleFetchBlockhash = async () => {
    if (!editable) return
    setError(null)
    try {
      const latest = await connection.getLatestBlockhash('finalized')
      setEditable({
        ...editable,
        recentBlockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      })
    } catch (e) {
      setError(
        `Failed to fetch latest blockhash: ${e instanceof Error ? e.message : 'unknown'}`,
      )
    }
  }

  const updateIx = (id: string, next: EditableIx) => {
    if (!editable) return
    setEditable({
      ...editable,
      instructions: editable.instructions.map((ix) =>
        ix.id === id ? next : ix,
      ),
    })
  }

  const removeIx = (id: string) => {
    if (!editable) return
    setEditable({
      ...editable,
      instructions: editable.instructions.filter((ix) => ix.id !== id),
    })
  }

  const moveIx = (id: string, dir: -1 | 1) => {
    if (!editable) return
    const arr = editable.instructions
    const idx = arr.findIndex((ix) => ix.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= arr.length) return
    const copy = arr.slice()
    const [item] = copy.splice(idx, 1)
    copy.splice(next, 0, item)
    setEditable({ ...editable, instructions: copy })
  }

  const addCustomIx = () => {
    if (!editable) return
    setEditable({
      ...editable,
      instructions: [...editable.instructions, makeBlankCustom()],
    })
  }

  const handleSignAsPasted = async () => {
    setError(null)
    setSigned(null)
    if (!decoded) return
    if (!canSign || !signTransaction) {
      setError('Connect a wallet first to sign.')
      return
    }

    setLoading(true)
    try {
      const bytes = decoded.originalBytes
      let signedBytes: Uint8Array
      let signatures: string[] = []

      if (decoded.txKind === 'versioned') {
        const vtx = VersionedTransaction.deserialize(bytes)
        const signedV = (await signTransaction(vtx)) as VersionedTransaction
        signatures = signedV.signatures
          .map((sig) => (sig.every((b) => b === 0) ? null : bs58.encode(sig)))
          .filter((s): s is string => s !== null)
        signedBytes = signedV.serialize()
      } else {
        const tx = Transaction.from(bytes)
        const signedT = (await signTransaction(tx)) as Transaction
        signatures = signedT.signatures
          .map((p) => (p.signature ? bs58.encode(p.signature) : null))
          .filter((s): s is string => s !== null)
        signedBytes = signedT.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
      }

      const preview = decodePreviewFromWire(signedBytes)
      const enrichment = await enrichDecodedTx(connection, {
        accounts: [
          ...(preview.feePayer ? [preview.feePayer] : []),
          ...preview.instructions.flatMap((ix) => [
            ix.programId,
            ...ix.accounts,
          ]),
        ],
        instructions: preview.instructions.map((ix) => ({
          programId: ix.programId,
          accounts: ix.accounts,
          dataBase64: ix.dataBase64,
        })),
      })

      setSigned({
        txKind: decoded.txKind,
        unsignedTransactionBase64: bytesToBase64(bytes),
        signedTransactionBase64: bytesToBase64(signedBytes),
        signatures,
        preview,
        enrichment,
        lastValidBlockHeight:
          editable?.lastValidBlockHeight ??
          decoded.inputMeta?.lastValidBlockHeight ??
          null,
      })
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Unknown error'
      const name =
        e && typeof e === 'object' && 'name' in e
          ? String((e as { name: unknown }).name)
          : ''
      if (name === 'WalletSignTransactionError') {
        const lower = msg.toLowerCase()
        if (lower.includes('user rejected') || lower.includes('rejected')) {
          msg = 'You dismissed the wallet popup before approving.'
        } else if (
          lower.includes('not a signer') ||
          lower.includes('unknown signer')
        ) {
          msg =
            `Wallet refused to sign because the connected pubkey (${walletPubkey}) ` +
            `isn't in this transaction's signers list.`
        } else {
          msg = `Wallet refused to sign: ${msg}.`
        }
      }
      setError(`Failed to sign as pasted: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (alsoSign: boolean) => {
    setError(null)
    setSigned(null)
    if (!editable) return

    if (alsoSign && !canSign) {
      setError('Connect a wallet first to sign.')
      return
    }

    if (!editable.feePayer.trim()) {
      setError('Fee payer is required.')
      return
    }
    if (!editable.recentBlockhash.trim()) {
      setError('Recent blockhash is required.')
      return
    }
    if (editable.instructions.length === 0) {
      setError('At least one instruction is required.')
      return
    }

    if (alsoSign) {
      const required = requiredSignersForEditable({
        feePayer: editable.feePayer,
        instructions: editable.instructions,
      })
      if (!required.includes(walletPubkey)) {
        setError(
          `Your wallet (${walletPubkey}) is not a required signer for this transaction. ` +
            `Required signers: ${required.join(', ') || '(none)'}. ` +
            `Edit the fee payer (or a signer field) to your wallet, or connect the wallet that matches one of these.`,
        )
        return
      }
    }

    setLoading(true)
    try {
      const built = editable.instructions.map(buildEditableIx)
      const feePayerKey = new PublicKey(editable.feePayer.trim())
      const recentBlockhash = editable.recentBlockhash.trim()

      let unsignedBytes: Uint8Array
      let signedBytes: Uint8Array | null = null
      let signatures: string[] = []

      if (editable.useVersioned) {
        const messageV0 = new TransactionMessage({
          payerKey: feePayerKey,
          recentBlockhash,
          instructions: built,
        }).compileToV0Message()
        const vtx = new VersionedTransaction(messageV0)
        unsignedBytes = vtx.serialize()
        if (alsoSign && signTransaction) {
          const signedV = (await signTransaction(vtx)) as VersionedTransaction
          signatures = signedV.signatures
            .map((sig) => (sig.every((b) => b === 0) ? null : bs58.encode(sig)))
            .filter((s): s is string => s !== null)
          signedBytes = signedV.serialize()
        }
      } else {
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
          const signedT = (await signTransaction(tx)) as Transaction
          signatures = signedT.signatures
            .map((p) => (p.signature ? bs58.encode(p.signature) : null))
            .filter((s): s is string => s !== null)
          signedBytes = signedT.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
        }
      }

      const previewBytes = signedBytes ?? unsignedBytes
      const preview = decodePreviewFromWire(previewBytes)

      const enrichment = await enrichDecodedTx(connection, {
        accounts: [
          ...(preview.feePayer ? [preview.feePayer] : []),
          ...preview.instructions.flatMap((ix) => [
            ix.programId,
            ...ix.accounts,
          ]),
        ],
        instructions: preview.instructions.map((ix) => ({
          programId: ix.programId,
          accounts: ix.accounts,
          dataBase64: ix.dataBase64,
        })),
      })

      setSigned({
        txKind: editable.useVersioned ? 'versioned' : 'legacy',
        unsignedTransactionBase64: bytesToBase64(unsignedBytes),
        signedTransactionBase64: signedBytes ? bytesToBase64(signedBytes) : null,
        signatures,
        preview,
        enrichment,
        lastValidBlockHeight: editable.lastValidBlockHeight,
      })
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Unknown error'
      const name =
        e && typeof e === 'object' && 'name' in e
          ? String((e as { name: unknown }).name)
          : ''
      if (name === 'WalletSignTransactionError') {
        const lower = msg.toLowerCase()
        if (lower.includes('user rejected') || lower.includes('rejected')) {
          msg = 'You dismissed the wallet popup before approving.'
        } else if (
          lower.includes('not a signer') ||
          lower.includes('unknown signer')
        ) {
          msg =
            `Wallet refused to sign because the connected pubkey (${walletPubkey}) ` +
            `isn't in this transaction's signers list. Edit the fee payer / signer fields to your wallet.`
        } else {
          msg =
            `Wallet refused to sign: ${msg}. ` +
            `If this is a multi-signer tx, the wallet only signs its own slot — that's expected.`
        }
      }
      setError(`Failed to ${alsoSign ? 'build & sign' : 'build'}: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  const ixSummary = useMemo(() => {
    if (!editable) return ''
    return editable.instructions
      .map((ix, i) => `${i + 1}. ${EDITABLE_KIND_LABEL[ix.kind]}`)
      .join(' · ')
  }, [editable])

  return (
    <section className="card">
      <h2 className="cardTitle">Sign serialized transaction</h2>
      <p className="cardHelp">
        Paste base64 or JSON. The app decodes, fetches on-chain account data
        and program IDLs, and lets you edit any field before signing. Nothing
        is sent.
      </p>

      <div className="field">
        <label className="label" htmlFor="txInput">
          Serialized transaction
        </label>
        <textarea
          id="txInput"
          className="textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='base64 string, or JSON like {"serializedTransaction":{"0":3,...},"lastValidBlockHeight":123}'
          rows={8}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={handleDecode}
          disabled={loading || !input.trim()}
        >
          {loading && !signed ? 'Decoding...' : 'Decode'}
        </button>
        {decoded ? (
          <button
            type="button"
            className="btn ghost"
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </button>
        ) : null}
      </div>

      {error ? <div className="error">{error}</div> : null}

      {decoded && editable ? (
        <>
          <div className="sectionDivider" />

          <div className="resultRow">
            <div className="sectionHeader">
              <strong>Decoded · editable</strong>
              <span className="pill">{decoded.txKind}</span>
              <span className="pill ghost">input: {decoded.inputSource}</span>
              {(() => {
                const signed = decoded.preview.signers.filter(
                  (s) => s.signature !== null,
                ).length
                const total = decoded.preview.signers.length
                if (total === 0) return null
                if (signed === total) {
                  return (
                    <span className="pill ok">
                      fully signed ({signed}/{total})
                    </span>
                  )
                }
                if (signed === 0) {
                  return (
                    <span className="pill warn">
                      unsigned (0/{total} signers)
                    </span>
                  )
                }
                return (
                  <span className="pill warn">
                    partial ({signed}/{total} signers)
                  </span>
                )
              })()}
            </div>
            <p className="cardHelp">
              <strong>Sign as pasted</strong> signs the original bytes and
              keeps any existing partial signatures intact.{' '}
              <strong>Sign with edits</strong> rebuilds the tx from your edits
              (which invalidates any other signers' signatures).
            </p>
          </div>

          {decoded.preview.signers.length > 0 ? (
            <div className="resultRow">
              <strong>Signers ({decoded.preview.signers.length}):</strong>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {decoded.preview.signers.map((s, i) => {
                  const isWallet = s.pubkey === walletPubkey
                  return (
                    <div
                      key={`${s.pubkey}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        className={`pill ${s.signature ? 'ok' : 'warn'}`}
                      >
                        {s.signature ? 'signed' : 'pending'}
                      </span>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {s.pubkey}
                      </span>
                      {isWallet ? (
                        <span className="pill ghost">your wallet</span>
                      ) : null}
                      {s.signature ? (
                        <details style={{ flexBasis: '100%' }}>
                          <summary
                            className="cardHelp"
                            style={{ cursor: 'pointer' }}
                          >
                            view signature
                          </summary>
                          <pre className="pre" style={{ margin: '4px 0 0' }}>
                            {s.signature}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {decoded.inputMeta &&
          (decoded.inputMeta.lastValidBlockHeight !== undefined ||
            decoded.inputMeta.success !== undefined) ? (
            <div className="resultRow">
              <strong>Input metadata:</strong>
              <pre className="pre">
                {[
                  decoded.inputMeta.lastValidBlockHeight !== undefined
                    ? `lastValidBlockHeight: ${decoded.inputMeta.lastValidBlockHeight}`
                    : null,
                  decoded.inputMeta.success !== undefined
                    ? `success: ${decoded.inputMeta.success}`
                    : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
              </pre>
            </div>
          ) : null}

          <div className="grid2">
            <div className="field">
              <label className="label" htmlFor="feePayerEdit">
                Fee payer
              </label>
              <input
                id="feePayerEdit"
                className="input"
                value={editable.feePayer}
                onChange={(e) =>
                  setEditable({ ...editable, feePayer: e.target.value })
                }
              />
              {walletPubkey ? (
                <button
                  type="button"
                  className="btn ghost btnSm"
                  onClick={() =>
                    setEditable({ ...editable, feePayer: walletPubkey })
                  }
                >
                  Use wallet
                </button>
              ) : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="bhEdit">
                Recent blockhash
              </label>
              <input
                id="bhEdit"
                className="input"
                value={editable.recentBlockhash}
                onChange={(e) =>
                  setEditable({
                    ...editable,
                    recentBlockhash: e.target.value,
                  })
                }
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  className="btn ghost btnSm"
                  onClick={handleFetchBlockhash}
                >
                  Fetch latest from RPC
                </button>
                <span className="cardHelp" style={{ fontSize: 13 }}>
                  lastValidBlockHeight:{' '}
                  <span className="mono">
                    {editable.lastValidBlockHeight ?? '—'}
                  </span>
                </span>
              </div>
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label className="label" htmlFor="lvbhEdit">
                  lastValidBlockHeight (optional, for export)
                </label>
                <input
                  id="lvbhEdit"
                  className="input"
                  value={editable.lastValidBlockHeight ?? ''}
                  placeholder="auto-populated when fetching from RPC"
                  onChange={(e) => {
                    const trimmed = e.target.value.trim()
                    if (trimmed === '') {
                      setEditable({
                        ...editable,
                        lastValidBlockHeight: null,
                      })
                      return
                    }
                    const n = Number(trimmed)
                    if (Number.isInteger(n) && n >= 0) {
                      setEditable({ ...editable, lastValidBlockHeight: n })
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={editable.useVersioned}
                onChange={(e) =>
                  setEditable({ ...editable, useVersioned: e.target.checked })
                }
              />
              Versioned transaction (v0)
            </label>
          </div>

          <div className="resultRow">
            <div className="sectionHeader">
              <strong>Instructions ({editable.instructions.length})</strong>
            </div>
            {ixSummary ? <p className="cardHelp">{ixSummary}</p> : null}
          </div>

          <div className="ixList">
            {editable.instructions.map((ix, idx) => {
              const idl = decoded.enrichment.idlDecodedByIndex.get(idx)
              const chips = chipsForEditable(ix, idl?.accountRoles)
              const headerLabel =
                ix.kind === 'idl-instruction'
                  ? `${ix.programLabel} · ${ix.method}`
                  : ix.kind === 'custom' && idl
                    ? `${idl.programLabel} · ${idl.method}`
                    : EDITABLE_KIND_LABEL[ix.kind]

              return (
                <div key={ix.id} className="ixCard">
                  <div className="ixCardHeader">
                    <div>
                      <span className="ixIndex">#{idx + 1}</span>{' '}
                      <strong>{headerLabel}</strong>
                      {ix.kind === 'custom' && !idl && ix.hint ? (
                        <span className="ixHint"> ({ix.hint})</span>
                      ) : null}
                    </div>
                    <div className="ixCardActions">
                      <button
                        type="button"
                        className="btn ghost btnSm"
                        onClick={() => moveIx(ix.id, -1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn ghost btnSm"
                        onClick={() => moveIx(ix.id, 1)}
                        disabled={idx === editable.instructions.length - 1}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn ghost btnSm"
                        onClick={() => removeIx(ix.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {ix.kind === 'system-transfer' ? (
                    <SystemTransferEditor
                      ix={ix}
                      walletPubkey={walletPubkey}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'memo' ? (
                    <MemoEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'spl-token-transfer' ? (
                    <TokenTransferEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'spl-token-transfer-checked' ? (
                    <TokenTransferCheckedEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'spl-token-sync-native' ? (
                    <TokenSyncNativeEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'spl-token-close-account' ? (
                    <TokenCloseAccountEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'compute-set-unit-limit' ? (
                    <ComputeUnitLimitEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'compute-set-unit-price' ? (
                    <ComputeUnitPriceEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'idl-instruction' ? (
                    <IdlInstructionEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}
                  {ix.kind === 'custom' ? (
                    <CustomEditor
                      ix={ix}
                      onChange={(next) => updateIx(ix.id, next)}
                    />
                  ) : null}

                  {chips.length > 0 ? (
                    <div className="ixContext">
                      <div className="ixContextLabel">
                        Accounts (click to expand)
                      </div>
                      <div className="chipRow">
                        {chips.map((c, ci) => (
                          <AccountChip
                            key={`${ix.id}-${ci}-${c.pubkey}`}
                            pubkey={c.pubkey}
                            role={c.role}
                            decoded={decoded.enrichment.accountInfo.get(
                              c.pubkey,
                            )}
                            mintLookup={decoded.enrichment.mintLookup}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="actions">
            <button
              type="button"
              className="btn ghost"
              onClick={addCustomIx}
            >
              + Add custom instruction
            </button>
          </div>

          {decoded.enrichment.errors.length > 0 ? (
            <div className="error" style={{ marginTop: 12 }}>
              {decoded.enrichment.errors.join('\n')}
            </div>
          ) : null}

          {(() => {
            if (!canSign) return null
            const required = requiredSignersForEditable({
              feePayer: editable.feePayer,
              instructions: editable.instructions,
            })
            if (required.includes(walletPubkey)) return null
            return (
              <div className="warnBanner">
                <strong>Wallet mismatch.</strong> Your wallet (
                <span className="mono">{walletPubkey}</span>) is not a required
                signer. Sign will fail until you change the fee payer or a
                signer field to your wallet.
                <button
                  type="button"
                  className="btn ghost btnSm"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    setEditable({ ...editable, feePayer: walletPubkey })
                  }
                >
                  Set fee payer = wallet
                </button>
              </div>
            )
          })()}

          <div className="signBar">
            <div className="signBarMeta">
              {!canSign ? (
                <span className="cardHelp">
                  Connect a wallet to enable signing.
                </span>
              ) : (
                <span className="cardHelp">
                  Signing as <span className="mono">{walletPubkey}</span>
                </span>
              )}
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn ghost"
                onClick={handleReset}
                disabled={loading}
              >
                Reset to decoded
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => handleSubmit(false)}
                disabled={loading}
              >
                Build only (no sign)
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleSignAsPasted}
                disabled={loading || !canSign}
                title="Sign the original bytes — preserves any existing partial signatures from other signers"
              >
                {loading ? 'Signing…' : 'Sign as pasted'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const hasExisting = decoded.preview.signers.some(
                    (s) => s.signature !== null,
                  )
                  if (hasExisting) {
                    const ok = window.confirm(
                      "This tx already has signatures from other signers. Building from your edits will produce a new message hash, which invalidates those existing signatures. The result will only contain your wallet's signature.\n\nProceed?",
                    )
                    if (!ok) return
                  }
                  handleSubmit(true)
                }}
                disabled={loading || !canSign}
                title="Rebuild the tx from your edits and sign — discards any existing signatures from other signers"
              >
                {loading ? 'Signing…' : 'Sign with edits'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {signed ? (
        <>
          <div className="sectionDivider" />

          <div className="resultRow">
            <div className="sectionHeader">
              <strong>Result</strong>
              <span className="pill">{signed.txKind}</span>
              {(() => {
                const total = signed.preview.signers.length
                const haveSig = signed.preview.signers.filter(
                  (s) => s.signature !== null,
                ).length
                if (total === 0) return null
                if (haveSig === total) {
                  return (
                    <span className="pill ok">
                      fully signed ({haveSig}/{total})
                    </span>
                  )
                }
                if (haveSig === 0) {
                  return <span className="pill warn">unsigned</span>
                }
                return (
                  <span className="pill warn">
                    partial ({haveSig}/{total} signers)
                  </span>
                )
              })()}
            </div>
          </div>

          {signed.preview.signers.length > 0 ? (
            <div className="resultRow">
              <strong>Signers ({signed.preview.signers.length}):</strong>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {signed.preview.signers.map((s, i) => {
                  const isWallet = s.pubkey === walletPubkey
                  return (
                    <div
                      key={`${s.pubkey}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        className={`pill ${s.signature ? 'ok' : 'warn'}`}
                      >
                        {s.signature ? 'signed' : 'pending'}
                      </span>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {s.pubkey}
                      </span>
                      {isWallet ? (
                        <span className="pill ghost">your wallet</span>
                      ) : null}
                      {s.signature ? (
                        <details style={{ flexBasis: '100%' }}>
                          <summary
                            className="cardHelp"
                            style={{ cursor: 'pointer' }}
                          >
                            view signature
                          </summary>
                          <pre className="pre" style={{ margin: '4px 0 0' }}>
                            {s.signature}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="resultRow">
            <strong>Unsigned tx (base64):</strong>
            <textarea
              className="textarea textareaSmall"
              value={signed.unsignedTransactionBase64}
              readOnly
            />
          </div>

          {signed.signedTransactionBase64 ? (
            <div className="resultRow">
              <strong>Signed tx (base64):</strong>
              <textarea
                className="textarea textareaSmall"
                value={signed.signedTransactionBase64}
                readOnly
              />
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => copyToClipboard(signed.unsignedTransactionBase64)}
            >
              Copy unsigned base64
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                copyToClipboard(
                  bytesToJsonByteMap(
                    base64ToBytes(signed.unsignedTransactionBase64),
                    {
                      wrapperKey: 'serializedTx',
                      format: 'compact',
                      extra:
                        signed.lastValidBlockHeight !== null
                          ? {
                              lastValidBlockHeight:
                                signed.lastValidBlockHeight,
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
                    base64ToBytes(signed.unsignedTransactionBase64),
                    {
                      wrapperKey: 'serializedTx',
                      format: 'escaped-string',
                      extra:
                        signed.lastValidBlockHeight !== null
                          ? {
                              lastValidBlockHeight:
                                signed.lastValidBlockHeight,
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
            {signed.signedTransactionBase64 ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    copyToClipboard(signed.signedTransactionBase64 ?? '')
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
                        base64ToBytes(signed.signedTransactionBase64 ?? ''),
                        {
                          wrapperKey: 'serializedTx',
                          format: 'compact',
                          extra:
                            signed.lastValidBlockHeight !== null
                              ? {
                                  lastValidBlockHeight:
                                    signed.lastValidBlockHeight,
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
                        base64ToBytes(signed.signedTransactionBase64 ?? ''),
                        {
                          wrapperKey: 'serializedTx',
                          format: 'escaped-string',
                          extra:
                            signed.lastValidBlockHeight !== null
                              ? {
                                  lastValidBlockHeight:
                                    signed.lastValidBlockHeight,
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
            {signed.signatures.length > 0 ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => copyToClipboard(signed.signatures.join('\n'))}
              >
                Copy signatures
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
