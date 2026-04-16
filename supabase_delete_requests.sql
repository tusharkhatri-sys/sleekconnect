-- ==========================================
-- ACCOUNT DELETE REQUESTS SYSTEM
-- Run this in Supabase SQL Editor
-- ==========================================

-- 1. Create delete_requests table
CREATE TABLE IF NOT EXISTS public.delete_requests (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  email       TEXT NOT NULL,
  reason      TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled')),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable RLS
ALTER TABLE public.delete_requests ENABLE ROW LEVEL SECURITY;

-- 3. Users can INSERT their own request
CREATE POLICY "DeleteReq: User can create own request"
ON public.delete_requests FOR INSERT
WITH CHECK ( auth.uid() = user_id );

-- 4. Users can SELECT their own requests
CREATE POLICY "DeleteReq: User can see own requests"
ON public.delete_requests FOR SELECT
USING ( auth.uid() = user_id );

-- 5. Users can UPDATE their own request (to cancel it)
CREATE POLICY "DeleteReq: User can cancel own request"
ON public.delete_requests FOR UPDATE
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id AND status = 'cancelled' );

-- 6. Admins can see ALL delete requests
CREATE POLICY "DeleteReq: Admins see all"
ON public.delete_requests FOR SELECT
USING ( public.is_admin() );

-- 7. Admins can DELETE records (after processing)
CREATE POLICY "DeleteReq: Admins delete records"
ON public.delete_requests FOR DELETE
USING ( public.is_admin() );

-- 8. Add delete_requested column to profiles (to flag users with pending requests)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS delete_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;

-- 9. Admins can update delete_requested flag
-- (already covered by "Profiles: Admins update all" policy)

-- Done! ✅
-- The actual auth.users deletion must be done via the Supabase service_role key
-- (handled server-side or via Supabase dashboard).
-- With anon key, admin can delete the profile row → CASCADE deletes auth.users row
-- only if the foreign key is set correctly (which it is in your schema).
