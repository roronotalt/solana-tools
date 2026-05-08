import type {
  EditableComputeUnitLimit,
  EditableComputeUnitPrice,
  EditableCustom,
  EditableIdlInstruction,
  EditableMemo,
  EditableSystemTransfer,
  EditableTokenCloseAccount,
  EditableTokenSyncNative,
  EditableTokenTransfer,
  EditableTokenTransferChecked,
} from '../lib/editableTx'
import { makeAccount } from '../lib/editableTx'
import type { DataEncoding } from '../lib/tx'

export function SystemTransferEditor({
  ix,
  onChange,
  walletPubkey,
}: {
  ix: EditableSystemTransfer
  onChange: (next: EditableSystemTransfer) => void
  walletPubkey: string
}) {
  return (
    <div className="ixForm">
      <div className="grid2">
        <div className="field">
          <label className="label">From</label>
          <input
            className="input"
            value={ix.from}
            onChange={(e) => onChange({ ...ix, from: e.target.value })}
            placeholder="Base58 address"
          />
          {walletPubkey ? (
            <button
              type="button"
              className="btn ghost btnSm"
              onClick={() => onChange({ ...ix, from: walletPubkey })}
            >
              Use wallet
            </button>
          ) : null}
        </div>
        <div className="field">
          <label className="label">To</label>
          <input
            className="input"
            value={ix.to}
            onChange={(e) => onChange({ ...ix, to: e.target.value })}
            placeholder="Base58 address"
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Lamports (1 SOL = 1,000,000,000 lamports)</label>
        <input
          className="input"
          value={ix.lamports}
          onChange={(e) => onChange({ ...ix, lamports: e.target.value })}
          placeholder="0"
        />
      </div>
    </div>
  )
}

export function MemoEditor({
  ix,
  onChange,
}: {
  ix: EditableMemo
  onChange: (next: EditableMemo) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Memo program</label>
        <input
          className="input"
          value={ix.programId}
          onChange={(e) => onChange({ ...ix, programId: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label">Memo text</label>
        <input
          className="input"
          value={ix.text}
          onChange={(e) => onChange({ ...ix, text: e.target.value })}
        />
      </div>
    </div>
  )
}

export function TokenTransferEditor({
  ix,
  onChange,
}: {
  ix: EditableTokenTransfer
  onChange: (next: EditableTokenTransfer) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Token program</label>
        <input
          className="input"
          value={ix.tokenProgram}
          onChange={(e) => onChange({ ...ix, tokenProgram: e.target.value })}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label">Source token account</label>
          <input
            className="input"
            value={ix.source}
            onChange={(e) => onChange({ ...ix, source: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Destination token account</label>
          <input
            className="input"
            value={ix.destination}
            onChange={(e) => onChange({ ...ix, destination: e.target.value })}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label">Owner (signer)</label>
          <input
            className="input"
            value={ix.owner}
            onChange={(e) => onChange({ ...ix, owner: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Amount (raw, no decimals)</label>
          <input
            className="input"
            value={ix.amount}
            onChange={(e) => onChange({ ...ix, amount: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

export function TokenTransferCheckedEditor({
  ix,
  onChange,
}: {
  ix: EditableTokenTransferChecked
  onChange: (next: EditableTokenTransferChecked) => void
}) {
  return (
    <div className="ixForm">
      <div className="grid2">
        <div className="field">
          <label className="label">Token program</label>
          <input
            className="input"
            value={ix.tokenProgram}
            onChange={(e) => onChange({ ...ix, tokenProgram: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Mint</label>
          <input
            className="input"
            value={ix.mint}
            onChange={(e) => onChange({ ...ix, mint: e.target.value })}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label">Source token account</label>
          <input
            className="input"
            value={ix.source}
            onChange={(e) => onChange({ ...ix, source: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Destination token account</label>
          <input
            className="input"
            value={ix.destination}
            onChange={(e) => onChange({ ...ix, destination: e.target.value })}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label">Owner (signer)</label>
          <input
            className="input"
            value={ix.owner}
            onChange={(e) => onChange({ ...ix, owner: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Amount (raw)</label>
          <input
            className="input"
            value={ix.amount}
            onChange={(e) => onChange({ ...ix, amount: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Decimals (u8)</label>
        <input
          className="input"
          value={ix.decimals}
          onChange={(e) => onChange({ ...ix, decimals: e.target.value })}
        />
      </div>
    </div>
  )
}

export function TokenSyncNativeEditor({
  ix,
  onChange,
}: {
  ix: EditableTokenSyncNative
  onChange: (next: EditableTokenSyncNative) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Token program</label>
        <input
          className="input"
          value={ix.tokenProgram}
          onChange={(e) => onChange({ ...ix, tokenProgram: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label">Account (wSOL ATA)</label>
        <input
          className="input"
          value={ix.account}
          onChange={(e) => onChange({ ...ix, account: e.target.value })}
        />
      </div>
    </div>
  )
}

export function TokenCloseAccountEditor({
  ix,
  onChange,
}: {
  ix: EditableTokenCloseAccount
  onChange: (next: EditableTokenCloseAccount) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Token program</label>
        <input
          className="input"
          value={ix.tokenProgram}
          onChange={(e) => onChange({ ...ix, tokenProgram: e.target.value })}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label className="label">Account (to close)</label>
          <input
            className="input"
            value={ix.account}
            onChange={(e) => onChange({ ...ix, account: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="label">Destination (lamports go here)</label>
          <input
            className="input"
            value={ix.destination}
            onChange={(e) => onChange({ ...ix, destination: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label className="label">Owner (signer)</label>
        <input
          className="input"
          value={ix.owner}
          onChange={(e) => onChange({ ...ix, owner: e.target.value })}
        />
      </div>
    </div>
  )
}

export function ComputeUnitLimitEditor({
  ix,
  onChange,
}: {
  ix: EditableComputeUnitLimit
  onChange: (next: EditableComputeUnitLimit) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Units (u32)</label>
        <input
          className="input"
          value={ix.units}
          onChange={(e) => onChange({ ...ix, units: e.target.value })}
          placeholder="200000"
        />
      </div>
    </div>
  )
}

export function ComputeUnitPriceEditor({
  ix,
  onChange,
}: {
  ix: EditableComputeUnitPrice
  onChange: (next: EditableComputeUnitPrice) => void
}) {
  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Micro-lamports per CU (u64)</label>
        <input
          className="input"
          value={ix.microLamports}
          onChange={(e) =>
            onChange({ ...ix, microLamports: e.target.value })
          }
          placeholder="1000"
        />
      </div>
    </div>
  )
}

export function CustomEditor({
  ix,
  onChange,
}: {
  ix: EditableCustom
  onChange: (next: EditableCustom) => void
}) {
  const updateAccount = (
    id: string,
    patch: Partial<{ pubkey: string; isSigner: boolean; isWritable: boolean }>,
  ) => {
    onChange({
      ...ix,
      accounts: ix.accounts.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })
  }

  return (
    <div className="ixForm">
      <div className="field">
        <label className="label">Program ID</label>
        <input
          className="input"
          value={ix.programId}
          onChange={(e) => onChange({ ...ix, programId: e.target.value })}
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
                onChange={(e) =>
                  updateAccount(acc.id, { pubkey: e.target.value })
                }
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
                className="btn ghost btnSm"
                onClick={() =>
                  onChange({
                    ...ix,
                    accounts: ix.accounts.filter((a) => a.id !== acc.id),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn ghost btnSm"
          style={{ marginTop: 6 }}
          onClick={() =>
            onChange({ ...ix, accounts: [...ix.accounts, makeAccount()] })
          }
        >
          + Add account
        </button>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="label">Data encoding</label>
          <select
            className="input"
            value={ix.dataEncoding}
            onChange={(e) =>
              onChange({
                ...ix,
                dataEncoding: e.target.value as DataEncoding,
              })
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
            rows={3}
          />
        </div>
      </div>
    </div>
  )
}

export function IdlInstructionEditor({
  ix,
  onChange,
}: {
  ix: EditableIdlInstruction
  onChange: (next: EditableIdlInstruction) => void
}) {
  const updateAccount = (
    id: string,
    patch: Partial<{ pubkey: string; isSigner: boolean; isWritable: boolean }>,
  ) => {
    onChange({
      ...ix,
      accounts: ix.accounts.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })
  }

  const updateArg = (name: string, value: string) => {
    onChange({
      ...ix,
      argValues: ix.argValues.map((a) =>
        a.name === name ? { ...a, value } : a,
      ),
    })
  }

  return (
    <div className="ixForm">
      <div
        style={{
          fontSize: 12,
          color: 'var(--text)',
          marginBottom: 6,
        }}
      >
        Program: <span className="mono">{ix.programLabel}</span> · method:{' '}
        <span className="mono">{ix.method}</span>
      </div>

      {ix.argValues.length > 0 ? (
        <div className="field">
          <label className="label">Args</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ix.argValues.map((arg) => (
              <div key={arg.name} className="grid2">
                <div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {arg.name}
                  </div>
                  <div
                    className="cardHelp"
                    style={{ fontSize: 12, marginTop: 2 }}
                  >
                    {arg.type}
                    {!arg.editable ? ' · read-only (composite type)' : null}
                  </div>
                </div>
                <input
                  className="input"
                  value={arg.value}
                  onChange={(e) => updateArg(arg.name, e.target.value)}
                  readOnly={!arg.editable}
                  style={!arg.editable ? { opacity: 0.6 } : undefined}
                  placeholder={
                    arg.type === 'publicKey' || arg.type === 'pubkey'
                      ? 'Base58 address'
                      : arg.type === 'string'
                        ? '"text" (JSON-quoted) or text'
                        : arg.type === 'bool'
                          ? 'true / false'
                          : arg.type === 'bytes'
                            ? '0xabcdef...'
                            : 'integer'
                  }
                />
              </div>
            ))}
          </div>
          {ix.argValues.some((a) => !a.editable) ? (
            <p className="cardHelp" style={{ marginTop: 6, fontSize: 12 }}>
              Composite types (Vec, Option, struct, etc.) aren't editable here
              yet — to change them, switch this instruction to <em>Custom</em>{' '}
              kind and edit the raw bytes.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="cardHelp">Method takes no args.</p>
      )}

      <div className="field">
        <label className="label">Accounts ({ix.accounts.length})</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ix.accounts.map((acc, i) => {
            const role = ix.accountSpec[i]?.name ?? `#${i + 1}`
            return (
              <div
                key={acc.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className="mono" style={{ minWidth: 100, fontSize: 13 }}>
                  {role}
                </span>
                <input
                  className="input"
                  value={acc.pubkey}
                  onChange={(e) =>
                    updateAccount(acc.id, { pubkey: e.target.value })
                  }
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
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
