# BinGO Windows desktop release

## One-time setup

1. Create a public GitHub repository named `BinGO` under the account that will publish releases.
2. Generate a Tauri updater key pair with `pnpm tauri signer generate -w ~/.tauri/bingo.key`.
3. Back up the private key and password offline. Existing clients cannot trust a replacement key automatically.
4. Add these GitHub Actions secrets:
   - `TAURI_UPDATER_PUBLIC_KEY`: the generated public key.
   - `TAURI_SIGNING_PRIVATE_KEY`: the complete private key file contents.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the private key password.

The updater signature only protects update integrity. It does not remove the Windows “unknown publisher” warning.

## Release

1. Update `package.json` to the new semantic version.
2. Push the source to the public `BinGO` repository.
3. Create and push a matching tag such as `v0.1.0`.
4. The `Release Windows Desktop` workflow creates a draft GitHub Release containing the NSIS installer, updater signature, and `latest.json`.
5. Test the draft installer, add release notes, and publish the draft.

The client checks `https://github.com/<owner>/BinGO/releases/latest/download/latest.json` after startup and asks the user before installing an update.
