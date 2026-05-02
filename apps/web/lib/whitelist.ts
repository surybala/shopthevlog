/**
 * Whitelist utility — server-side only.
 *
 * Configure via the ALLOWED_EMAILS environment variable:
 *   ALLOWED_EMAILS=alice@example.com,bob@example.com,*@acme.com
 *
 * - Exact email matches:   alice@example.com
 * - Domain wildcards:      *@acme.com  (matches any address at that domain)
 * - Empty / unset:         nobody is allowed (private beta default)
 * - Open override:         everyone is allowed when ALLOW_OPEN_SIGNUPS=true
 *
 * Add more addresses between waves without redeploying by updating the env var
 * and restarting the server (or triggering a redeploy on your platform).
 */

export function isWhitelisted(email: string): boolean {
  if (process.env.ALLOW_OPEN_SIGNUPS === 'true') return true

  const raw = process.env.ALLOWED_EMAILS ?? ''
  if (!raw.trim()) return false

  const normalised = email.trim().toLowerCase()
  if (!normalised) return false

  return raw
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
    .some(entry => {
      if (entry.startsWith('*@')) {
        // Domain wildcard
        const domain = entry.slice(2)
        return normalised.endsWith(`@${domain}`)
      }
      return entry === normalised
    })
}
