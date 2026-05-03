'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useIsSentraAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      setIsAdmin(user?.user_metadata?.is_sentra_admin === true)
    })
  }, [])

  return isAdmin
}
