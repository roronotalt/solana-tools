import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { clusterApiUrl } from '@solana/web3.js'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import '@solana/wallet-adapter-react-ui/styles.css'
import './index.css'
import AppOfflineSigner from './AppOfflineSigner'

const endpoint =
  import.meta.env.VITE_SOLANA_RPC_URL?.trim() ||
  clusterApiUrl('mainnet-beta')

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet }),
]

createRoot(document.getElementById('root')!).render(
  <ConnectionProvider endpoint={endpoint}>
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <StrictMode>
          <AppOfflineSigner />
        </StrictMode>
      </WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>,
)
