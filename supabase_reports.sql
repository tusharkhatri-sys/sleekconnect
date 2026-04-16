-- ==========================================
-- SLEEKCONNECT — USER REPORTING SYSTEM
-- ==========================================

-- 1. Create reports table
CREATE TABLE IF NOT EXISTS public.reports (
    id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reporter_id  uuid REFERENCES auth.users ON DELETE SET NULL,
    reported_id  uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    reason       TEXT NOT NULL,
    details      TEXT,
    room_id      TEXT,
    status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable RLS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Users can INSERT reports (Security Definer not needed as it's a simple insert)
CREATE POLICY "Reports: Users can report others"
ON public.reports FOR INSERT
WITH CHECK ( auth.uid() = reporter_id );

-- Admins can see ALL reports
CREATE POLICY "Reports: Admins see all"
ON public.reports FOR SELECT
USING ( public.is_admin() );

-- Admins can UPDATE reports (to action/dismiss)
CREATE POLICY "Reports: Admins update all"
ON public.reports FOR UPDATE
USING ( public.is_admin() );

-- Admins can DELETE reports
CREATE POLICY "Reports: Admins delete all"
ON public.reports FOR DELETE
USING ( public.is_admin() );

-- 4. Result
SELECT 'Reporting system SQL ready ✅' AS result;
