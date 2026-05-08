import { useState } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

type ConvertResult = {
  publicKey: string
  keypairJson: string     // 64-byte array as JSON — Solana CLI format
  base58Full: string      // bs58(64-byte keypair) — Phantom export format
  base58Seed: string      // bs58(32-byte seed only)
}

function parseInput(raw: string): Uint8Array {
  const trimmed = raw.trim()

  // JSON array or bare comma-separated numbers
  const stripped = trimmed.startsWith('[') ? trimmed.slice(1, trimmed.lastIndexOf(']')) : trimmed
  if (/^[\d\s,]+$/.test(stripped)) {
    const nums = stripped.split(',').map((s) => {
      const n = parseInt(s.trim(), 10)
      if (Number.isNaN(n) || n < 0 || n > 255) throw new Error(`Invalid byte value: ${s.trim()}`)
      return n
    })
    return new Uint8Array(nums)
  }

  // Hex string
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = new Uint8Array(trimmed.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }

  // Base58
  try {
    return bs58.decode(trimmed)
  } catch {
    throw new Error('Could not parse input — expected a byte array, hex string, or base58 string.')
  }
}

function deriveKeypair(bytes: Uint8Array): Keypair {
  if (bytes.length === 32) return Keypair.fromSeed(bytes)
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes)
  throw new Error(`Expected 32 bytes (seed) or 64 bytes (full keypair), got ${bytes.length}.`)
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text)
}

export default function KeyConverter() {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleConvert = () => {
    setError(null)
    setResult(null)
    if (!input.trim()) {
      setError('Paste your private key bytes above.')
      return
    }
    try {
      const bytes = parseInput(input)
      const kp = deriveKeypair(bytes)
      const seed = kp.secretKey.slice(0, 32)
      setResult({
        publicKey: kp.publicKey.toBase58(),
        keypairJson: JSON.stringify(Array.from(kp.secretKey)),
        base58Full: bs58.encode(kp.secretKey),
        base58Seed: bs58.encode(seed),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const copy = async (label: string, text: string) => {
    await copyToClipboard(text)
    setCopiedKey(label)
    setTimeout(() => setCopiedKey((k) => (k === label ? null : k)), 1500)
  }

  return (
    <section className="card">
      <h2 className="cardTitle">Key converter</h2>
      <p className="cardHelp">
        Paste a private key in any format — byte array, hex, or base58 — and
        convert it to the Solana CLI keypair JSON, Phantom-style base58, or
        individual components. Accepts 32-byte seeds and 64-byte full keypairs.
        Nothing leaves your browser.
      </p>

      <div className="field">
        <label className="label" htmlFor="keyInput">
          Private key (bytes, hex, or base58)
        </label>
        <textarea
          id="keyInput"
          className="textarea"
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Examples:\n[1,2,3,…,64]\n0102…\n5K… (base58)`}
          spellCheck={false}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={handleConvert}
          disabled={!input.trim()}
        >
          Convert
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => { setInput(''); setResult(null); setError(null) }}
        >
          Clear
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {result ? (
        <div className="result">
          <div className="resultRow">
            <strong>Public key</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono">{result.publicKey}</span>
              <button
                type="button"
                className="btn ghost"
                style={{ padding: '2px 10px', fontSize: 12 }}
                onClick={() => copy('pubkey', result.publicKey)}
              >
                {copiedKey === 'pubkey' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="resultRow">
            <strong>Keypair JSON</strong>
            <span className="cardHelp" style={{ margin: 0 }}>
              64-byte array — paste into a <code>.json</code> file and use with{' '}
              <code>solana-keygen</code> or any Solana CLI tool
            </span>
            <textarea
              className="textarea textareaSmall"
              value={result.keypairJson}
              readOnly
              spellCheck={false}
            />
            <button
              type="button"
              className="btn secondary"
              onClick={() => copy('json', result.keypairJson)}
            >
              {copiedKey === 'json' ? 'Copied!' : 'Copy keypair JSON'}
            </button>
          </div>

          <div className="resultRow">
            <strong>Base58 full keypair (64 bytes)</strong>
            <span className="cardHelp" style={{ margin: 0 }}>
              Phantom / Solflare "export private key" format — base58 of the
              full 64-byte keypair (seed + public key)
            </span>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {result.base58Full}
            </span>
            <button
              type="button"
              className="btn secondary"
              onClick={() => copy('b58full', result.base58Full)}
            >
              {copiedKey === 'b58full' ? 'Copied!' : 'Copy base58 (full)'}
            </button>
          </div>

          <div className="resultRow">
            <strong>Base58 seed only (32 bytes)</strong>
            <span className="cardHelp" style={{ margin: 0 }}>
              Just the 32-byte secret seed encoded as base58
            </span>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {result.base58Seed}
            </span>
            <button
              type="button"
              className="btn secondary"
              onClick={() => copy('b58seed', result.base58Seed)}
            >
              {copiedKey === 'b58seed' ? 'Copied!' : 'Copy base58 (seed)'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
