/* =============================================
   SleekConnect — Agent Dashboard v2.0
   Features:
   1. Pending user approval (identity verification)
   2. Delete request management (approve/dismiss)
   3. All users management (ban/unban/force-delete)
   4. Enhanced stats (5 cards)
   5. Tab navigation
   6. Email search filter on all-users tab
   Security: XSS-safe DOM, UUID validation, admin-only access
   ============================================= */

const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';

const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

let socket;
try {
    socket = typeof io !== 'undefined' ? io() : null;
} catch (e) {
    console.error('Socket.io failed:', e);
}



const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cached all-users data for client-side filtering
var _allUsersCache = [];

// ========== TOAST ==========
function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    var icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    var isp = document.createElement('span'); isp.className = 'toast-icon'; isp.textContent = icon;
    var tsp = document.createElement('span'); tsp.textContent = message;
    toast.appendChild(isp); toast.appendChild(tsp);
    container.appendChild(toast);
    setTimeout(function () {
        toast.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

// ========== TAB SWITCHING ==========
window.switchTab = function (tabId) {
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    var panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');
    var btn = document.querySelector('[data-tab="' + tabId + '"]');
    if (btn) btn.classList.add('active');

    // Lazy-load on tab switch
    if (tabId === 'tab-delrequests') loadDeleteRequests();
    if (tabId === 'tab-allusers')    loadAllUsers();
    if (tabId === 'tab-reports')     loadUserReports();
};

// ========== ADMIN ACCESS CHECK ==========
async function checkAdmin() {
    var userResult = await supabaseClient.auth.getUser();
    var user = userResult.data ? userResult.data.user : null;

    if (!user) {
        window.location.href = 'adlg.html';
        return;
    }

    var profileResult = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (!profileResult.data || profileResult.data.role !== 'admin') {
        showToast('Access Denied: Agent Clearance Required', 'error');
        setTimeout(function () { window.location.href = 'adlg.html'; }, 2000);
    } else {
        loadDashboard();
    }
}

// ========== LOAD DASHBOARD (Pending tab) ==========
async function loadDashboard() {
    await loadStats();
    await loadPendingUsers();
}

// ========== STATS ==========
async function loadStats() {
    // 1. Core Profile Stats
    try {
        var { data: profiles, error: pErr } = await supabaseClient
            .from('profiles')
            .select('id, is_admin_approved, role, banned, delete_requested');
        
        if (pErr) throw pErr;
        
        var nonAdmins = (profiles || []).filter(function (p) { return p.role === 'user'; });
        var total     = nonAdmins.length;
        var pending   = nonAdmins.filter(function (p) { return !p.is_admin_approved && !p.banned; }).length;
        var approved  = nonAdmins.filter(function (p) { return p.is_admin_approved && !p.banned; }).length;
        var banned    = nonAdmins.filter(function (p) { return p.banned; }).length;
        var delCount  = nonAdmins.filter(function (p) { return p.delete_requested; }).length;

        setText('stat-total', total);
        setText('stat-pending', pending);
        setText('stat-banned', banned);
        setText('badge-pending', pending);
    } catch (err) {
        console.warn('Profile stats failed (check if profiles table has banned/delete_requested columns):', err);
    }

    // 2. Delete Requests (Table based)
    try {
        var { count, error: dErr } = await supabaseClient
            .from('delete_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        
        if (!dErr) {
            setText('stat-delreq', count || 0);
            setText('badge-delreq', count || 0);
        }
    } catch (err) {
        console.warn('Delete requests table not ready yet.');
    }

    // 3. User Reports (Table based)
    try {
        var { count, error: rErr } = await supabaseClient
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        
        if (!rErr) {
            setText('badge-reports', count || 0);
        }
    } catch (err) {
        console.warn('Reports table not ready yet.');
    }
}


function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(val);
}

// ========== FORMAT DATE ==========
function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ════════════════════════════════════════════════
// TAB 1: PENDING APPROVALS
// ════════════════════════════════════════════════
async function loadPendingUsers() {
    var tbody = document.getElementById('pending-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';

    var result = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('is_admin_approved', false)
        .eq('role',  'user')
        .or('banned.is.null,banned.eq.false');

    if (result.error) {
        showToast('Error loading pending users', 'error');
        console.error(result.error);
        return;
    }

    var profiles = result.data || [];
    tbody.innerHTML = '';

    if (profiles.length === 0) {
        var row = tbody.insertRow();
        var cell = row.insertCell();
        cell.colSpan = 4;
        cell.className = 'empty-state';
        cell.textContent = '✅ No pending requests! All clear.';
        return;
    }

    for (var i = 0; i < profiles.length; i++) {
        await renderPendingRow(profiles[i], tbody);
    }
}

async function renderPendingRow(profile, tbody) {
    // Fetch selfie
    var filesResult = await supabaseClient.storage.from('verification_selfies').list(profile.id);
    var files       = filesResult.data || [];
    var imgUrl = '', fileName = '';

    if (files.length > 0) {
        fileName  = profile.id + '/' + files[0].name;
        var urlRes = supabaseClient.storage.from('verification_selfies').getPublicUrl(fileName);
        imgUrl     = urlRes.data.publicUrl;
    }

    var tr = document.createElement('tr');

    // Email (XSS-safe)
    var emailTd = document.createElement('td');
    emailTd.textContent = profile.email || '—';
    tr.appendChild(emailTd);

    // Registered date
    var dateTd = document.createElement('td');
    dateTd.style.fontSize = '0.8rem';
    dateTd.style.color    = 'var(--text-muted)';
    dateTd.textContent    = formatDate(profile.created_at);
    tr.appendChild(dateTd);

    // Selfie
    var selfieTd = document.createElement('td');
    if (imgUrl) {
        var img = document.createElement('img');
        img.src       = imgUrl;
        img.alt       = 'Identity selfie';
        img.className = 'selfie-thumb';
        img.addEventListener('click', (function (url) {
            return function () { openModal(url); };
        }(imgUrl)));
        selfieTd.appendChild(img);
    } else {
        var noImg = document.createElement('span');
        noImg.style.color  = 'var(--text-muted)';
        noImg.textContent  = 'No Image';
        selfieTd.appendChild(noImg);
    }
    tr.appendChild(selfieTd);

    // Actions
    var actionTd = document.createElement('td');

    var approveBtn = makeBtn('✓ Approve', 'btn-approve', function () {
        handleApproveReject(profile.id, fileName, true);
    });
    var rejectBtn = makeBtn('✕ Reject', 'btn-reject', function () {
        handleApproveReject(profile.id, fileName, false);
    });

    actionTd.appendChild(approveBtn);
    actionTd.appendChild(rejectBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
}

async function handleApproveReject(userId, imagePath, isApprove) {
    if (!UUID_REGEX.test(userId)) { showToast('Invalid user ID', 'error'); return; }
    if (!confirm((isApprove ? 'APPROVE' : 'REJECT') + ' this user?')) return;

    try {
        if (isApprove) {
            var { error } = await supabaseClient.from('profiles')
                .update({ is_admin_approved: true })
                .eq('id', userId);
            if (error) throw error;
            showToast('User Approved ✅', 'success');
        } else {
            var { error: delErr } = await supabaseClient.from('profiles')
                .delete()
                .eq('id', userId);
            if (delErr) throw delErr;
            showToast('User Rejected & Removed', 'success');
        }
        if (imagePath) {
            await supabaseClient.storage.from('verification_selfies').remove([imagePath]);
        }
        await loadDashboard();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

// ════════════════════════════════════════════════
// TAB 2: DELETE REQUESTS
// ════════════════════════════════════════════════
async function loadDeleteRequests() {
    var tbody = document.getElementById('delreq-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading…</td></tr>';

    var result = await supabaseClient
        .from('delete_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: true });

    if (result.error) {
        showToast('Error loading delete requests', 'error');
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="color:var(--danger)">Error loading data.</td></tr>';
        return;
    }

    var requests = result.data || [];
    tbody.innerHTML = '';

    if (requests.length === 0) {
        var row = tbody.insertRow();
        var cell = row.insertCell();
        cell.colSpan = 4;
        cell.className = 'empty-state';
        cell.textContent = '✅ No pending delete requests.';
        return;
    }

    requests.forEach(function (req) {
        renderDeleteRequestRow(req, tbody);
    });
}

function renderDeleteRequestRow(req, tbody) {
    var tr = document.createElement('tr');

    // Email
    var emailTd = document.createElement('td');
    emailTd.textContent = req.email || '—';
    tr.appendChild(emailTd);

    // Reason
    var reasonTd = document.createElement('td');
    reasonTd.className = 'reason-cell';
    var reasonSpan = document.createElement('span');
    reasonSpan.title      = req.reason || '';
    reasonSpan.textContent = req.reason || '(No reason given)';
    reasonSpan.style.color = req.reason ? 'var(--text-secondary)' : 'var(--text-muted)';
    reasonTd.appendChild(reasonSpan);
    tr.appendChild(reasonTd);

    // Date
    var dateTd = document.createElement('td');
    dateTd.style.fontSize = '0.8rem';
    dateTd.style.color    = 'var(--text-muted)';
    dateTd.textContent    = formatDate(req.requested_at);
    tr.appendChild(dateTd);

    // Actions
    var actionTd = document.createElement('td');

    var confirmBtn = makeBtn('🗑️ Delete Account', 'btn-confirm-del', function () {
        handleConfirmDelete(req.id, req.user_id, tr);
    });

    var dismissBtn = makeBtn('✕ Dismiss', 'btn-dismiss', function () {
        handleDismissDelete(req.id, req.user_id, tr);
    });

    actionTd.appendChild(confirmBtn);
    actionTd.appendChild(dismissBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
}

async function handleConfirmDelete(reqId, userId, trEl) {
    if (!UUID_REGEX.test(userId)) { showToast('Invalid user ID', 'error'); return; }
    if (!confirm('⚠️ PERMANENTLY DELETE this user and all their data? This cannot be undone.')) return;

    try {
        // 1. Delete the profile (CASCADE deletes auth.user)
        var { error: profileErr } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId);
        if (profileErr) throw profileErr;

        // 2. Remove the delete request record
        await supabaseClient.from('delete_requests').delete().eq('id', reqId);

        // 3. Remove selfie if exists
        var filesResult = await supabaseClient.storage.from('verification_selfies').list(userId);
        if (filesResult.data && filesResult.data.length > 0) {
            var paths = filesResult.data.map(function (f) { return userId + '/' + f.name; });
            await supabaseClient.storage.from('verification_selfies').remove(paths);
        }

        showToast('Account permanently deleted ✅', 'success');
        if (trEl) trEl.remove();
        await loadStats();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

async function handleDismissDelete(reqId, userId, trEl) {
    if (!confirm('Dismiss this delete request? The user account will be kept active.')) return;

    try {
        // Set request to cancelled
        var { error } = await supabaseClient
            .from('delete_requests')
            .update({ status: 'cancelled' })
            .eq('id', reqId);
        if (error) throw error;

        // Remove flag from profile
        await supabaseClient.from('profiles')
            .update({ delete_requested: false })
            .eq('id', userId);

        showToast('Delete request dismissed. Account retained.', 'success');
        if (trEl) trEl.remove();
        await loadStats();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

// ════════════════════════════════════════════════
// TAB 3: ALL USERS
// ════════════════════════════════════════════════
async function loadAllUsers() {
    var tbody = document.getElementById('allusers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading users…</td></tr>';

    var result = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('role', 'user')
        .order('created_at', { ascending: false });

    if (result.error) {
        showToast('Error loading users', 'error');
        return;
    }

    _allUsersCache = result.data || [];
    renderAllUsersTable(_allUsersCache);
}

function renderAllUsersTable(profiles) {
    var tbody = document.getElementById('allusers-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (profiles.length === 0) {
        var row = tbody.insertRow();
        var cell = row.insertCell();
        cell.colSpan = 5;
        cell.className = 'empty-state';
        cell.textContent = 'No users found.';
        return;
    }

    profiles.forEach(function (profile) {
        renderAllUserRow(profile, tbody);
    });
}

function renderAllUserRow(profile, tbody) {
    var tr = document.createElement('tr');

    // Email
    var emailTd = document.createElement('td');
    emailTd.textContent = profile.email || '—';
    tr.appendChild(emailTd);

    // Status badge
    var statusTd = document.createElement('td');
    var badge = document.createElement('span');
    if (profile.banned) {
        badge.className   = 'badge badge-banned';
        badge.textContent = '🚫 Banned';
    } else if (profile.is_admin_approved) {
        badge.className   = 'badge badge-approved';
        badge.textContent = '✅ Approved';
    } else {
        badge.className   = 'badge badge-pending';
        badge.textContent = '⏳ Pending';
    }
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    // Delete requested?
    var delTd = document.createElement('td');
    if (profile.delete_requested) {
        var delBadge = document.createElement('span');
        delBadge.className   = 'badge badge-delreq';
        delBadge.textContent = '🗑️ Requested';
        delTd.appendChild(delBadge);
    } else {
        delTd.textContent = '—';
        delTd.style.color = 'var(--text-muted)';
    }
    tr.appendChild(delTd);

    // Registered
    var dateTd = document.createElement('td');
    dateTd.style.fontSize = '0.8rem';
    dateTd.style.color    = 'var(--text-muted)';
    dateTd.textContent    = formatDate(profile.created_at);
    tr.appendChild(dateTd);

    // Actions
    var actionTd = document.createElement('td');

    if (profile.banned) {
        var unbanBtn = makeBtn('✓ Unban', 'btn-unban', function () {
            handleBan(profile.id, false, tr, profile);
        });
        actionTd.appendChild(unbanBtn);
    } else {
        var banBtn = makeBtn('🚫 Ban', 'btn-ban', function () {
            handleBan(profile.id, true, tr, profile);
        });
        actionTd.appendChild(banBtn);
    }

    var forceDelBtn = makeBtn('🗑️ Delete', 'btn-delete', function () {
        handleForceDelete(profile.id, tr);
    });
    actionTd.appendChild(forceDelBtn);

    tr.appendChild(actionTd);
    tbody.appendChild(tr);
}

async function handleBan(userId, isBan, trEl, profile) {
    if (!UUID_REGEX.test(userId)) { showToast('Invalid user ID', 'error'); return; }
    var action = isBan ? 'BAN' : 'UNBAN';
    if (!confirm(action + ' user: ' + (profile.email || userId) + '?')) return;

    try {
        var { error } = await supabaseClient
            .from('profiles')
            .update({ banned: isBan, is_admin_approved: !isBan ? false : undefined })
            .eq('id', userId);
        if (error) throw error;

        showToast('User ' + (isBan ? 'banned' : 'unbanned') + ' successfully.', 'success');
        // Refresh the row
        await loadAllUsers();
        await loadStats();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

async function handleForceDelete(userId, trEl) {
    if (!UUID_REGEX.test(userId)) { showToast('Invalid user ID', 'error'); return; }
    if (!confirm('⚠️ PERMANENTLY DELETE this account? This cannot be undone.')) return;

    try {
        var { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
        if (error) throw error;

        // Clean up selfies
        var filesResult = await supabaseClient.storage.from('verification_selfies').list(userId);
        if (filesResult.data && filesResult.data.length > 0) {
            var paths = filesResult.data.map(function (f) { return userId + '/' + f.name; });
            await supabaseClient.storage.from('verification_selfies').remove(paths);
        }

        // Clean up delete requests
        await supabaseClient.from('delete_requests').delete().eq('user_id', userId);

        showToast('User deleted permanently ✅', 'success');
        if (trEl) trEl.remove();
        await loadStats();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

// ========== CLIENT-SIDE SEARCH FILTER ==========
window.filterUsers = function () {
    var query = (document.getElementById('user-search').value || '').toLowerCase().trim();
    if (!query) {
        renderAllUsersTable(_allUsersCache);
        return;
    }
    var filtered = _allUsersCache.filter(function (p) {
        return p.email && p.email.toLowerCase().includes(query);
    });
    renderAllUsersTable(filtered);
};

// ========== HELPER: Make button ==========
function makeBtn(label, className, onClick) {
    var btn = document.createElement('button');
    btn.className = 'action-bt ' + className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

// ========== SELFIE MODAL ==========
var modal       = document.getElementById('img-modal');
var modalImg    = document.getElementById('modal-img');
var closeModalBtn = document.getElementById('close-modal');

function openModal(src) {
    modalImg.src = src;
    modal.classList.remove('hidden');
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', function () {
        modal.classList.add('hidden');
        modalImg.src = '';
    });
}

if (modal) {
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            modal.classList.add('hidden');
            modalImg.src = '';
        }
    });
}

// ========== USER REPORTS TAB ==========
async function loadUserReports() {
    var tbody = document.getElementById('reports-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Loading reports…</td></tr>';

    try {
        var { data: reports, error } = await supabaseClient
            .from('reports')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;
        tbody.innerHTML = '';

        if (!reports || reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">✅ No pending reports. All users are behaving!</td></tr>';
            return;
        }

        for (var i = 0; i < reports.length; i++) {
            var r = reports[i];
            var tr = document.createElement('tr');

            // Fetch emails for reporter and reported
            var [reporterRes, reportedRes] = await Promise.all([
                supabaseClient.from('profiles').select('email').eq('id', r.reporter_id).single(),
                supabaseClient.from('profiles').select('email').eq('id', r.reported_id).single()
            ]);

            tr.innerHTML = `
                <td style="font-size:0.8rem;">${reporterRes.data?.email || 'Unknown'}</td>
                <td style="font-weight:600; color:var(--danger);">${reportedRes.data?.email || 'Unknown'}</td>
                <td><span class="badge badge-delreq">${r.reason}</span></td>
                <td style="font-size:0.75rem; color:var(--text-muted);">${new Date(r.created_at).toLocaleString()}</td>
                <td>
                    <button class="action-bt btn-ban" onclick="handleReportAction('${r.id}', '${r.reported_id}', 'ban')">🚫 Ban</button>
                    <button class="action-bt btn-dismiss" onclick="handleReportAction('${r.id}', null, 'dismiss')">✕ Dismiss</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    } catch (err) {
        console.error('Reports error:', err);
        showToast('Failed to load reports', 'error');
    }
}

async function handleReportAction(reportId, userId, action) {
    if (!confirm('Are you sure you want to ' + action + '?')) return;

    try {
        if (action === 'ban') {
            await supabaseClient.from('profiles').update({ banned: true, is_admin_approved: false }).eq('id', userId);
            await supabaseClient.from('reports').update({ status: 'actioned' }).eq('id', reportId);
            showToast('User Banned & Report Actioned', 'success');
        } else {
            await supabaseClient.from('reports').update({ status: 'dismissed' }).eq('id', reportId);
            showToast('Report Dismissed', 'info');
        }
        loadUserReports();
        loadStats();
    } catch (err) {
        showToast('Action failed', 'error');
    }
}

// ========== BROADCAST TOOL ==========
var broadcastBtn = document.getElementById('broadcast-btn');
var broadcastMsg = document.getElementById('broadcast-msg');

if (broadcastBtn) {
    broadcastBtn.addEventListener('click', function() {
        if (!msg) return;

        if (socket) {
            socket.emit('admin-broadcast', { message: msg, type: 'info' });
            showToast('Announcement broadcasted to all users!', 'success');
            broadcastMsg.value = '';
        } else {
            showToast('Socket connection offline. Cannot broadcast.', 'error');
        }
    });
}

// ========== LIVE STATS SOCKET ==========
if (socket) {
    socket.on('live-stats-data', function(data) {
        if (!data) return;
        
        var elOnline = document.getElementById('stat-online');
        var elActive = document.getElementById('stat-active-calls');
        var elWaiting = document.getElementById('stat-waiting');

        if (elOnline)  elOnline.textContent  = data.online || 0;
        if (elActive)  elActive.textContent  = data.activeCalls || 0;
        if (elWaiting) elWaiting.textContent = data.waiting || 0;
    });
}


// Periodic stats request
setInterval(function() {
    if (socket) socket.emit('get-live-stats');
}, 5000);


// ========== LOGOUT ==========
document.getElementById('logout-btn').addEventListener('click', async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'adlg.html';
});

// ========== INITIALIZE ==========
checkAdmin();
