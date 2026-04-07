/**
 * Lazily get-or-create the Subscriber record for a Supabase auth user.
 *
 * A Subscriber record is created on first interaction (follow, save-kit, etc.)
 * rather than at signup, so we don't pollute the table with creators who never
 * use the subscriber side of the platform.
 */
import prisma from '@/lib/prisma/client'

interface SupabaseUser {
  id: string
  email?: string
  user_metadata?: { full_name?: string; name?: string }
}

export async function getOrCreateSubscriber(
  user: SupabaseUser,
): Promise<{ id: string; displayName: string }> {
  const existing = await prisma.subscriber.findUnique({
    where: { userId: user.id },
    select: { id: true, displayName: true },
  })
  if (existing) return existing

  const displayName =
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split('@')[0] ??
    'Traveler'

  return prisma.subscriber.create({
    data: { userId: user.id, displayName },
    select: { id: true, displayName: true },
  })
}
