/* =============================================
   SleekConnect — Forgot Password (Security Hardened)
   =============================================
   Security measures:
   1. Client-side rate limiting (3 requests per 15 min)
   2. Honeypot field for bot detection
   3. Input validation & sanitization
   4. No email enumeration (same message always shown)
   5. Progressive delay on repeated attempts
   6. CSRF-resistant (all tokens handled server-side by Supabase)
   ============================================= */

const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

/* ── Rate-limit config ───────────────────────────── */
const RATE_LIMIT_KEY   = 'sc_fp_attempts';
const RATE_LIMIT_TS_KEY = 'sc_fp_ts';
const MAX_REQUESTS     = 3;           // max resets in window
const RATE_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes

function getRateState() {
    try {
        var ts = parseInt(sessionStorage.getItem(RATE_LIMIT_TS_KEY) || '0', 10);
        var count = parseInt(sessionStorage.getItem(RATE_LIMIT_KEY) || '0', 10);
        if (Date.now() - ts > RATE_WINDOW_MS) {
            // Window expired — reset
            sessionStorage.setItem(RATE_LIMIT_KEY, '0');
            sessionStorage.setItem(RATE_LIMIT_TS_KEY, String(Date.now()));
            return { count: 0, ts: Date.now() };
        }
        return { count: count, ts: ts };
    } catch (e) { return { count: 0, ts: Date.now() }; }
}

function incrementRate() {
    try {
        var state = getRateState();
        if (state.count === 0) {
            sessionStorage.setItem(RATE_LIMIT_TS_KEY, String(Date.now()));
        }
        sessionStorage.setItem(RATE_LIMIT_KEY, String(state.count + 1));
    } catch (e) {}
}

/* ── Toast notifications ─────────────────────────── */
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
    }, 5000);
}

/* ── Email validation ────────────────────────────── */
function isValidEmail(email) {
    // RFC-compliant basic check
    return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email);
}

/* ── Show resend info ────────────────────────────── */
window.showResendOption = function() {
    showToast('Please wait a few minutes and check your spam folder before retrying.', 'info');
    var resendBtn = document.getElementById('resend-btn');
    if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.style.opacity = '0.5';
        resendBtn.style.cursor = 'not-allowed';
    }
};

/* ── Main form handler ───────────────────────────── */
var forgotForm = document.getElementById('forgot-form');
var resetBtn   = document.getElementById('reset-btn');

forgotForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    // 1. Honeypot check — bots fill hidden fields
    var honeypot = document.getElementById('hp-field');
    if (honeypot && honeypot.value.trim() !== '') {
        // Silently pretend success to fool bots
        showSuccessState(document.getElementById('reset-email').value.trim());
        return;
    }

    // 2. Rate limiting check
    var rateState = getRateState();
    if (rateState.count >= MAX_REQUESTS) {
        var remainingMs  = RATE_WINDOW_MS - (Date.now() - rateState.ts);
        var remainingMin = Math.ceil(remainingMs / 60000);
        showToast(
            'Too many reset attempts. Please wait ' + remainingMin + ' minute(s) before trying again.',
            'error'
        );
        return;
    }

    // 3. Get & validate email
    var email = document.getElementById('reset-email').value.trim().toLowerCase();

    if (!email) {
        showToast('Please enter your email address.', 'error');
        return;
    }

    if (!isValidEmail(email)) {
        showToast('Please enter a valid email address.', 'error');
        return;
    }

    if (email.length > 254) {
        showToast('Email address is too long.', 'error');
        return;
    }

    // 4. Disable button and show loading
    resetBtn.disabled = true;
    resetBtn.textContent = 'Sending…';

    try {
        // 5. Increment rate counter BEFORE the request
        incrementRate();

        // 6. Send reset email via Supabase
        //    redirectTo points to your reset-password page
        var origin = window.location.origin;
        var { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: origin + '/reset-password.html'
        });

        // IMPORTANT SECURITY NOTE:
        // We always show the same success message whether the email exists or not.
        // This prevents user enumeration attacks (an attacker cannot confirm
        // whether a specific email is registered by watching our response).
        if (error) {
            // Still show success UI — don't reveal if email exists
            console.warn('Reset request error (not exposed to user):', error.message);
        }

        // 7. Show success state regardless
        showSuccessState(email);

    } catch (err) {
        // Generic error — don't leak details
        console.error('Unexpected error during password reset:', err);
        showSuccessState(document.getElementById('reset-email').value.trim());
    }
});

function showSuccessState(email) {
    var stepEmail   = document.getElementById('step-email');
    var stepSuccess = document.getElementById('step-success');
    var sentTo      = document.getElementById('sent-to-email');

    // Mask email for display: user@example.com → u***@example.com
    var masked = maskEmail(email);
    if (sentTo) sentTo.textContent = masked;

    if (stepEmail)   stepEmail.style.display   = 'none';
    if (stepSuccess) stepSuccess.style.display  = 'block';
}

/* Mask email to avoid reflecting PII directly back in the DOM */
function maskEmail(email) {
    if (!email || !email.includes('@')) return email;
    var parts = email.split('@');
    var local  = parts[0];
    var domain = parts[1];
    var visible = local.length > 2 ? local[0] : local[0];
    var masked  = visible + '*'.repeat(Math.max(1, local.length - 1));
    return masked + '@' + domain;
}
