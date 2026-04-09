import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const createBrowserClientMock = vi.fn()
const createServerClientMock = vi.fn()
const cookiesMock = vi.fn()
const prismaConstructorMock = vi.fn()
const prismaPgMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: createBrowserClientMock,
  createServerClient: createServerClientMock,
}))

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: prismaConstructorMock,
}))

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: prismaPgMock,
}))

describe('client factories', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    createBrowserClientMock.mockReset()
    createServerClientMock.mockReset()
    cookiesMock.mockReset()
    prismaConstructorMock.mockReset()
    prismaPgMock.mockReset()
    delete (globalThis as { prisma?: unknown }).prisma
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable'
    process.env.SUPABASE_SECRET_KEY = 'secret'
    process.env.DATABASE_URL = 'postgresql://example'
    process.env.NODE_ENV = 'test'
  })

  it('creates a Supabase admin client and errors when env is missing', async () => {
    createClientMock.mockReturnValue({ kind: 'admin' })
    const { createSupabaseAdmin } = await import('@/lib/supabase/admin')

    expect(createSupabaseAdmin()).toEqual({ kind: 'admin' })
    expect(createClientMock).toHaveBeenCalledWith('https://supabase.example', 'secret', {
      auth: { persistSession: false },
    })

    delete process.env.SUPABASE_SECRET_KEY
    expect(() => createSupabaseAdmin()).toThrow(/Missing Supabase admin env vars/)
  })

  it('creates a Supabase browser client', async () => {
    createBrowserClientMock.mockReturnValue({ kind: 'browser' })
    const { createSupabaseClient } = await import('@/lib/supabase/client')

    expect(createSupabaseClient()).toEqual({ kind: 'browser' })
    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://supabase.example',
      'publishable'
    )
  })

  it('creates a Supabase server client and proxies cookie reads and writes', async () => {
    const cookieStore = {
      getAll: vi.fn(() => [{ name: 'sb', value: 'token' }]),
      set: vi.fn(),
    }
    cookiesMock.mockReturnValue(cookieStore)
    createServerClientMock.mockImplementation((_url, _key, options) => options)

    const { createSupabaseServer } = await import('@/lib/supabase/server')
    const result = createSupabaseServer()

    expect(result.cookies.getAll()).toEqual([{ name: 'sb', value: 'token' }])
    result.cookies.setAll([{ name: 'sb', value: 'next', options: { path: '/' } }])
    expect(cookieStore.set).toHaveBeenCalledWith('sb', 'next', { path: '/' })
  })

  it('swallows cookie writes in read-only server contexts', async () => {
    const cookieStore = {
      getAll: vi.fn(() => []),
      set: vi.fn(() => {
        throw new Error('read-only')
      }),
    }
    cookiesMock.mockReturnValue(cookieStore)
    createServerClientMock.mockImplementation((_url, _key, options) => options)

    const { createSupabaseServer } = await import('@/lib/supabase/server')
    const result = createSupabaseServer()

    expect(() =>
      result.cookies.setAll([{ name: 'sb', value: 'next', options: { path: '/' } }])
    ).not.toThrow()
  })

  it('creates and caches the Prisma client outside production', async () => {
    const adapterInstance = { kind: 'adapter' }
    const prismaInstance = { kind: 'prisma' }
    prismaPgMock.mockImplementation(function PrismaPg(this: Record<string, unknown>, options) {
      Object.assign(this, adapterInstance, { options })
    })
    prismaConstructorMock.mockImplementation(function PrismaClient(this: Record<string, unknown>, options) {
      Object.assign(this, prismaInstance, { options })
    })

    const module = await import('@/lib/prisma/client')

    expect(module.default).toMatchObject(prismaInstance)
    expect(prismaPgMock).toHaveBeenCalledWith({ connectionString: 'postgresql://example' })
    expect(prismaConstructorMock).toHaveBeenCalledWith({
      adapter: expect.objectContaining(adapterInstance),
      log: ['error'],
    })
    expect((globalThis as { prisma?: unknown }).prisma).toMatchObject(prismaInstance)
  })
})
