/* =============================================
   SleekConnect — Agent Dashboard (Security Hardened)
   XSS-safe DOM | No token in URL
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

const tableBody = document.getElementById('user-table-body');
const modal = document.getElementById('img-modal');
const modalImg = document.getElementById('modal-img');
const closeModalBtn = document.getElementById('close-modal');

// ========== TOAST ==========
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
    }, 3000);
}

// ========== AGENT ACCESS VERIFICATION ==========
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
        setTimeout(function() { window.location.href = 'adlg.html'; }, 2000);
    } else {
        loadDashboard();
    }
}

// ========== LOAD DASHBOARD ==========
async function loadDashboard() {
    // Load stats
    await loadStats();
    // Load pending users
    await loadPendingUsers();
}

// ========== STATS ==========
async function loadStats() {
    try {
        var allResult = await supabaseClient.from('profiles').select('id, is_admin_approved, role');
        var profiles = allResult.data || [];
        
        var total = profiles.filter(function(p) { return p.role === 'user'; }).length;
        var pending = profiles.filter(function(p) { return p.role === 'user' && !p.is_admin_approved; }).length;
        var approved = profiles.filter(function(p) { return p.role === 'user' && p.is_admin_approved; }).length;

        var statPending = document.getElementById('stat-pending');
        var statApproved = document.getElementById('stat-approved');
        var statTotal = document.getElementById('stat-total');
        
        if (statPending) statPending.textContent = pending;
        if (statApproved) statApproved.textContent = approved;
        if (statTotal) statTotal.textContent = total;
    } catch (err) {
        console.error('Stats error:', err);
    }
}

// ========== LOAD PENDING USERS (XSS-Safe) ==========
async function loadPendingUsers() {
    var result = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('is_admin_approved', false)
        .eq('role', 'user');

    if (result.error) {
        console.error(result.error);
        showToast('Error loading users', 'error');
        return;
    }

    var profiles = result.data || [];
    tableBody.innerHTML = '';

    if (profiles.length === 0) {
        var emptyRow = document.createElement('tr');
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 3;
        emptyCell.className = 'empty-state';
        emptyCell.textContent = 'No pending requests! All clear ✅';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
        return;
    }

    for (var i = 0; i < profiles.length; i++) {
        var p = profiles[i];
        await renderUserRow(p);
    }
}

async function renderUserRow(profile) {
    // Fetch selfie
    var filesResult = await supabaseClient.storage.from('verification_selfies').list(profile.id);
    var files = filesResult.data;

    var imgUrl = '';
    var fileName = '';
    if (files && files.length > 0) {
        fileName = profile.id + '/' + files[0].name;
        var urlResult = supabaseClient.storage.from('verification_selfies').getPublicUrl(fileName);
        imgUrl = urlResult.data.publicUrl;
    }

    var tr = document.createElement('tr');

    // Email cell (XSS safe — using textContent)
    var emailTd = document.createElement('td');
    emailTd.textContent = profile.email;
    tr.appendChild(emailTd);

    // Selfie cell
    var selfieTd = document.createElement('td');
    if (imgUrl) {
        var img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'Identity selfie';
        img.className = 'selfie-thumb';
        img.addEventListener('click', function(url) {
            return function() { openModal(url); };
        }(imgUrl));
        selfieTd.appendChild(img);
    } else {
        var noImg = document.createElement('span');
        noImg.style.color = 'var(--text-muted)';
        noImg.textContent = 'No Image';
        selfieTd.appendChild(noImg);
    }
    tr.appendChild(selfieTd);

    // Actions cell
    var actionTd = document.createElement('td');

    var approveBtn = document.createElement('button');
    approveBtn.className = 'action-bt btn-approve';
    approveBtn.textContent = '✓ Approve';
    approveBtn.addEventListener('click', function(id, path) {
        return function() { handleAction(id, path, true); };
    }(profile.id, fileName));

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'action-bt btn-reject';
    rejectBtn.textContent = '✕ Reject';
    rejectBtn.addEventListener('click', function(id, path) {
        return function() { handleAction(id, path, false); };
    }(profile.id, fileName));

    actionTd.appendChild(approveBtn);
    actionTd.appendChild(rejectBtn);
    tr.appendChild(actionTd);

    tableBody.appendChild(tr);
}

// ========== HANDLE APPROVE / REJECT ==========
async function handleAction(userId, imagePath, isApprove) {
    // Validate UUID format
    var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
        showToast('Invalid user ID format.', 'error');
        return;
    }

    var action = isApprove ? 'APPROVE' : 'REJECT';
    if (!confirm('Are you sure you want to ' + action + ' this user?')) return;

    try {
        if (isApprove) {
            var updateResult = await supabaseClient
                .from('profiles')
                .update({ is_admin_approved: true })
                .eq('id', userId);

            if (updateResult.error) throw updateResult.error;
            showToast('User Approved Successfully', 'success');
        } else {
            var deleteResult = await supabaseClient
                .from('profiles')
                .delete()
                .eq('id', userId);

            if (deleteResult.error) throw deleteResult.error;
            showToast('User Rejected & Deleted', 'success');
        }

        // Delete selfie for privacy
        if (imagePath) {
            var storageResult = await supabaseClient.storage
                .from('verification_selfies')
                .remove([imagePath]);
            if (storageResult.error) {
                console.error('Failed to delete image:', storageResult.error);
            } else {
                showToast('Verification Image Deleted.', 'info');
            }
        }

        // Refresh
        await loadDashboard();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

// ========== MODAL ==========
function openModal(src) {
    modalImg.src = src;
    modal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', function() {
    modal.classList.add('hidden');
    modalImg.src = '';
});

modal.addEventListener('click', function(e) {
    if (e.target === modal) {
        modal.classList.add('hidden');
        modalImg.src = '';
    }
});

// ========== LOGOUT ==========
document.getElementById('logout-btn').addEventListener('click', async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'adlg.html';
});

// ========== INITIALIZE ==========
checkAdmin();
