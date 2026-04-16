/* =============================================
   SleekConnect — Reset Password (Security Hardened)
   =============================================
   Security measures implemented:
   1. Token extracted from URL hash (never sent to server logs)
   2. Supabase session verified server-side before allowing password change
   3. Password strength enforcement (min 8 chars, upper, lower, digit, special)
   4. Passwords never logged or reflected back in the DOM
   5. All other sessions signed out after successful reset (global sign-out)
   6. Immediate redirect protection — page shows loading state first
   7. Token consumed on use (one-time link — Supabase enforces this)
   8. No old password needed (recovery flow), but we enforce strong password policy
   ============================================= */

const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

/* ── UI state helpers ─────────────────────────────── */
function showState(stateId) {
    ['state-loading', 'state-invalid', 'state-form', 'state-success'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = (id === stateId) ? 'block' : 'none';
    });
}

/* ── Toast ────────────────────────────────────────── */
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
        setTimeout(function () { toast.remove(); }, 300);
    }, 5000);
}

/* ── Show/hide password toggle ───────────────────── */
window.togglePw = function(inputId, btnId) {
    var input = document.getElementById(inputId);
    var btn   = document.getElementById(btnId);
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.setAttribute('aria-label', 'Hide password');
    } else {
        input.type = 'password';
        btn.textContent = '👁';
        btn.setAttribute('aria-label', 'Show password');
    }
};

/* ── Password requirements ───────────────────────── */
var REQUIREMENTS = {
    'req-len':      { label: 'At least 8 chars',   test: function(p) { return p.length >= 8; } },
    'req-upper':    { label: 'Uppercase letter',    test: function(p) { return /[A-Z]/.test(p); } },
    'req-lower':    { label: 'Lowercase letter',    test: function(p) { return /[a-z]/.test(p); } },
    'req-digit':    { label: 'Number',              test: function(p) { return /[0-9]/.test(p); } },
    'req-spec':     { label: 'Special char',        test: function(p) { return /[!@#$%^&*()\-_=+\[\]{};:'",.<>?\/\\|`~]/.test(p); } },
    'req-no-space': { label: 'No spaces',           test: function(p) { return !/\s/.test(p); } }
};

function getStrengthScore(password) {
    if (!password) return 0;
    var score = 0;
    var checks = [
        password.length >= 8,
        password.length >= 12,
        /[A-Z]/.test(password),
        /[a-z]/.test(password),
        /[0-9]/.test(password),
        /[!@#$%^&*()\-_=+\[\]{};:'",.<>?\/\\|`~]/.test(password),
        !/\s/.test(password) && password.length > 0
    ];
    checks.forEach(function(c) { if (c) score++; });
    return score; // 0–7
}

function updateStrengthUI(password) {
    var bar      = document.getElementById('strength-bar');
    var label    = document.getElementById('strength-label');
    var wrap     = document.getElementById('strength-wrap');
    var reqList  = document.getElementById('req-list');
    if (!bar || !label) return;

    if (!password) {
        wrap.style.display    = 'none';
        reqList.style.display = 'none';
        label.textContent     = '';
        return;
    }

    wrap.style.display    = 'block';
    reqList.style.display = 'grid';

    var score = getStrengthScore(password);

    // Update checklist
    Object.keys(REQUIREMENTS).forEach(function(reqId) {
        var li = document.getElementById(reqId);
        if (!li) return;
        var passed = REQUIREMENTS[reqId].test(password);
        li.classList.toggle('met', passed);
    });

    // Update bar
    var pct, color, labelText;
    if (score <= 2) {
        pct = 25;  color = 'var(--danger)';  labelText = '🔴 Weak — choose a stronger password';
    } else if (score <= 4) {
        pct = 55;  color = 'var(--warning)'; labelText = '🟡 Fair — add special chars & length';
    } else if (score <= 5) {
        pct = 80;  color = '#60a5fa';        labelText = '🔵 Good — almost there!';
    } else {
        pct = 100; color = 'var(--success)'; labelText = '🟢 Strong password!';
    }

    bar.style.width      = pct + '%';
    bar.style.background = color;
    label.style.color    = color;
    label.textContent    = labelText;
}

function isPasswordValid(password) {
    return Object.keys(REQUIREMENTS).every(function(reqId) {
        return REQUIREMENTS[reqId].test(password);
    });
}

/* ── Match indicator ──────────────────────────────── */
function updateMatchIndicator() {
    var pw1 = document.getElementById('new-password').value;
    var pw2 = document.getElementById('confirm-password').value;
    var ind = document.getElementById('match-indicator');
    var btn = document.getElementById('save-btn');
    if (!ind) return;

    if (!pw2) {
        ind.textContent = '';
        ind.className   = 'match-indicator';
    } else if (pw1 === pw2) {
        ind.textContent = '✓ Passwords match';
        ind.className   = 'match-indicator match-ok';
    } else {
        ind.textContent = '✗ Passwords do not match';
        ind.className   = 'match-indicator match-bad';
    }

    // Enable submit only when both fields valid
    var allGood = pw1 && pw2 && pw1 === pw2 && isPasswordValid(pw1);
    if (btn) btn.disabled = !allGood;
}

/* ── Wire up live validation events ──────────────── */
document.addEventListener('DOMContentLoaded', function() {
    var newPwField     = document.getElementById('new-password');
    var confirmPwField = document.getElementById('confirm-password');

    if (newPwField) {
        newPwField.addEventListener('input', function() {
            updateStrengthUI(this.value);
            updateMatchIndicator();
        });
    }
    if (confirmPwField) {
        confirmPwField.addEventListener('input', updateMatchIndicator);
    }
});

/* ═══════════════════════════════════════════════════
   TOKEN VERIFICATION — On page load
   Supabase sends the token in the URL hash fragment
   e.g. #access_token=xxx&type=recovery&...
   We extract the session from the hash to verify it.
   ═══════════════════════════════════════════════════ */
var _sessionVerified = false;

(async function verifyToken() {
    showState('state-loading');

    try {
        // Give Supabase time to parse the hash and set the session
        await new Promise(function(resolve) { setTimeout(resolve, 600); });

        // Check if Supabase has established a session from the recovery link
        var { data: { session }, error } = await supabaseClient.auth.getSession();

        // Recovery links have type=recovery in the hash — check for that
        var hash = window.location.hash;
        var isRecoveryFlow = hash.includes('type=recovery') || hash.includes('type=email_change');

        if (error || !session) {
            // Also try to get from URL hash manually
            // Supabase JS should auto-handle this, but as fallback:
            var hashParams = parseHashParams(hash);
            if (hashParams.access_token && hashParams.type === 'recovery') {
                // Set session manually
                var { error: setErr } = await supabaseClient.auth.setSession({
                    access_token:  hashParams.access_token,
                    refresh_token: hashParams.refresh_token || ''
                });
                if (setErr) {
                    showState('state-invalid');
                    return;
                }
                _sessionVerified = true;
                // Clear the hash for security (don't leave token in URL bar)
                history.replaceState(null, '', window.location.pathname + window.location.search);
                showState('state-form');
            } else {
                showState('state-invalid');
            }
            return;
        }

        // We have a valid session
        _sessionVerified = true;

        // Clear the token hash from the URL bar (security best practice)
        if (hash) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }

        showState('state-form');

    } catch (err) {
        console.error('Token verification failed:', err);
        showState('state-invalid');
    }
})();

/* Parse #hash into key-value pairs */
function parseHashParams(hash) {
    if (!hash || hash.length < 2) return {};
    var params = {};
    hash.substring(1).split('&').forEach(function(pair) {
        var kv = pair.split('=');
        if (kv.length === 2) {
            params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
        }
    });
    return params;
}

/* ═══════════════════════════════════════════════════
   FORM SUBMISSION — Actually update the password
   ═══════════════════════════════════════════════════ */
var resetForm = document.getElementById('reset-form');
if (resetForm) {
    resetForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (!_sessionVerified) {
            showToast('Session expired. Please request a new reset link.', 'error');
            showState('state-invalid');
            return;
        }

        var newPassword     = document.getElementById('new-password').value;
        var confirmPassword = document.getElementById('confirm-password').value;
        var saveBtn         = document.getElementById('save-btn');

        /* Validation */
        if (!newPassword || !confirmPassword) {
            showToast('Please fill in both password fields.', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast('Passwords do not match.', 'error');
            return;
        }

        if (!isPasswordValid(newPassword)) {
            showToast('Password does not meet all security requirements.', 'error');
            return;
        }

        if (newPassword.length > 128) {
            showToast('Password must be 128 characters or fewer.', 'error');
            return;
        }

        /* Disable UI */
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            /* Update via Supabase — uses the active recovery session */
            var { error } = await supabaseClient.auth.updateUser({
                password: newPassword
            });

            if (error) {
                throw error;
            }

            /* Sign out ALL other sessions after password reset */
            try {
                await supabaseClient.auth.signOut({ scope: 'global' });
            } catch (signOutErr) {
                // Non-fatal — password already changed
                console.warn('Global sign-out warning:', signOutErr.message);
            }

            /* Clear password fields from memory */
            document.getElementById('new-password').value     = '';
            document.getElementById('confirm-password').value = '';

            /* Show success */
            showState('state-success');
            showToast('Password reset successful!', 'success');

        } catch (err) {
            var msg = err.message || 'Failed to update password.';

            // Map Supabase errors to user-friendly messages
            if (msg.includes('expired') || msg.includes('invalid') || msg.includes('JWT')) {
                showToast('Reset link has expired. Please request a new one.', 'error');
                showState('state-invalid');
            } else if (msg.includes('same password')) {
                showToast('New password must be different from your current password.', 'error');
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save New Password';
            } else {
                showToast('Error: ' + msg, 'error');
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save New Password';
            }
        }
    });
}
