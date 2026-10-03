#!/bin/sh
#
# zilar-backup.sh — nightly bare-metal backup for a Zilar install.
#
# Run by deploy/baremetal/zilar-backup.service (daily 03:30 + random delay
# via zilar-backup.timer). Dumps both Postgres databases, tars the two
# file stores, bundles everything with a copy of /etc/zilar/zilar.env
# into a timestamped archive, verifies the new archive reads back, then
# prunes to the newest $BACKUP_KEEP_N (default 7).
#
# The archive holds LIVE SECRETS (the env file): it is written mode 0600
# and must be copied off the machine encrypted (age/gpg + scp, or rclone
# — see docs/INSTALL_BARE_METAL.md §7). Nothing here touches the network.
#
# Layout (mirrors `./deploy/zilar backup` on the Docker path, minus the
# container indirection):
#
#   zilar-backup-<UTC stamp>.tgz
#     zilar.dump, ejabberd.dump   pg_dump custom format of each database
#     globals.sql                 roles and globals (pg_dumpall -g)
#     uploads.tgz                 /var/lib/ejabberd/upload (attachments)
#     stickers.tgz                $STICKER_STORAGE_DIR (default /var/lib/zilar/stickers)
#     avatars.tgz                 $AVATAR_STORAGE_DIR (default /var/lib/zilar/avatars)
#     zilar.env                   copy of /etc/zilar/zilar.env (0600 in the archive)
#     SECRETS_WARNING.txt         "this archive contains live secrets"
#     manifest.json               provenance (tool, date, host)
#
# Retention runs only after the new archive lists back through tar: a
# failed dump keeps every old archive. Only files named exactly
# zilar-backup-*.tgz are ever deleted, and never through symlinks.
#
# Configuration (environment, set in the unit or the shell):
#   BACKUP_KEEP_N     archives to keep (default 7, must be >= 1)
#   BACKUP_DIR        where archives land (default /var/lib/zilar-backups)
#   ZILAR_ENV_FILE    server env file to bundle (default /etc/zilar/zilar.env)
#   STICKER_STORAGE_DIR / AVATAR_STORAGE_DIR   file stores (defaults below)
#
set -eu

BACKUP_KEEP_N="${BACKUP_KEEP_N:-7}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/zilar-backups}"
ZILAR_ENV_FILE="${ZILAR_ENV_FILE:-/etc/zilar/zilar.env}"
STICKER_STORAGE_DIR="${STICKER_STORAGE_DIR:-/var/lib/zilar/stickers}"
AVATAR_STORAGE_DIR="${AVATAR_STORAGE_DIR:-/var/lib/zilar/avatars}"
EJABBERD_UPLOAD_DIR="${EJABBERD_UPLOAD_DIR:-/var/lib/ejabberd/upload}"

case "$BACKUP_KEEP_N" in
  ""|*[!0-9]*|0) echo "zilar-backup: error: BACKUP_KEEP_N must be a positive number (got '$BACKUP_KEEP_N')" >&2; exit 1 ;;
esac
[ -f "$ZILAR_ENV_FILE" ] || { echo "zilar-backup: error: no env file at $ZILAR_ENV_FILE" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="zilar-backup-$STAMP.tgz"

mkdir -p "$BACKUP_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "zilar-backup: dumping the Zilar database..."
pg_dump -Fc -U zilar -h localhost zilar > "$TMP/zilar.dump"
echo "zilar-backup: dumping the ejabberd database..."
pg_dump -Fc -U ejabberd -h localhost ejabberd > "$TMP/ejabberd.dump"
echo "zilar-backup: dumping roles and globals..."
# Role definitions carry SCRAM password hashes (secret material — the
# archive stays 0600). --no-role-passwords is NOT used: a restore to a
# fresh cluster needs the passwords to recreate working roles.
pg_dumpall -g -U postgres -h localhost > "$TMP/globals.sql"
echo "zilar-backup: archiving file stores..."
tar -czf "$TMP/uploads.tgz" -C "$(dirname "$EJABBERD_UPLOAD_DIR")" "$(basename "$EJABBERD_UPLOAD_DIR")"
tar -czf "$TMP/stickers.tgz" -C "$(dirname "$STICKER_STORAGE_DIR")" "$(basename "$STICKER_STORAGE_DIR")"
tar -czf "$TMP/avatars.tgz" -C "$(dirname "$AVATAR_STORAGE_DIR")" "$(basename "$AVATAR_STORAGE_DIR")"

cp "$ZILAR_ENV_FILE" "$TMP/zilar.env"
chmod 600 "$TMP/zilar.env" "$TMP/zilar.dump" "$TMP/ejabberd.dump" "$TMP/globals.sql" \
  "$TMP/uploads.tgz" "$TMP/stickers.tgz" "$TMP/avatars.tgz"
cat > "$TMP/SECRETS_WARNING.txt" <<EOF
This archive contains LIVE SECRETS (the zilar.env file: database
passwords, JWT and session secrets). Anyone holding it owns this Zilar
install. Store it encrypted, copy it off the machine, restrict who can
read it.
EOF
cat > "$TMP/manifest.json" <<EOF
{
  "tool": "zilar-backup-baremetal-v1",
  "created_at": "$STAMP",
  "host": "$(hostname 2>/dev/null || echo unknown)"
}
EOF

tar -czf "$BACKUP_DIR/$NAME" -C "$TMP" zilar.dump ejabberd.dump globals.sql \
  uploads.tgz stickers.tgz avatars.tgz zilar.env SECRETS_WARNING.txt manifest.json
chmod 600 "$BACKUP_DIR/$NAME"
# The new archive is the gate: it must list back before any retention.
tar -tzf "$BACKUP_DIR/$NAME" >/dev/null \
  || { echo "zilar-backup: error: $BACKUP_DIR/$NAME does not read back — keeping all older backups" >&2; exit 1; }

# Retention: newest $BACKUP_KEEP_N survive. Regular files only (-type f
# never matches a symlink itself), anchored name pattern, one file at a
# time with a re-check (never -delete, never rm globs).
LIST="$(mktemp)"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zilar-backup-*.tgz' -print 2>/dev/null | sort > "$LIST" || true
TOTAL="$(grep -c . "$LIST" 2>/dev/null || true)"
TOTAL="${TOTAL:-0}"
REMOVED=0
if [ "$TOTAL" -gt "$BACKUP_KEEP_N" ]; then
  DROP=$((TOTAL - BACKUP_KEEP_N))
  VICTIMS="$(head -n "$DROP" "$LIST")"
  while IFS= read -r _file; do
    [ -n "$_file" ] || continue
    case "$_file" in
      "$BACKUP_DIR"/zilar-backup-*.tgz)
        if [ -f "$_file" ] && [ ! -L "$_file" ]; then
          rm -f "$_file"
          REMOVED=$((REMOVED + 1))
        fi
        ;;
    esac
  done <<EOF
$VICTIMS
EOF
fi
rm -f "$LIST"

trap - EXIT INT TERM
rm -rf "$TMP"

SIZE="$(du -h "$BACKUP_DIR/$NAME" | cut -f1)"
echo "zilar-backup: wrote $BACKUP_DIR/$NAME ($SIZE, mode 0600). Keeping the newest $BACKUP_KEEP_N (removed $REMOVED older)."
echo "zilar-backup: WARNING: SECRETS — this archive contains the live server env. Encrypt and copy it off the machine (see docs/INSTALL_BARE_METAL.md §7)."
