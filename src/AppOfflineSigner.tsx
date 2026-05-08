import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import BuildAndSign from './components/BuildAndSign'
import GenerateAndSign from './components/GenerateAndSign'
import SignArbitrary from './components/SignArbitrary'
import WrapUnwrapSol from './components/WrapUnwrapSol'
import KeyConverter from './components/KeyConverter'
import './App.css'

type TabId = 'sign' | 'generate' | 'build' | 'wrap' | 'keys'

export default function AppOfflineSigner() {
  const { publicKey, connected } = useWallet()
  const [tab, setTab] = useState<TabId>('sign')

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeaderLeft">
          <h1 className="appTitle">Solana offline signer</h1>
          <p className="appSubtitle">
            Connect a wallet, paste a base64 serialized transaction, and sign
            it locally (no sending). You can also generate + sign simple
            transfers.
          </p>
        </div>

        <div className="appHeaderRight">
          <WalletMultiButton />
          <div className="walletMeta">
            <div>
              Status:{' '}
              <span className="mono">
                {connected ? 'connected' : 'disconnected'}
              </span>
            </div>
            <div>
              Public key:{' '}
              <span className="mono">{publicKey ? publicKey.toBase58() : '—'}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="tabs">
        <button
          className={tab === 'sign' ? 'tab tabActive' : 'tab'}
          onClick={() => setTab('sign')}
          type="button"
        >
          Sign base64
        </button>
        <button
          className={tab === 'generate' ? 'tab tabActive' : 'tab'}
          onClick={() => setTab('generate')}
          type="button"
        >
          Generate + sign transfer
        </button>
        <button
          className={tab === 'build' ? 'tab tabActive' : 'tab'}
          onClick={() => setTab('build')}
          type="button"
        >
          Build custom tx
        </button>
        <button
          className={tab === 'wrap' ? 'tab tabActive' : 'tab'}
          onClick={() => setTab('wrap')}
          type="button"
        >
          Wrap / Unwrap SOL
        </button>
        <button
          className={tab === 'keys' ? 'tab tabActive' : 'tab'}
          onClick={() => setTab('keys')}
          type="button"
        >
          Key converter
        </button>
      </div>

      <main className="appMain">
        {tab === 'sign' ? (
          <SignArbitrary />
        ) : tab === 'generate' ? (
          <GenerateAndSign />
        ) : tab === 'build' ? (
          <BuildAndSign />
        ) : tab === 'wrap' ? (
          <WrapUnwrapSol />
        ) : (
          <KeyConverter />
        )}
      </main>

      <footer className="appFooter">
        <strong>Important:</strong> signing an arbitrary transaction can approve
        actions you did not intend. Only sign transactions you fully trust.
      </footer>
    </div>
  )
}

