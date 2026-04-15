/* =============================================
   SleekConnect — Agent Login (Security Hardened)
   ============================================= */
const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true, // Persist so adtg.js can read it
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

const formAdmin = document.getElementById('admin-login-form');
const loginBtn = document.getElementById('admin-login-btn');

// Rate limiting
let loginAttempts = 0;
let lockoutUntil = 0;
const MAX_ATTEMPTS = 3; // Stricter for agent portal
const LOCKOUT_MS = 120000; // 2 minutes

function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    var icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    var iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icon;
    var textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    container.appendChild(toast);
    setTimeout(function() {
        toast.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
}

formAdmin.addEventListener('submit', async function(e) {
    e.preventDefault();

    // Check lockout
    if (Date.now() < lockoutUntil) {
        var remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
        showToast('Too many attempts. Locked for ' + remaining + ' seconds.', 'error');
        return;
    }

    var email = document.getElementById('admin-email').value.trim();
    var password = document.getElementById('admin-password').value;

    if (!email || !password) {
        showToast('Please enter both email and access key.', 'error');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Opening Vault…';

    try {
        var result = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (result.error) {
            loginAttempts++;
            if (loginAttempts >= MAX_ATTEMPTS) {
                lockoutUntil = Date.now() + LOCKOUT_MS;
                loginAttempts = 0;
                throw new Error('Too many failed attempts. Agent portal locked for 2 minutes.');
            }
            if (result.error.message.includes('Invalid login credentials')) {
                throw new Error('Invalid credentials. Attempts remaining: ' + (MAX_ATTEMPTS - loginAttempts));
            }
            throw result.error;
        }

        // Reset attempts
        loginAttempts = 0;

        // Verify Agent Role from DB
        var profileResult = await supabaseClient
            .from('profiles')
            .select('role')
            .eq('id', result.data.user.id)
            .maybeSingle();

        if (profileResult.error) throw profileResult.error;

        if (!profileResult.data || profileResult.data.role !== 'admin') {
            await supabaseClient.auth.signOut();
            showToast('Access Denied: You are not an authorized agent.', 'error');
            loginBtn.disabled = false;
            loginBtn.textContent = 'Initialize Session';
            return;
        }

        // Redirect to Dashboard — session is persisted via Supabase (no token in URL)
        showToast('Access Granted. Redirecting…', 'success');
        setTimeout(function() {
            window.location.href = 'adtg.html';
        }, 800);

    } catch (err) {
        console.error('Agent Login Error:', err);
        showToast(err.message || 'Invalid Agent Credentials', 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Initialize Session';
    }
});
