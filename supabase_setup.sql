-- =====================================================
-- SLEEKCONNECT — COMPLETE DATABASE SETUP (SAFE VERSION)
-- =====================================================
-- ✅ Safe to run on existing database — will NOT delete data
-- Run this FIRST, then run supabase_delete_requests.sql
-- =====================================================

-- ── 1. PROFILES TABLE (create only if not exists) ──
CREATE TABLE IF NOT EXISTS public.profiles (
  id                uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  email             TEXT,
  role              TEXT DEFAULT 'user',
  is_admin_approved BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (safe even if already enabled)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── 2. SECURITY FUNCTION ──
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 3. RLS POLICIES (drop old, recreate safely) ──
DROP POLICY IF EXISTS "Profiles: Users see self"    ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Admins see all"    ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Admins update all" ON public.profiles;

CREATE POLICY "Profiles: Users see self"
ON public.profiles FOR SELECT
USING ( auth.uid() = id );

CREATE POLICY "Profiles: Admins see all"
ON public.profiles FOR SELECT
USING ( public.is_admin() );

CREATE POLICY "Profiles: Admins update all"
ON public.profiles FOR UPDATE
USING ( public.is_admin() );

-- ── 4. AUTH TRIGGER (auto-create profile on signup) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── 5. STORAGE BUCKET ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('verification_selfies', 'verification_selfies', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (drop old first to avoid conflicts)
DROP POLICY IF EXISTS "Storage: Anyone can upload selfies" ON storage.objects;
DROP POLICY IF EXISTS "Storage: Public can see selfies"    ON storage.objects;
DROP POLICY IF EXISTS "Storage: Admins manage all"         ON storage.objects;

CREATE POLICY "Storage: Anyone can upload selfies"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'verification_selfies' );

CREATE POLICY "Storage: Public can see selfies"
ON storage.objects FOR SELECT
USING ( bucket_id = 'verification_selfies' );

CREATE POLICY "Storage: Admins manage all"
ON storage.objects FOR ALL
USING ( public.is_admin() );

-- ── 6. RESULT ──
SELECT 'Step 1 complete ✅ — profiles table + is_admin() ready. Now run supabase_delete_requests.sql' AS result;

-- ── 7. MAKE YOURSELF ADMIN (run separately after registering) ──
-- UPDATE public.profiles
-- SET role = 'admin', is_admin_approved = true
-- WHERE email = 'YOUR_EMAIL@here.com';
