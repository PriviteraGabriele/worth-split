#!/usr/bin/env bash
# Retain a bounded rollback history for one project's images in a shared
# Docker Hub repository. Mutable *-production tags and other projects' tags
# are deliberately outside the selection.
set -euo pipefail

: "${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME is required}"
: "${DOCKERHUB_REPOSITORY:?DOCKERHUB_REPOSITORY is required}"
: "${DOCKERHUB_IMAGE_PREFIX:?DOCKERHUB_IMAGE_PREFIX is required}"

keep="${DOCKERHUB_IMAGE_RETENTION_COUNT:-3}"
if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then
  echo "DOCKERHUB_IMAGE_RETENTION_COUNT must be a positive integer" >&2
  exit 1
fi

# A separate token keeps image publishing operational even when cleanup has
# not yet been configured. It needs permission to list and delete tags.
if [[ -z "${DOCKERHUB_CLEANUP_TOKEN:-}" ]]; then
  echo "Docker Hub cleanup skipped: DOCKERHUB_CLEANUP_TOKEN is not configured."
  exit 0
fi

for command in curl jq sort tail cut; do
  command -v "$command" >/dev/null || {
    echo "Required command is unavailable: $command" >&2
    exit 1
  }
done

token="$({
  curl --fail --silent --show-error \
    --request POST 'https://hub.docker.com/v2/auth/token' \
    --header 'Content-Type: application/json' \
    --data "{\"identifier\":\"${DOCKERHUB_USERNAME}\",\"secret\":\"${DOCKERHUB_CLEANUP_TOKEN}\"}"
} | jq -er '.access_token')"

temporary_file="$(mktemp)"
trap 'rm -f "$temporary_file"' EXIT

prune_service() {
  local service="$1"
  local prefix="${DOCKERHUB_IMAGE_PREFIX}-${service}-"
  local url="https://hub.docker.com/v2/namespaces/${DOCKERHUB_USERNAME}/repositories/${DOCKERHUB_REPOSITORY}/tags?page_size=100"
  local response tag

  : >"$temporary_file"
  while [[ -n "$url" && "$url" != "null" ]]; do
    response="$(curl --fail --silent --show-error "$url" --header "Authorization: Bearer $token")"
    jq -r --arg prefix "$prefix" '
      .results[]
      | select(.name | startswith($prefix))
      | select(.name | ltrimstr($prefix) | test("^[0-9a-f]{40}$"))
      | [.last_updated, .name]
      | @tsv
    ' <<<"$response" >>"$temporary_file"
    url="$(jq -r '.next // empty' <<<"$response")"
  done

  # The ISO-8601 timestamp sorts lexicographically; retain the newest entries.
  while IFS= read -r tag; do
    echo "Deleting obsolete Docker Hub tag: $tag"
    curl --fail --silent --show-error --request DELETE \
      "https://hub.docker.com/v2/namespaces/${DOCKERHUB_USERNAME}/repositories/${DOCKERHUB_REPOSITORY}/tags/${tag}" \
      --header "Authorization: Bearer $token" >/dev/null
  done < <(sort -r "$temporary_file" | tail -n +$((keep + 1)) | cut -f2)
}

prune_service api
prune_service web
