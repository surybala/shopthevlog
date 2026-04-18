/**
 * Shared input validation helpers used across API routes.
 * No external dependencies — plain TypeScript.
 */

export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── String helpers ────────────────────────────────────────────────────────

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max }: { min?: number; max: number }
): string {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new ValidationError(field, `${field} is required`)
  }
  if (value.trim().length > max) {
    throw new ValidationError(field, `${field} must be at most ${max} characters`)
  }
  return value.trim()
}

export function optionalString(
  value: unknown,
  field: string,
  { max }: { max: number }
): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ValidationError(field, `${field} must be a string`)
  if (value.trim().length > max) {
    throw new ValidationError(field, `${field} must be at most ${max} characters`)
  }
  return value.trim()
}

export function optionalUrl(value: unknown, field: string): string | null {
  const s = optionalString(value, field, { max: 2048 })
  if (s === null) return null
  try {
    const u = new URL(s)
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new ValidationError(field, `${field} must be an http or https URL`)
    }
    return s
  } catch {
    throw new ValidationError(field, `${field} must be a valid URL`)
  }
}

export function optionalStorageAssetRef(value: unknown, field: string): string | null {
  const s = optionalString(value, field, { max: 2048 })
  if (s === null) return null
  if (s.startsWith('creators/')) return s
  return optionalUrl(s, field)
}

export function optionalStorageAssetRefArray(
  value: unknown,
  field: string,
  { maxItems = 12 }: { maxItems?: number } = {}
): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ValidationError(field, `${field} must be an array`)
  if (value.length > maxItems) throw new ValidationError(field, `${field} must have at most ${maxItems} items`)
  return value.map((entry, index) => {
    const assetRef = optionalStorageAssetRef(entry, `${field}[${index}]`)
    if (!assetRef) throw new ValidationError(field, `${field}[${index}] is required`)
    return assetRef
  })
}

export function optionalUrlArray(
  value: unknown,
  field: string,
  { maxItems = 12 }: { maxItems?: number } = {}
): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ValidationError(field, `${field} must be an array`)
  if (value.length > maxItems) throw new ValidationError(field, `${field} must have at most ${maxItems} items`)
  return value.map((entry, index) => {
    try {
      const url = optionalUrl(entry, `${field}[${index}]`)
      if (!url) throw new ValidationError(field, `${field}[${index}] is required`)
      return url
    } catch (error) {
      if (error instanceof ValidationError) throw error
      throw new ValidationError(field, `${field}[${index}] must be a valid URL`)
    }
  })
}

export function requireUrl(value: unknown, field: string): string {
  const s = requireString(value, field, { max: 2048 })
  try {
    const u = new URL(s)
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new ValidationError(field, `${field} must be an http or https URL`)
    }
    return s
  } catch {
    throw new ValidationError(field, `${field} must be a valid URL`)
  }
}

export function optionalInt(
  value: unknown,
  field: string,
  { min, max }: { min?: number; max?: number } = {}
): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n)) throw new ValidationError(field, `${field} must be an integer`)
  if (min !== undefined && n < min) throw new ValidationError(field, `${field} must be at least ${min}`)
  if (max !== undefined && n > max) throw new ValidationError(field, `${field} must be at most ${max}`)
  return n
}

export function requireHandle(value: unknown, field = 'handle'): string {
  const s = requireString(value, field, { min: 2, max: 30 })
  if (!/^[a-z0-9_-]+$/.test(s)) {
    throw new ValidationError(field, 'Handle may only contain lowercase letters, numbers, hyphens, and underscores')
  }
  return s
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(field, `${field} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

/**
 * Return a { status, body } tuple for use in route handlers.
 * Usage:
 *   try { ... } catch (e) { return validationErrorResponse(e) }
 */
export function validationErrorResponse(
  e: unknown
): { error: string; field?: string } | null {
  if (e instanceof ValidationError) {
    return { error: e.message, field: e.field }
  }
  return null
}
