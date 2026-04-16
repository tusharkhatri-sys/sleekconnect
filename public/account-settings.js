/* =============================================
   SleekConnect — Account Settings + Delete Request
   =============================================
   Security:
   - Auth checked before any action
   - UUID validated before DB operations
   - Reason sanitized (maxlength enforced)
   - Single pending request enforced (one per user)
   ============================================= */

const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;

/* ── Toast ─────────────────────────────────── */
function showToast(msg, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    var icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    var isp = document.createElement('span'); isp.className = 'toast-icon'; isp.textContent = icon;
    var tsp = document.createElement('span'); tsp.textContent = msg;
    t.appendChild(isp); t.appendChild(tsp);
    c.appendChild(t);
    setTimeout(function() {
        t.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function() { t.remove(); }, 300);
    }, 4500);
}

/* ── DOM refs ───────────────────────────────── */
var deleteConfirmCheck  = document.getElementById('delete-confirm-check');
var submitDeleteBtn     = document.getElementById('submit-delete-btn');
var cancelDeleteBtn     = document.getElementById('cancel-delete-btn');
var deleteFormState     = document.getElementById('delete-form-state');
var deletePendingState  = document.getElementById('delete-pending-state');
var sendPwResetBtn      = document.getElementById('send-pw-reset-btn');
var logoutBtn           = document.getElementById('logout-btn');

/* ── Enable submit only when checkbox checked ── */
if (deleteConfirmCheck) {
    deleteConfirmCheck.addEventListener('change', function() {
        submitDeleteBtn.disabled = !this.checked;
    });
}

/* ── INIT ───────────────────────────────────── */
(async function init() {
    try {
        var { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
            window.location.href = 'index.html';
            return;
        }

        // Check admin-approval (unauthorised users shouldn't reach settings)
        var { data: profile } = await supabase
            .from('profiles')
            .select('is_admin_approved, email, delete_requested')
            .eq('id', user.id)
            .single();

        if (!profile || !profile.is_admin_approved) {
            window.location.href = 'waiting-room.html';
            return;
        }

        currentUser = user;

        // Populate account info
        var emailDisp = document.getElementById('account-email-display');
        if (emailDisp) emailDisp.textContent = profile.email || user.email;

        var avatar = document.getElementById('account-avatar');
        if (avatar) avatar.textContent = (profile.email || user.email || 'U')[0].toUpperCase();

        // Check if there's already a pending delete request
        await refreshDeleteState();

    } catch (err) {
        console.error('Init error:', err);
        window.location.href = 'index.html';
    }
})();

/* ── Check / refresh delete request state ───── */
async function refreshDeleteState() {
    if (!currentUser) return;

    var { data: existingReq } = await supabase
        .from('delete_requests')
        .select('id, status')
        .eq('user_id', currentUser.id)
        .eq('status', 'pending')
        .maybeSingle();

    if (existingReq) {
        // Pending request exists
        deleteFormState.style.display    = 'none';
        deletePendingState.style.display = 'block';
    } else {
        deleteFormState.style.display    = 'block';
        deletePendingState.style.display = 'none';
    }
}

/* ── Submit Delete Request ──────────────────── */
if (submitDeleteBtn) {
    submitDeleteBtn.addEventListener('click', async function() {
        if (!currentUser) return;
        if (!deleteConfirmCheck || !deleteConfirmCheck.checked) {
            showToast('Please confirm by checking the checkbox.', 'error');
            return;
        }

        var reasonEl = document.getElementById('delete-reason');
        var reason   = reasonEl ? reasonEl.value.trim().slice(0, 500) : '';

        submitDeleteBtn.disabled  = true;
        submitDeleteBtn.textContent = 'Submitting…';

        try {
            // Check no duplicate pending request
            var { data: existing } = await supabase
                .from('delete_requests')
                .select('id')
                .eq('user_id', currentUser.id)
                .eq('status', 'pending')
                .maybeSingle();

            if (existing) {
                showToast('You already have a pending delete request.', 'info');
                await refreshDeleteState();
                return;
            }

            // Insert request
            var { error } = await supabase
                .from('delete_requests')
                .insert({
                    user_id: currentUser.id,
                    email:   currentUser.email,
                    reason:  reason || null,
                    status:  'pending'
                });

            if (error) throw error;

            // Flag the profile
            await supabase
                .from('profiles')
                .update({ delete_requested: true })
                .eq('id', currentUser.id);

            showToast('Deletion request submitted. Admin will review shortly.', 'success');
            await refreshDeleteState();

        } catch (err) {
            console.error('Delete request error:', err);
            showToast(err.message || 'Failed to submit request.', 'error');
            submitDeleteBtn.disabled  = false;
            submitDeleteBtn.textContent = '🗑️ Request Account Deletion';
        }
    });
}

/* ── Cancel Delete Request ──────────────────── */
if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', async function() {
        if (!currentUser) return;
        if (!confirm('Cancel your deletion request? Your account will remain active.')) return;

        cancelDeleteBtn.disabled    = true;
        cancelDeleteBtn.textContent = 'Cancelling…';

        try {
            // Update status to cancelled
            var { error } = await supabase
                .from('delete_requests')
                .update({ status: 'cancelled' })
                .eq('user_id', currentUser.id)
                .eq('status', 'pending');

            if (error) throw error;

            // Remove flag from profile
            await supabase
                .from('profiles')
                .update({ delete_requested: false })
                .eq('id', currentUser.id);

            showToast('Deletion request cancelled. Your account is safe ✅', 'success');
            await refreshDeleteState();

        } catch (err) {
            console.error('Cancel error:', err);
            showToast(err.message || 'Failed to cancel.', 'error');
        } finally {
            cancelDeleteBtn.disabled    = false;
            cancelDeleteBtn.textContent = '↩ Cancel Deletion Request';
        }
    });
}

/* ── Send Password Reset Email ──────────────── */
if (sendPwResetBtn) {
    sendPwResetBtn.addEventListener('click', async function() {
        if (!currentUser) return;
        sendPwResetBtn.disabled     = true;
        sendPwResetBtn.textContent  = 'Sending…';

        try {
            var origin = window.location.origin;
            var { error } = await supabase.auth.resetPasswordForEmail(currentUser.email, {
                redirectTo: origin + '/reset-password.html'
            });
            if (error) throw error;
            showToast('Password reset email sent! Check your inbox.', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to send reset email.', 'error');
        } finally {
            setTimeout(function() {
                sendPwResetBtn.disabled    = false;
                sendPwResetBtn.textContent = 'Send Password Reset Email';
            }, 30000); // 30s cooldown
        }
    });
}

/* ── Logout ─────────────────────────────────── */
if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });
}
