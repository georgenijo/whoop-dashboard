# VAULT_KEY operations

`VAULT_KEY` is the symmetric key that protects every encrypted credential
in the `integrations` table (Whoop OAuth tokens and per-user Coach keys today,
more later). The Next.js web/API process owns production vault access.

The vault uses **NaCl secretbox** (XSalsa20-Poly1305) — same primitive on
both sides:

- `apps/web/src/lib/crypto/vault.ts` (Node, via `tweetnacl`)
- `streamlit/whoop/vault.py` (retained migration/test compatibility only)

Wire format: `base64(nonce || ciphertext)` where the nonce is 24 random
bytes and the ciphertext includes the 16-byte Poly1305 tag.

---

## Where the key lives

| Process                  | How it reads the env var                           |
| ------------------------ | -------------------------------------------------- |
| Production Next.js | `/home/george/services/whoop-dashboard/.env.local` on `opti` |
| Local Next.js | `apps/web/.env.local` (gitignored) |
| Retained Python migrations/tests | Explicit local environment only |

`VAULT_KEY` MUST NOT be committed. It is sensitive material. It belongs in:

- your password manager (1Password / Keychain)
- an offline backup (printed on paper or stored on an air-gapped USB)

That's it. Not in source control. Not in chat. Not in commit messages.

---

## Generating a key

```bash
openssl rand -base64 32
```

The output decodes to 32 bytes — `tweetnacl` and `PyNaCl` will reject any
other length with `VaultMissingKeyError`.

---

## Bootstrapping production on opti

1. Generate a key on a trusted machine (`openssl rand -base64 32`).
2. Append it to the protected production environment without placing the value
   in shell history or command arguments:

   ```bash
   read -r -s VAULT_KEY_VALUE
   printf '\nVAULT_KEY=%s\n' "$VAULT_KEY_VALUE" \
     | fleet exec opti \
         "umask 077; tee -a /home/george/services/whoop-dashboard/.env.local >/dev/null"
   unset VAULT_KEY_VALUE
   ```

3. Deploy or restart through the documented production workflow; Next.js loads
   the persistent file from each release's `.env.local` symlink.
4. If importing legacy `tokens.json`, run the one-time migration script in a
   trusted maintenance environment with the same key:

   ```bash
   python3 scripts/migrate-whoop-tokens.py
   ```

5. Confirm the web/API process decrypts the integration and completes a Whoop
   sync.
6. Only then use any migration cleanup flag that removes the legacy token
   source.

---

## Key rotation (sketch — rotation script is future work)

When you rotate, both old and new keys must be present transiently so the
re-encrypt step can read v1 rows and write v2 rows.

1. Generate `VAULT_KEY_V2`:
   ```bash
   openssl rand -base64 32
   ```
2. Set both env vars in the runtime environment:
   ```
   VAULT_KEY=<v1, current>
   VAULT_KEY_V2=<v2, new>
   ```
3. Run the rotation script (TODO — not yet implemented). It will:
   1. SELECT every row where `key_version = 1`.
   2. Decrypt with `VAULT_KEY` (the v1 key).
   3. Re-encrypt with `VAULT_KEY_V2`.
   4. UPDATE the row, setting `key_version = 2`.
4. After all rows are migrated, swap env vars: `VAULT_KEY` now points at
   the v2 material; `VAULT_KEY_V2` is unset (or aliased to `VAULT_KEY`).
5. Archive the old v1 key in your password manager. **Do not delete it
   immediately** — keep it for at least one cycle in case of rollback. A
   copy of v1 is required to read backups taken before the rotation.

The current code paths already validate `key_version`:

- `assert_key_version_supported(version)` in both `vault.ts` and `vault.py`
  raises `VaultDecryptError("unknown key_version=...")` for any value other
  than `CURRENT_KEY_VERSION` (= 1 today).
- When v2 lands, bump `CURRENT_KEY_VERSION` and add v1 fallback decrypt
  inside the rotation script only — production reads should always use the
  current version.

---

## Recovery if VAULT_KEY is lost

If the key is unrecoverable and no backup exists, every encrypted row is
**permanently unreadable**. There is no magic recovery — that's the whole
point of authenticated encryption.

For Whoop specifically the impact is bounded:

- Whoop OAuth tokens are short-lived and refresh-driven.
- The fix is to re-authenticate: the user clicks "Connect to Whoop" in
  Settings, which triggers `/api/auth/whoop` and writes a fresh row.
- No historical data is lost — only the credential.

For other providers added later (e.g. Google Calendar, Plaid), assume the
same pattern: losing the key means re-OAuthing every provider. Plan
backups accordingly.

---

## Backup and restore

- **Backup the key** alongside the DB. A backup of `whoop_data.db`
  without `VAULT_KEY` is partially encrypted — you can read everything
  except the credentials column, which is fine, but you'll have to
  re-OAuth on restore.
- **Restoring with the same key**: copy `whoop_data.db` and `.env.local`
  back; everything decrypts as-is.
- **Restoring with a different key**: every encrypted row is dead. Drop
  the `integrations` table or DELETE its rows; re-OAuth.

---

## Failure modes

| Symptom                                          | Likely cause                                        | Action                                                    |
| ------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------- |
| `VaultMissingKeyError: VAULT_KEY ... not set`    | env var unset in the runtime                        | check the persistent production or local `.env.local`    |
| `VaultMissingKeyError: not valid base64`         | wrong format (e.g. raw bytes, hex)                  | regenerate with `openssl rand -base64 32`                 |
| `VaultMissingKeyError: must decode to 32 bytes`  | truncated/corrupted env var                         | check for trailing whitespace / wrap                      |
| `VaultDecryptError: Vault decryption failed`     | wrong key in env, or tampered ciphertext            | rotate env back, or re-OAuth                              |
| `VaultDecryptError: unknown key_version=...`     | row was written by a newer/older version of the app | upgrade/downgrade the app, or re-encrypt via rotation     |
| `getIntegration` returns `null`, `load_tokens()` returns `None`, but `integration_row_exists` is `True` | row exists but couldn't be decrypted | inspect logs; the auth layer will NOT silently fall back to `tokens.json` |

---

## Why this design

- **Symmetric, not asymmetric** — single-user, single-machine threat
  model. PKI/HSM is overkill.
- **NaCl secretbox** (XSalsa20-Poly1305) — chosen because it's the
  highest-confidence "do the right thing by default" sealed-box primitive,
  with mature Node + Python implementations that produce byte-compatible
  output.
- **`key_version` column from day one** — even though only v1 is supported,
  the column buys cheap forward-compatibility for rotation without an
  online migration.
- **Public API uses `scope` (singular)** — matches the Whoop OAuth
  response and the `tokens.json` shape; the DB column stays `scopes`
  because renaming would force a destructive migration for trivial
  ergonomic gain.
