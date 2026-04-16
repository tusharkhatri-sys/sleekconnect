/* =============================================
   SleekConnect — Video Chat App (Security Hardened + TURN Fixed)
   =============================================
   Fixes applied:
   1. Added TURN servers (required for mobile-to-mobile on 4G/5G)
   2. Fixed remoteStream not resetting on skip/next
   3. Fixed queueStatus element reference (was trying to hide start-panel's element while inside video container)
   4. Added iceConnectionState reconnection handling
   5. Added explicit remoteVideo.play() for iOS autoplay policy
   6. Added connection timeout — if ICE takes > 15s, auto retry
   ============================================= */

const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

const socket = io();

// Listen for admin broadcasts
socket.on('broadcast-receive', function(data) {
    if (data && data.message) {
        showToast('📣 ADMIN: ' + data.message, data.type || 'info');
    }
});


// DOM
const userStatus        = document.getElementById('user-status');
const startPanel        = document.getElementById('start-panel');
const videoContainer    = document.getElementById('video-container');
const findPartnerBtn    = document.getElementById('find-partner-btn');
const queueStatus       = document.getElementById('queue-status');   // inside start-panel — searching text
const remoteLabel       = document.getElementById('remote-label');   // inside video-container
const strangerLeftMsg   = document.getElementById('stranger-left-msg');

const localVideo  = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');

const nextBtn     = document.getElementById('next-btn');
const stopBtn     = document.getElementById('stop-btn');
const muteBtn     = document.getElementById('mute-btn');
const videoOffBtn = document.getElementById('video-off-btn');
const reportBtn   = document.getElementById('report-btn');
const reportModal = document.getElementById('report-modal');
const closeReportModal = document.getElementById('close-report-modal');
const reportOptions = document.querySelectorAll('.report-opt');


let currentUser   = null;
let currentRoomId = null;
let peerConnection;
let localStream;
let remoteStream;
let isSearching   = false;
let currentPartnerId = null;  // Track who we are talking to
let iceTimeout    = null;     // connection watchdog timer


/* ═══════════════════════════════════════════════════
   ICE SERVER CONFIG
   - STUN: works on WiFi/same ISP
   - TURN: required for mobile 4G/5G (symmetric NAT)

   ↓↓↓  IMPORTANT — Replace with your own TURN server  ↓↓↓
   Free options:
     • Metered.ca  → https://dashboard.metered.ca/signup (free 50GB/mo)
     • Cloudflare Calls TURN
     • Twilio NTS (paid but reliable)
   
   For quick testing use the open relay below (not for production):
   ═══════════════════════════════════════════════════ */
const ICE_SERVERS = {
    iceServers: [
        // Google STUN — works on WiFi & same-network
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
                'stun:stun3.l.google.com:19302',
                'stun:stun4.l.google.com:19302'
            ]
        },
        // Metered Open Relay TURN — required for mobile 4G/5G symmetric NAT
        // Source: https://www.metered.ca/tools/openrelay/
        {
            urls: 'stun:staticauth.openrelay.metered.ca:80'
        },
        {
            urls:       'turn:staticauth.openrelay.metered.ca:80',
            username:   'openrelayproject',
            credential: 'openrelayprojectsecret'
        },
        {
            urls:       'turn:staticauth.openrelay.metered.ca:443',
            username:   'openrelayproject',
            credential: 'openrelayprojectsecret'
        },
        {
            urls:       'turns:staticauth.openrelay.metered.ca:443',
            username:   'openrelayproject',
            credential: 'openrelayprojectsecret'
        }
    ],
    iceCandidatePoolSize: 10
};

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
    setTimeout(function () {
        toast.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
}

// ========== SET REMOTE STATUS LABEL ==========
function setRemoteLabel(text) {
    if (remoteLabel) remoteLabel.textContent = text;
}

// ========== VERIFY ACCESS ==========
async function verifyAccess() {
    try {
        var userResult = await supabaseClient.auth.getUser();
        var user = userResult.data ? userResult.data.user : null;

        if (!user) {
            window.location.href = 'index.html';
            return;
        }

        var profileResult = await supabaseClient
            .from('profiles')
            .select('is_admin_approved')
            .eq('id', user.id)
            .single();

        var profile = profileResult.data;

        if (!profile || !profile.is_admin_approved) {
            window.location.href = 'waiting-room.html';
            return;
        }

        currentUser = user.id;
        if (userStatus) userStatus.textContent = 'Verified Identity ✅';
    } catch (err) {
        console.error('Access verification failed:', err);
        window.location.href = 'index.html';
    }
}

// ========== GET CAMERA ==========
async function ensureLocalStream() {
    if (localStream) return true;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: { echoCancellation: true, noiseSuppression: true }
        });
        localVideo.srcObject = localStream;

        // iOS requires explicit play() call
        try { await localVideo.play(); } catch (_) {}
        return true;
    } catch (e) {
        console.error('Camera error:', e);
        showToast('Camera/mic access required. Please allow permissions.', 'error');
        return false;
    }
}

// ========== FIND PARTNER — Main button ==========
findPartnerBtn.addEventListener('click', async function () {
    var ok = await ensureLocalStream();
    if (!ok) return;

    isSearching = true;

    // Hide start panel — show video container with loading state
    startPanel.classList.add('hidden');
    videoContainer.classList.remove('hidden');
    strangerLeftMsg.classList.add('hidden');
    setRemoteLabel('🔍 Searching for a verified user…');

    // Show searching pulse on the queue label (start-panel, now hidden but still controls text)
    if (queueStatus) queueStatus.classList.remove('hidden');

    // Clean up any previous connection
    cleanupCall();
    remoteVideo.srcObject = null;

    socket.emit('find-partner', currentUser);
});

// ========== SOCKET — waiting in queue ==========
socket.on('waiting', function () {
    setRemoteLabel('🔍 Searching for a verified user…');
    if (queueStatus) queueStatus.classList.remove('hidden');
    console.log('[Socket] Waiting in queue');
});

// ========== SOCKET — partner found ==========
socket.on('partner-found', async function (data) {
    console.log('[Socket] Partner Found:', data);
    currentRoomId = data.roomId;
    currentPartnerId = data.partnerId; // ID for reporting system
    isSearching = false;

    // Show report button now that we have a partner
    if (reportBtn) reportBtn.classList.remove('hidden');

    if (queueStatus) queueStatus.classList.add('hidden');
    setRemoteLabel('⚡ Establishing secure P2P connection…');

    strangerLeftMsg.classList.add('hidden');

    // Ensure we have local stream (edge case: fast reconnect)
    var ok = await ensureLocalStream();
    if (!ok) return;

    // Build peer connection
    peerConnection = createPeerConnection(currentRoomId);

    // Add all local tracks
    localStream.getTracks().forEach(function (track) {
        peerConnection.addTrack(track, localStream);
    });

    // Start ICE connection watchdog (15 second timeout)
    clearTimeout(iceTimeout);
    iceTimeout = setTimeout(function () {
        if (peerConnection && peerConnection.iceConnectionState !== 'connected' &&
            peerConnection.iceConnectionState !== 'completed') {
            console.warn('[ICE] Connection timeout — retrying');
            showToast('Connection taking too long. Retrying…', 'info');
            doSkip();
        }
    }, 15000);

    if (data.role === 'initiator') {
        try {
            var offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', {
                roomId: currentRoomId,
                sdp:    peerConnection.localDescription
            });
            console.log('[WebRTC] Offer sent');
        } catch (e) {
            console.error('[WebRTC] createOffer error:', e);
        }
    }
});

// ========== SOCKET — stranger left ==========
socket.on('stranger-left', function () {
    console.log('[Socket] Stranger left');
    clearTimeout(iceTimeout);
    remoteVideo.srcObject = null;
    strangerLeftMsg.classList.remove('hidden');
    setRemoteLabel('Disconnected');
    cleanupCall();
});

// ========== WEBRTC SIGNALING — offer received ==========
socket.on('offer', async function (data) {
    console.log('[WebRTC] Offer received');
    try {
        if (!peerConnection) {
            // Receiver path: build pc when offer arrives
            peerConnection = createPeerConnection(currentRoomId);
            var ok = await ensureLocalStream();
            if (!ok) return;
            localStream.getTracks().forEach(function (track) {
                peerConnection.addTrack(track, localStream);
            });
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        var answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            roomId: currentRoomId,
            sdp:    peerConnection.localDescription
        });
        console.log('[WebRTC] Answer sent');
    } catch (e) {
        console.error('[WebRTC] Offer handling error:', e);
    }
});

// ========== WEBRTC SIGNALING — answer received ==========
socket.on('answer', async function (data) {
    console.log('[WebRTC] Answer received');
    try {
        if (peerConnection && peerConnection.signalingState !== 'stable') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
    } catch (e) {
        console.error('[WebRTC] Answer handling error:', e);
    }
});

// ========== WEBRTC SIGNALING — ICE candidates ==========
socket.on('ice-candidate', async function (data) {
    try {
        if (peerConnection && data.candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (e) {
        // Non-fatal — candidates often arrive out of order
        console.warn('[ICE] addIceCandidate warning:', e.message);
    }
});

// ========== CREATE PEER CONNECTION ==========
function createPeerConnection(roomId) {
    var pc = new RTCPeerConnection(ICE_SERVERS);

    // Send ICE candidates to signaling server
    pc.onicecandidate = function (event) {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId:    roomId,
                candidate: event.candidate
            });
        }
    };

    // Log ICE gathering state
    pc.onicegatheringstatechange = function () {
        console.log('[ICE] Gathering state:', pc.iceGatheringState);
    };

    // Handle incoming remote tracks
    pc.ontrack = function (event) {
        console.log('[WebRTC] Remote track received:', event.track.kind);
        clearTimeout(iceTimeout);      // Clear watchdog — we have video/audio

        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }

        remoteStream.addTrack(event.track);

        // iOS/Safari require explicit play() on video elements
        if (event.track.kind === 'video') {
            remoteVideo.play().catch(function (e) {
                console.warn('[Video] play() failed (autoplay policy):', e.message);
            });
            setRemoteLabel('💬 Chatting with Stranger');
            strangerLeftMsg.classList.add('hidden');
        }
    };

    // Monitor ICE connection state
    pc.oniceconnectionstatechange = function () {
        console.log('[ICE] Connection state:', pc.iceConnectionState);
        switch (pc.iceConnectionState) {
            case 'connected':
            case 'completed':
                clearTimeout(iceTimeout);
                setRemoteLabel('💬 Chatting with Stranger');
                break;
            case 'disconnected':
                setRemoteLabel('⚠️ Connection unstable…');
                break;
            case 'failed':
                clearTimeout(iceTimeout);
                showToast('Connection failed. Try skipping to next user.', 'error');
                setRemoteLabel('❌ Connection failed');
                break;
            case 'closed':
                setRemoteLabel('Disconnected');
                break;
        }
    };

    // Log signaling state
    pc.onsignalingstatechange = function () {
        console.log('[WebRTC] Signaling state:', pc.signalingState);
    };

    return pc;
}

// ========== CLEANUP ==========
function cleanupCall() {
    clearTimeout(iceTimeout);
    if (peerConnection) {
        peerConnection.onicecandidate    = null;
        peerConnection.ontrack           = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.close();
        peerConnection = null;
    }
    remoteStream = null;     // ← This was the bug: must reset so next partner works
}

function doSkip() {
    socket.emit('leave-partner');
    cleanupCall();
    remoteVideo.srcObject = null;
    strangerLeftMsg.classList.add('hidden');
    setRemoteLabel('🔍 Searching for a verified user…');
    if (queueStatus) queueStatus.classList.remove('hidden');
    socket.emit('find-partner', currentUser);
}

function stopMatchmaking() {
    isSearching = false;
    currentRoomId = null;
    cleanupCall();

    if (localStream) {
        localStream.getTracks().forEach(function (t) { t.stop(); });
        localStream = null;
    }
    localVideo.srcObject  = null;
    remoteVideo.srcObject = null;

    if (queueStatus) queueStatus.classList.add('hidden');

    videoContainer.classList.add('hidden');
    startPanel.classList.remove('hidden');
    socket.emit('leave-partner');
}

// ========== CONTROLS ==========
nextBtn.addEventListener('click', doSkip);
stopBtn.addEventListener('click', stopMatchmaking);

muteBtn.addEventListener('click', function () {
    if (!localStream) return;
    var audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.classList.toggle('muted', !audioTrack.enabled);
    muteBtn.textContent = audioTrack.enabled ? '🎤' : '🔇';
});

videoOffBtn.addEventListener('click', function () {
    if (!localStream) return;
    var videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    videoOffBtn.classList.toggle('muted', !videoTrack.enabled);
    videoOffBtn.textContent = videoTrack.enabled ? '📷' : '🚫';
});

// ========== REPORTING LOGIC ==========
if (reportBtn) {
    reportBtn.addEventListener('click', function() {
        if (reportModal) reportModal.classList.remove('hidden');
    });
}

if (closeReportModal) {
    closeReportModal.addEventListener('click', function() {
        if (reportModal) reportModal.classList.add('hidden');
    });
}

if (reportOptions) {
    reportOptions.forEach(function(opt) {
        opt.addEventListener('click', async function() {
            var reason = opt.getAttribute('data-reason');
            if (!currentUser || !currentPartnerId || !reason) return;

            try {
                var { error } = await supabaseClient
                    .from('reports')
                    .insert({
                        reporter_id: currentUser,
                        reported_id: currentPartnerId,
                        reason: reason,
                        status: 'pending'
                    });

                if (error) throw error;

                showToast('User reported successfully. Thank you for keeping SleekConnect safe!', 'success');
                if (reportModal) reportModal.classList.add('hidden');
                
                // Automatically skip to next user after reporting
                doSkip();
            } catch (err) {
                console.error('Report failed:', err);
                showToast('Failed to submit report. Please try again.', 'error');
            }
        });
    });
}

// ========== LOGOUT ==========
document.getElementById('logout-btn').addEventListener('click', async function () {
    stopMatchmaking();
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
});

// ========== INIT ==========
verifyAccess();

