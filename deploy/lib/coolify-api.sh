# shellcheck shell=sh
#
# coolify-api — the Coolify REST calls deploy/lib/coolify-mode.sh makes.
#
# Sourced by deploy/install.sh from the fetched release, before
# deploy/lib/preflight.sh. coolify-mode.sh sets what the calls need:
#   COOLIFY_API        the base URL, e.g. http://localhost:8000/api/v1
#   COOLIFY_TMP        a root-only temp dir for this run
#   COOLIFY_TOKEN_FILE a root-only file holding "Authorization: Bearer <token>"
#   DRY_RUN            1 prints each call instead of making it
# and install.sh provides the shared helpers (die/info/warn).
#
# Every call in docs/deploy/coolify-api-notes.md is here except GET /deployments:
# the flow waits for the public https://<domain>/health instead (notes, and
# coolify-mode step 8). The token and every JSON body travel in root-only files
# (`curl -H @file`, `--data @file`), never in argv, a log line or the screen.

# The detail appended to an error: Coolify's JSON `message`, but only for the
# calls that send no secrets (every GET, POST /projects and POST /deploy). A
# rejected envs/bulk or create body can quote a value the script sent, so those
# calls print the method, the path and the code only. Empty when none applies.
_api_error_detail() {
  case "$1 $2" in
    "GET "*|"POST /projects"|"POST /deploy"*) ;;
    *) return 0 ;;
  esac
  _message="$(jq -r '.message // empty' "$3" 2>/dev/null || true)"
  [ -z "$_message" ] || printf ': %s' "$_message"
}

# One request. $1 METHOD, $2 PATH (starts with /), $3 JSON body (optional).
# Prints the response body on success; stops with a clear message otherwise.
# `curl -sS` (no -f), so the code is read even on an HTTP error and the body is
# never echoed on failure.
_api_request() {
  _method="$1"; _path="$2"; _body="${3-}"
  if [ "${DRY_RUN:-0}" -eq 1 ]; then
    printf '    + %s %s\n' "$_method" "$_path" >&2
    return 0
  fi
  [ -n "${COOLIFY_TOKEN_FILE:-}" ] || die "coolify-api: no token file was set"
  _out="$(mktemp "$COOLIFY_TMP/response.XXXXXX")"
  _err="$(mktemp "$COOLIFY_TMP/error.XXXXXX")"
  _in=""
  if [ -n "$_body" ]; then
    _in="$(mktemp "$COOLIFY_TMP/request.XXXXXX")"
    printf '%s' "$_body" >"$_in"
    _code="$(curl -sS -o "$_out" -w '%{http_code}' -X "$_method" \
      -H "@$COOLIFY_TOKEN_FILE" -H 'Content-Type: application/json' \
      --data "@$_in" "$COOLIFY_API$_path" 2>"$_err")" || _code="${_code:-000}"
  else
    _code="$(curl -sS -o "$_out" -w '%{http_code}' -X "$_method" \
      -H "@$COOLIFY_TOKEN_FILE" "$COOLIFY_API$_path" 2>"$_err")" || _code="${_code:-000}"
  fi
  case "$_code" in
    2??) cat "$_out"; rm -f "$_out" "$_err" "$_in"; return 0 ;;
  esac
  case "$_code" in
    401|403) _msg="the token was refused (HTTP $_code) — create a new one in Coolify under Keys & Tokens" ;;
    000) _msg="could not reach Coolify at $COOLIFY_API ($(head -n 1 "$_err" 2>/dev/null || true))" ;;
    *) _msg="Coolify answered HTTP $_code for $_method $_path$(_api_error_detail "$_method" "$_path" "$_out")" ;;
  esac
  rm -f "$_out" "$_err" "$_in"
  die "$_msg"
}

# One function per call in docs/deploy/coolify-api-notes.md.
coolify_api_version() { _api_request GET /version; }
coolify_api_servers() { _api_request GET /servers; }
coolify_api_destinations() { _api_request GET "/servers/$1/destinations"; }
coolify_api_projects() { _api_request GET /projects; }
coolify_api_create_project() { _api_request POST /projects "$1"; }
coolify_api_create_service() { _api_request POST /services "$1"; }
coolify_api_patch_service() { _api_request PATCH "/services/$1" "$2"; }
coolify_api_set_service_envs() { _api_request PATCH "/services/$1/envs/bulk" "$2"; }
coolify_api_create_image_app() { _api_request POST /applications/dockerimage "$1"; }
coolify_api_set_app_envs() { _api_request PATCH "/applications/$1/envs/bulk" "$2"; }
coolify_api_add_storage() { _api_request POST "/applications/$1/storages" "$2"; }
coolify_api_deploy() { _api_request POST "/deploy?uuid=$1"; }

# True (0) when a Coolify version string is older than 4.4. Major and minor are
# compared as numbers, so 4.10 counts as newer than 4.4 and 4.3.x as older; an
# unparsable string is treated as current (no warning).
coolify_api_version_is_old() {
  _major="${1%%.*}"
  _minor="$(printf '%s' "$1" | sed 's/^[0-9]*\.\([0-9]*\).*/\1/')"
  case "$_major" in ''|*[!0-9]*) return 1 ;; esac
  case "$_minor" in ''|*[!0-9]*) _minor=0 ;; esac
  [ "$_major" -lt 4 ] || { [ "$_major" -eq 4 ] && [ "$_minor" -lt 4 ]; }
}
