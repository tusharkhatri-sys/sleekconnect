-- ==========================================
-- SLEEKCONNECT — DELETE REQUESTS SYSTEM
-- Self-contained — no dependency on other SQL files
-- Run this in: Supabase Dashboard → SQL Editor
-- ==========================================

-- Step 1: Ensure is_admin() function exists
-- (Safe to run even if it already exists — uses CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Add new columns to profiles table if they don't exist
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS delete_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS username         TEXT;

-- Step 3: Create delete_requests table
CREATE TABLE IF NOT EXISTS public.delete_requests (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  email        TEXT NOT NULL,
  reason       TEXT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled')),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 4: Enable RLS on delete_requests
ALTER TABLE public.delete_requests ENABLE ROW LEVEL SECURITY;

-- Step 5: Drop old policies first to avoid conflicts on re-run
DROP POLICY IF EXISTS "DeleteReq: User can create own request"  ON public.delete_requests;
DROP POLICY IF EXISTS "DeleteReq: User can see own requests"    ON public.delete_requests;
DROP POLICY IF EXISTS "DeleteReq: User can cancel own request"  ON public.delete_requests;
DROP POLICY IF EXISTS "DeleteReq: Admins see all"               ON public.delete_requests;
DROP POLICY IF EXISTS "DeleteReq: Admins delete records"        ON public.delete_requests;

-- Step 6: RLS Policies for delete_requests

-- Users can INSERT their own request
CREATE POLICY "DeleteReq: User can create own request"
ON public.delete_requests FOR INSERT
WITH CHECK ( auth.uid() = user_id );

-- Users can SELECT their own requests
CREATE POLICY "DeleteReq: User can see own requests"
ON public.delete_requests FOR SELECT
USING ( auth.uid() = user_id );

-- Users can UPDATE their own request (to cancel)
CREATE POLICY "DeleteReq: User can cancel own request"
ON public.delete_requests FOR UPDATE
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id );

-- Admins can see ALL delete requests
CREATE POLICY "DeleteReq: Admins see all"
ON public.delete_requests FOR SELECT
USING ( public.is_admin() );

-- Admins can DELETE request records (after processing)
CREATE POLICY "DeleteReq: Admins delete records"
ON public.delete_requests FOR DELETE
USING ( public.is_admin() );

-- Step 7: Also ensure profiles have the update policy for delete_requested flag
-- (Admins update all policy should already exist, but this adds user self-update for delete_requested)
DROP POLICY IF EXISTS "Profiles: Users update own delete_requested" ON public.profiles;

CREATE POLICY "Profiles: Users update own delete_requested"
ON public.profiles FOR UPDATE
USING ( auth.uid() = id )
WITH CHECK ( auth.uid() = id );

-- Done! ✅
SELECT 'Setup complete! delete_requests table and policies created successfully.' AS result;
