import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import prisma from '@/lib/prisma/client'
import OnboardingForm from './OnboardingForm'

export default async function OnboardingPage() {
  const supabase = createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Already has a profile — skip onboarding
  const creator = await prisma.creator.findUnique({ where: { userId: user.id } })
  if (creator) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Set up your storefront</h1>
          <p className="mt-2 text-sm text-white/50">
            This takes 30 seconds. You can change everything later.
          </p>
        </div>

        <OnboardingForm />
      </div>
    </div>
  )
}
