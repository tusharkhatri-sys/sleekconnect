/* =============================================
   SleekConnect — Login (Security Hardened)
   ============================================= */
const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

const formLogin = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');

// Rate limiting
let loginAttempts = 0;
let lockoutUntil = 0;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60000; // 1 minute

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    // XSS-safe: use textContent for the message part
    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icon;
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    container.appendChild(toast);
    setTimeout(function() {
        toast.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
}

// Sanitize input
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>"'&]/g, function(c) {
        return {'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c];
    });
}

formLogin.addEventListener('submit', async function(e) {
    e.preventDefault();

    // Check lockout
    if (Date.now() < lockoutUntil) {
        const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
        showToast('Too many attempts. Try again in ' + remaining + ' seconds.', 'error');
        return;
    }

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showToast('Please enter both email and password.', 'error');
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Authenticating…';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            loginAttempts++;
            if (loginAttempts >= MAX_ATTEMPTS) {
                lockoutUntil = Date.now() + LOCKOUT_MS;
                loginAttempts = 0;
                throw new Error('Too many failed attempts. Account locked for 1 minute.');
            }
            throw error;
        }

        // Reset attempts on success
        loginAttempts = 0;

        // Verify Admin Approval
        const { data: profile, error: dbError } = await supabaseClient
            .from('profiles')
            .select('is_admin_approved, role')
            .eq('id', data.user.id)
            .single();

        if (dbError) throw dbError;

        if (profile.role === 'admin') {
            window.location.href = 'admin.html';
            return;
        }

        if (profile.is_admin_approved !== true) {
            await supabaseClient.auth.signOut();
            showToast('Account pending agent review. Usually takes 24-48hrs.', 'error');
            loginBtn.disabled = false;
            loginBtn.textContent = 'Authenticate Session';
            return;
        }

        showToast('Login successful! Redirecting…', 'success');
        setTimeout(function() {
            window.location.href = 'app.html';
        }, 800);

    } catch (err) {
        showToast(err.message || 'Invalid credentials', 'error');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Authenticate Session';
    }
});
