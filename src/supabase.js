import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rfqyslequtylnjpzxojf.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcXlzbGVxdXR5bG5qcHp4b2pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NzA0NzksImV4cCI6MjEwNDI0NjQ3OX0.c4CQyy8MD-pwnfyEq6VO4F8nMHAvUnRPWObdH8CtdX8'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)