# nmts heavy — the EVM wallet that pays Filecoin yourself

Commands: heavy
Tiers: heavy=none · heavy.fund=high(wallet)

NMTS Heavy keeps a file whole in two separate places on Filecoin instead of spreading it across
Walrus. Most uploads never need this command: `put --tier heavy` and `push --tier heavy` pay with
credits, or with WAL from the wallet under `--pay wallet`, and NMTS's own Filecoin treasury pays the
storage. This command is the developer's handle for paying Filecoin directly, as you could with the
Synapse SDK on your own.

```sh
nmts heavy wallet                 # the EVM address this NMTS key derives, its FIL and USDFC, the deposit
nmts heavy wallet --index 1       # another of this key's EVM wallets
nmts heavy fund 5 --yes           # deposit 5 USDFC into Filecoin Pay for --pay evm uploads
nmts put report.pdf --tier heavy --pay evm                    # 2 copies, providers chosen for you
nmts put report.pdf --tier heavy --pay evm --copies 3 --providers 4,9
```

The EVM wallet is derived from the NMTS key (format NCF-3 §1.9), so the recovery tool finds the same
address (`nmts-recovery --derive`) and can print its private key for an Ethereum-style wallet app
(`--export-evm-key N`). Its Filecoin address is the same 20 bytes.

`heavy wallet` reads only. `heavy fund <USDFC>` signs a deposit into Filecoin Pay and the approval
for the storage service: it is a wallet act (`nmts unlock wallet`), prints what it will do, and signs
only with `--yes`. When the deposit already covers the amount it signs nothing.

`--pay evm` uploads pay the storage providers from that deposit. The file stays as long as the
deposit lasts (`heavy wallet` shows the epoch it lasts to); add more with `heavy fund` before then.
`--copies` takes 1 to 12 (default 2), `--providers` names provider ids, and `--evm-wallet N` pays
from another derived wallet. On a network whose storage providers this version does not list, it
is refused before anything is spent.

You need FIL for gas and USDFC in the EVM wallet before `heavy fund`. On the Calibration test
network both come from the public faucets; on mainnet, from an exchange or a swap.
