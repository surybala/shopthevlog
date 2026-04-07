/**
 * Tests for lib/validate.ts
 *
 * Pure TypeScript utility — no network, DB, or Next.js dependencies.
 */
import { describe, it, expect } from 'vitest'
import {
  ValidationError,
  requireString,
  optionalString,
  optionalUrl,
  requireUrl,
  optionalInt,
  requireHandle,
  requireEnum,
  validationErrorResponse,
} from '../lib/validate'


// ─── ValidationError ──────────────────────────────────────────────────────────

describe('ValidationError', () => {
  it('has the correct name', () => {
    const e = new ValidationError('email', 'required')
    expect(e.name).toBe('ValidationError')
  })

  it('stores the field', () => {
    const e = new ValidationError('handle', 'too short')
    expect(e.field).toBe('handle')
  })

  it('stores the message', () => {
    const e = new ValidationError('bio', 'too long')
    expect(e.message).toBe('too long')
  })

  it('is instanceof Error', () => {
    expect(new ValidationError('x', 'y')).toBeInstanceOf(Error)
  })
})


// ─── requireString ────────────────────────────────────────────────────────────

describe('requireString', () => {
  it('returns trimmed string within limits', () => {
    expect(requireString('  hello  ', 'title', { max: 20 })).toBe('hello')
  })

  it('throws when value is empty', () => {
    expect(() => requireString('', 'title', { max: 20 })).toThrow(ValidationError)
  })

  it('throws when value is whitespace only', () => {
    expect(() => requireString('   ', 'title', { max: 20 })).toThrow(ValidationError)
  })

  it('throws when value exceeds max', () => {
    expect(() => requireString('hello', 'title', { max: 3 })).toThrow(ValidationError)
  })

  it('throws when value is not a string', () => {
    expect(() => requireString(42 as unknown as string, 'title', { max: 20 })).toThrow(ValidationError)
  })

  it('accepts value equal to max length', () => {
    expect(requireString('abc', 'x', { max: 3 })).toBe('abc')
  })

  it('throws when below custom min', () => {
    expect(() => requireString('a', 'handle', { min: 2, max: 30 })).toThrow(ValidationError)
  })

  it('field name appears in thrown error', () => {
    try {
      requireString('', 'myField', { max: 10 })
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as ValidationError).field).toBe('myField')
    }
  })
})


// ─── optionalString ────────────────────────────────────────────────────────────

describe('optionalString', () => {
  it('returns null for undefined', () => {
    expect(optionalString(undefined, 'bio', { max: 500 })).toBeNull()
  })

  it('returns null for null', () => {
    expect(optionalString(null, 'bio', { max: 500 })).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(optionalString('', 'bio', { max: 500 })).toBeNull()
  })

  it('returns trimmed value when within limit', () => {
    expect(optionalString('  Paris  ', 'city', { max: 100 })).toBe('Paris')
  })

  it('throws when value exceeds max', () => {
    expect(() => optionalString('x'.repeat(501), 'bio', { max: 500 })).toThrow(ValidationError)
  })

  it('throws when value is not a string', () => {
    expect(() => optionalString(true as unknown as string, 'bio', { max: 100 })).toThrow(ValidationError)
  })
})


// ─── optionalUrl ──────────────────────────────────────────────────────────────

describe('optionalUrl', () => {
  it('returns null for undefined', () => {
    expect(optionalUrl(undefined, 'website')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(optionalUrl('', 'website')).toBeNull()
  })

  it('accepts valid https URL', () => {
    expect(optionalUrl('https://example.com', 'website')).toBe('https://example.com')
  })

  it('accepts valid http URL', () => {
    expect(optionalUrl('http://example.com/path?q=1', 'website')).toBe('http://example.com/path?q=1')
  })

  it('rejects ftp protocol', () => {
    expect(() => optionalUrl('ftp://example.com', 'website')).toThrow(ValidationError)
  })

  it('rejects javascript protocol', () => {
    expect(() => optionalUrl('javascript:alert(1)', 'website')).toThrow(ValidationError)
  })

  it('rejects non-URL string', () => {
    expect(() => optionalUrl('not a url', 'website')).toThrow(ValidationError)
  })
})


// ─── requireUrl ───────────────────────────────────────────────────────────────

describe('requireUrl', () => {
  it('accepts valid https URL', () => {
    expect(requireUrl('https://youtube.com/watch?v=abc', 'url')).toBe('https://youtube.com/watch?v=abc')
  })

  it('throws when empty', () => {
    expect(() => requireUrl('', 'url')).toThrow(ValidationError)
  })

  it('throws when undefined', () => {
    expect(() => requireUrl(undefined as unknown as string, 'url')).toThrow(ValidationError)
  })

  it('throws for non-http protocol', () => {
    expect(() => requireUrl('ftp://files.example.com', 'url')).toThrow(ValidationError)
  })
})


// ─── optionalInt ──────────────────────────────────────────────────────────────

describe('optionalInt', () => {
  it('returns null for undefined', () => {
    expect(optionalInt(undefined, 'days')).toBeNull()
  })

  it('returns null for null', () => {
    expect(optionalInt(null, 'days')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(optionalInt('', 'days')).toBeNull()
  })

  it('returns integer for numeric string', () => {
    expect(optionalInt('7', 'days')).toBe(7)
  })

  it('returns integer for number', () => {
    expect(optionalInt(14, 'days')).toBe(14)
  })

  it('throws for float', () => {
    expect(() => optionalInt(3.5, 'days')).toThrow(ValidationError)
  })

  it('throws when below min', () => {
    expect(() => optionalInt(0, 'days', { min: 1, max: 365 })).toThrow(ValidationError)
  })

  it('throws when above max', () => {
    expect(() => optionalInt(366, 'days', { min: 1, max: 365 })).toThrow(ValidationError)
  })

  it('accepts value at exact min boundary', () => {
    expect(optionalInt(1, 'days', { min: 1, max: 365 })).toBe(1)
  })

  it('accepts value at exact max boundary', () => {
    expect(optionalInt(365, 'days', { min: 1, max: 365 })).toBe(365)
  })
})


// ─── requireHandle ────────────────────────────────────────────────────────────

describe('requireHandle', () => {
  it('accepts valid lowercase handle', () => {
    expect(requireHandle('alice_travels', 'handle')).toBe('alice_travels')
  })

  it('accepts handle with numbers and hyphens', () => {
    expect(requireHandle('traveler-42', 'handle')).toBe('traveler-42')
  })

  it('throws for uppercase letters', () => {
    expect(() => requireHandle('Alice', 'handle')).toThrow(ValidationError)
  })

  it('throws for handle with spaces', () => {
    expect(() => requireHandle('alice travels', 'handle')).toThrow(ValidationError)
  })

  it('throws for special characters', () => {
    expect(() => requireHandle('alice!', 'handle')).toThrow(ValidationError)
  })

  it('throws for handle shorter than 2 chars', () => {
    expect(() => requireHandle('a', 'handle')).toThrow(ValidationError)
  })

  it('throws for handle longer than 30 chars', () => {
    expect(() => requireHandle('a'.repeat(31), 'handle')).toThrow(ValidationError)
  })

  it('accepts exactly 2 chars', () => {
    expect(requireHandle('ab', 'handle')).toBe('ab')
  })

  it('accepts exactly 30 chars', () => {
    expect(requireHandle('a'.repeat(30), 'handle')).toBe('a'.repeat(30))
  })
})


// ─── requireEnum ──────────────────────────────────────────────────────────────

describe('requireEnum', () => {
  const PLATFORMS = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM'] as const

  it('returns valid enum value', () => {
    expect(requireEnum('YOUTUBE', 'platform', PLATFORMS)).toBe('YOUTUBE')
  })

  it('throws for value not in allowed list', () => {
    expect(() => requireEnum('TWITTER', 'platform', PLATFORMS)).toThrow(ValidationError)
  })

  it('throws for empty string', () => {
    expect(() => requireEnum('', 'platform', PLATFORMS)).toThrow(ValidationError)
  })

  it('throws for undefined', () => {
    expect(() => requireEnum(undefined, 'platform', PLATFORMS)).toThrow(ValidationError)
  })

  it('is case-sensitive', () => {
    expect(() => requireEnum('youtube', 'platform', PLATFORMS)).toThrow(ValidationError)
  })
})


// ─── validationErrorResponse ──────────────────────────────────────────────────

describe('validationErrorResponse', () => {
  it('returns error + field for ValidationError', () => {
    const e = new ValidationError('title', 'title is required')
    expect(validationErrorResponse(e)).toEqual({ error: 'title is required', field: 'title' })
  })

  it('returns null for non-ValidationError', () => {
    expect(validationErrorResponse(new Error('generic'))).toBeNull()
  })

  it('returns null for null', () => {
    expect(validationErrorResponse(null)).toBeNull()
  })

  it('returns null for string error', () => {
    expect(validationErrorResponse('something went wrong')).toBeNull()
  })
})
