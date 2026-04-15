/* =============================================
   SleekConnect — Registration (Security Hardened)
   Age Verification + Password Strength + Camera
   ============================================= */
const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const preview = document.getElementById('selfie-preview');
const startBtn = document.getElementById('start-cam-btn');
const captureBtn = document.getElementById('capture-btn');
const retakeBtn = document.getElementById('retake-btn');
const registerBtn = document.getElementById('register-btn');
const registerForm = document.getElementById('register-form');
const passwordInput = document.getElementById('reg-password');
const strengthBar = document.getElementById('password-strength');
const strengthText = document.getElementById('password-text');

// Age inputs
const dobDay = document.getElementById('dob-day');
const dobMonth = document.getElementById('dob-month');
const dobYear = document.getElementById('dob-year');
const ageError = document.getElementById('age-error');
const ageSuccess = document.getElementById('age-success');

let stream = null;
let capturedBlob = null;
let isAgeValid = false;

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
    }, 4000);
}

// ========== AGE VERIFICATION ==========
function populateDOBSelectors() {
    // Days
    for (var d = 1; d <= 31; d++) {
        var opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        dobDay.appendChild(opt);
    }
    // Months
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    for (var m = 0; m < months.length; m++) {
        var opt = document.createElement('option');
        opt.value = m + 1;
        opt.textContent = months[m];
        dobMonth.appendChild(opt);
    }
    // Years (current year - 100 to current year - 18)
    var currentYear = new Date().getFullYear();
    for (var y = currentYear - 18; y >= currentYear - 100; y--) {
        var opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        dobYear.appendChild(opt);
    }
}

function validateAge() {
    var day = parseInt(dobDay.value);
    var month = parseInt(dobMonth.value);
    var year = parseInt(dobYear.value);

    if (!day || !month || !year) {
        isAgeValid = false;
        ageError.classList.remove('show');
        ageSuccess.classList.add('hidden');
        updateRegisterButton();
        return;
    }

    var dob = new Date(year, month - 1, day);
    var today = new Date();
    var age = today.getFullYear() - dob.getFullYear();
    var monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }

    if (age < 18) {
        isAgeValid = false;
        ageError.classList.add('show');
        ageSuccess.classList.add('hidden');
    } else {
        isAgeValid = true;
        ageError.classList.remove('show');
        ageSuccess.classList.remove('hidden');
    }

    updateRegisterButton();
}

dobDay.addEventListener('change', validateAge);
dobMonth.addEventListener('change', validateAge);
dobYear.addEventListener('change', validateAge);

// ========== PASSWORD STRENGTH ==========
function checkPasswordStrength(pw) {
    var score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
}

passwordInput.addEventListener('input', function() {
    var pw = passwordInput.value;
    var score = checkPasswordStrength(pw);

    strengthBar.className = 'password-strength';
    if (pw.length === 0) {
        strengthText.textContent = '';
        return;
    }

    if (score <= 1) {
        strengthBar.classList.add('strength-weak');
        strengthText.textContent = 'Weak — add uppercase, numbers, symbols';
        strengthText.style.color = 'var(--danger)';
    } else if (score <= 2) {
        strengthBar.classList.add('strength-medium');
        strengthText.textContent = 'Medium — almost there';
        strengthText.style.color = 'var(--warning)';
    } else {
        strengthBar.classList.add('strength-strong');
        strengthText.textContent = 'Strong password ✓';
        strengthText.style.color = 'var(--success)';
    }
});

// ========== CAMERA ==========
// Auto-start camera on page load
window.addEventListener('DOMContentLoaded', function() {
    populateDOBSelectors();
    startCamera();
});

async function startCamera() {
    try {
        if (stream) {
            stream.getTracks().forEach(function(t) { t.stop(); });
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });

        video.srcObject = stream;
        video.onloadedmetadata = function() {
            video.play();
            video.classList.remove('hidden');
            preview.classList.add('hidden');
            var overlay = document.getElementById('cam-overlay');
            if (overlay) overlay.classList.add('hidden');
            var cameraBox = document.getElementById('camera-box');
            if (cameraBox) cameraBox.classList.add('active');

            startBtn.classList.add('hidden');
            captureBtn.classList.remove('hidden');
            retakeBtn.classList.add('hidden');
        };
    } catch (err) {
        console.error('Camera Error:', err);
        showToast('Camera access denied! Please allow camera for identity check.', 'error');
        startBtn.classList.remove('hidden');
        captureBtn.classList.add('hidden');
    }
}

startBtn.addEventListener('click', startCamera);

captureBtn.addEventListener('click', function() {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        showToast('Camera is warming up… try again in a second.', 'info');
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(function(blob) {
        capturedBlob = blob;
        preview.src = URL.createObjectURL(blob);
        preview.classList.remove('hidden');
        video.classList.add('hidden');

        captureBtn.classList.add('hidden');
        retakeBtn.classList.remove('hidden');

        var cameraBox = document.getElementById('camera-box');
        if (cameraBox) cameraBox.classList.remove('active');

        updateRegisterButton();
    }, 'image/jpeg', 0.8);

    if (stream) {
        stream.getTracks().forEach(function(t) { t.stop(); });
    }
});

retakeBtn.addEventListener('click', function() {
    capturedBlob = null;
    updateRegisterButton();
    startCamera();
});

// ========== REGISTER BUTTON STATE ==========
function updateRegisterButton() {
    if (capturedBlob && isAgeValid) {
        registerBtn.disabled = false;
        registerBtn.classList.remove('disabled-btn');
    } else {
        registerBtn.disabled = true;
        registerBtn.classList.add('disabled-btn');
    }
}

// ========== FORM SUBMIT ==========
registerForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!capturedBlob) {
        showToast('Please capture a live selfie first.', 'error');
        return;
    }

    if (!isAgeValid) {
        showToast('You must be 18 or older to register.', 'error');
        return;
    }

    var email = document.getElementById('reg-email').value.trim();
    var password = document.getElementById('reg-password').value;

    // Password validation
    if (password.length < 8) {
        showToast('Password must be at least 8 characters.', 'error');
        return;
    }

    if (checkPasswordStrength(password) < 2) {
        showToast('Password too weak. Add uppercase letters and numbers.', 'error');
        return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Processing Application…';

    try {
        var result = await supabaseClient.auth.signUp({
            email: email,
            password: password
        });

        if (result.error) throw result.error;
        if (!result.data.user) throw new Error('User may already exist or check email for verification.');

        // Upload verification selfie
        var uploadResult = await supabaseClient.storage
            .from('verification_selfies')
            .upload(result.data.user.id + '/verify.jpg', capturedBlob, {
                contentType: 'image/jpeg',
                upsert: true
            });

        if (uploadResult.error) throw uploadResult.error;

        showToast('Application submitted! Redirecting…', 'success');
        setTimeout(function() {
            window.location.href = 'waiting-room.html';
        }, 2000);
    } catch (err) {
        showToast(err.message, 'error');
        registerBtn.disabled = false;
        registerBtn.textContent = 'Request Access';
    }
});
