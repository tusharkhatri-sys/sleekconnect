-- ==========================================
-- 1. CLEANUP (Start form scratch to avoid errors)
-- ==========================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.is_admin();
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ==========================================
-- 2. PROFILES TABLE
-- ==========================================
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  email TEXT,
  role TEXT DEFAULT 'user',
  is_admin_approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 3. SECURITY FUNCTIONS (Anti-Recursion)
-- ==========================================
-- This function skips RLS to check admin status safely
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 4. RLS POLICIES FOR PROFILES
-- ==========================================
-- Non-admin users can ONLY see their own profile
CREATE POLICY "Profiles: Users see self" 
ON public.profiles FOR SELECT 
USING ( auth.uid() = id );

-- Admins can see ALL profiles (Uses the helper function to avoid recursion)
CREATE POLICY "Profiles: Admins see all" 
ON public.profiles FOR SELECT 
USING ( public.is_admin() );

-- Admins can update ALL profiles (for Approval)
CREATE POLICY "Profiles: Admins update all" 
ON public.profiles FOR UPDATE 
USING ( public.is_admin() );

-- ==========================================
-- 5. AUTH TRIGGER (Auto-Profile Creation)
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==========================================
-- 6. STORAGE CONFIGURATION
-- ==========================================
-- Create bucket if not exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('verification_selfies', 'verification_selfies', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
-- A. Allow ANONYMOUS upload (Critical fix for registration friction)
CREATE POLICY "Storage: Anyone can upload selfies"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'verification_selfies' );

-- B. Allow PUBLIC viewing (So Admin and website can see the photos)
CREATE POLICY "Storage: Public can see selfies"
ON storage.objects FOR SELECT
USING ( bucket_id = 'verification_selfies' );

-- C. Allow ADMINS to manage everything
CREATE POLICY "Storage: Admins manage all"
ON storage.objects FOR ALL
USING ( public.is_admin() );

-- ==========================================
-- 7. SETTING UP INITIAL ADMIN (Run this after registering!)
-- ==========================================
-- Instructions: 1. Register normally. 2. Replace the email below and run:
-- UPDATE public.profiles SET role = 'admin', is_admin_approved = true WHERE email = 'YOUR_EMAIL@HERE.com';
