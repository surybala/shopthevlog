/**
 * Finds the seed user by email, sets a password, then updates the Creator
 * record's userId to match the real Supabase UUID.
 * Run: npx tsx scripts/set-seed-password.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const EMAIL = 'coolsury@gmail.com'
const PASSWORD = 'seedpassword123'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // 1. Find the user by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) { console.error('Could not list users:', listError.message); process.exit(1) }

  console.log('All users in Supabase:')
  users.forEach(u => console.log(`  ${u.id}  ${u.email}`))

  const user = users.find(u => u.email === EMAIL)
  if (!user) { console.error(`\nNo user with email ${EMAIL} — pick one from the list above and update EMAIL in this script`); process.exit(1) }

  console.log(`Found user: ${user.id}`)

  // 2. Set the password
  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    password: PASSWORD,
    email_confirm: true,
  })
  if (updateError) { console.error('Failed to set password:', updateError.message); process.exit(1) }

  // 3. Sync the Creator record's userId to the real UUID
  const updated = await prisma.creator.updateMany({
    where: { handle: 'alexwanders' },
    data: { userId: user.id },
  })
  if (updated.count === 0) {
    console.warn('Creator @alexwanders not found in DB — run the seed first')
  } else {
    console.log('Creator userId updated to match Supabase UUID')
  }

  console.log('\nDone. Log in at http://localhost:3000/login with:')
  console.log(`  Email:    ${EMAIL}`)
  console.log(`  Password: ${PASSWORD}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
