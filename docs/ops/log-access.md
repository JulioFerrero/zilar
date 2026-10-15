# Read-only log access for the lead (Claude)

Set up 2026-10-14 at Julio's request, to debug Android push without server-side guesswork.

## What the key can do
- **One thing only:** print the last N lines of one Zilar container's logs (`server`, `ejabberd`, `web`, `postgres`), or list those containers.
- **What it cannot do:** no shell, no PTY, no port or agent forwarding, no other command. The user `zilar-logs` has no password, is not in the `docker` group, and gets root only for the single script below, through one `sudo` rule.
- **Where the key lives:** only on the lead's Mac, at `~/.ssh/zilar_logs_ed25519`. The public key is in step 3.
- **To revoke:** delete the key line from `/home/zilar-logs/.ssh/authorized_keys` (or `userdel -r zilar-logs`).

## Setup (Julio runs this once, as root on the server)

**1. The user:**
```bash
useradd --create-home --shell /bin/sh zilar-logs
passwd -l zilar-logs
```

**2. The script.** It validates its arguments, and when not root, re-runs itself through `sudo`:
```bash
cat > /usr/local/bin/zilar-logs <<'SH'
#!/bin/sh
# Read-only Zilar log access (docs/ops/log-access.md). Arguments: "list" or "<service> [lines]".
set -eu
APP=qccydpow4rw0zcel9yisk44s
if [ "$(id -u)" != 0 ]; then
  # Called by sshd as zilar-logs: the request is in SSH_ORIGINAL_COMMAND.
  set -- ${SSH_ORIGINAL_COMMAND:-}
fi
svc="${1:-}"; lines="${2:-300}"
case "$svc" in
  list|server|ejabberd|web|postgres) ;;
  *) echo "usage: list | server|ejabberd|web|postgres [lines<=5000]" >&2; exit 2 ;;
esac
case "$lines" in ''|*[!0-9]*) echo "lines must be a number" >&2; exit 2 ;; esac
[ "$lines" -le 5000 ] || lines=5000
if [ "$(id -u)" != 0 ]; then exec sudo -n /usr/local/bin/zilar-logs "$svc" "$lines"; fi
if [ "$svc" = list ]; then
  exec docker ps --filter "name=$APP" --format '{{.Names}}  {{.Status}}'
fi
name=$(docker ps --filter "name=^${svc}-${APP}" --format '{{.Names}}' | head -n 1)
[ -n "$name" ] || { echo "no running container for $svc" >&2; exit 1; }
exec docker logs --tail "$lines" --timestamps "$name" 2>&1
SH
chown root:root /usr/local/bin/zilar-logs
chmod 755 /usr/local/bin/zilar-logs
```

**3. The sudo rule and the locked key:**
```bash
echo 'zilar-logs ALL=(root) NOPASSWD: /usr/local/bin/zilar-logs' > /etc/sudoers.d/zilar-logs
chmod 440 /etc/sudoers.d/zilar-logs
visudo -cf /etc/sudoers.d/zilar-logs
install -d -m 700 -o zilar-logs -g zilar-logs /home/zilar-logs/.ssh
echo 'command="/usr/local/bin/zilar-logs",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFB7K5qqrK4CLUBgqwgwYj5MYIKP7I2MgOS2/hfzrNrw claude-zilar-logs@OFI74-MACBOOK' > /home/zilar-logs/.ssh/authorized_keys
chown zilar-logs:zilar-logs /home/zilar-logs/.ssh/authorized_keys
chmod 600 /home/zilar-logs/.ssh/authorized_keys
```

If sshd only allows some users (`AllowUsers` / `AllowGroups` in `/etc/ssh/sshd_config`), add `zilar-logs` there and reload sshd.

## Use (lead)
```bash
ssh -i ~/.ssh/zilar_logs_ed25519 zilar-logs@152.53.146.96 list
ssh -i ~/.ssh/zilar_logs_ed25519 zilar-logs@152.53.146.96 server 500
```

## Resetting the instance owner (SEC-12)

The instance owner (who manages the integration and voice-transcription
settings) is stored once in `instance_settings` under the key
`instance.owner_user_id`. The first owner check stores the oldest account, and
the value never changes afterwards, so deleting or recreating accounts does not
move ownership. To hand ownership to another account, an operator updates that
one row manually:

```sql
UPDATE instance_settings SET value = '<user id>', updated_at = now()
WHERE key = 'instance.owner_user_id';
```

The value is a `user.id`. If the stored user no longer exists, nobody is the
owner until this row is updated.

