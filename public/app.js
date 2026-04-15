/* =============================================
   SleekConnect — Video Chat App (Security Hardened)
   ============================================= */
const supabaseUrl = 'https://onwaakkxvnbmbdmwzegg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ud2Fha2t4dm5ibWJkbXd6ZWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNjc0NTYsImV4cCI6MjA5MTY0MzQ1Nn0.QEUmMP9RBuhiEVRaQoSaZWAqOlXtFj5TV23YyAnH8EQ';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

const socket = io();

// DOM
const userStatus = document.getElementById('user-status');
const startPanel = document.getElementById('start-panel');
const videoContainer = document.getElementById('video-container');
const findPartnerBtn = document.getElementById('find-partner-btn');
const queueStatus = document.getElementById('queue-status');

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const remoteLabel = document.querySelector('.remote-label');
const strangerLeftMsg = document.getElementById('stranger-left-msg');

const nextBtn = document.getElementById('next-btn');
const stopBtn = document.getElementById('stop-btn');
const muteBtn = document.getElementById('mute-btn');
const videoOffBtn = document.getElementById('video-off-btn');

let currentUser = null;
let currentRoomId = null;
let peerConnection;
let localStream;
let remoteStream;
let isSearching = false;

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
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
    setTimeout(function() {
        toast.style.animation = 'toastSlideOut 0.3s forwards';
        setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
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

        // Check if approved in DB
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

// ========== OMEGLE SEARCH ==========
findPartnerBtn.addEventListener('click', async function() {
    isSearching = true;
    startPanel.classList.add('hidden');
    videoContainer.classList.remove('hidden');
    strangerLeftMsg.classList.add('hidden');

    try {
        if (!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            localVideo.srcObject = localStream;
        }

        remoteVideo.srcObject = null;
        remoteLabel.textContent = 'Waiting for partner…';

        socket.emit('find-partner', currentUser);
    } catch (e) {
        showToast('Camera access required', 'error');
        stopMatchmaking();
    }
});

socket.on('waiting', function() {
    remoteLabel.textContent = 'Waiting for a stranger…';
    queueStatus.classList.remove('hidden');
});

socket.on('partner-found', async function(data) {
    currentRoomId = data.roomId;
    remoteLabel.textContent = 'Connecting to stranger…';
    strangerLeftMsg.classList.add('hidden');
    queueStatus.classList.add('hidden');

    peerConnection = createPeerConnection(currentRoomId);
    localStream.getTracks().forEach(function(track) {
        peerConnection.addTrack(track, localStream);
    });

    if (data.role === 'initiator') {
        var offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            roomId: currentRoomId,
            sdp: peerConnection.localDescription
        });
    }
});

socket.on('stranger-left', function() {
    remoteVideo.srcObject = null;
    strangerLeftMsg.classList.remove('hidden');
    remoteLabel.textContent = 'Disconnected';
    cleanupCall();
});

// ========== WEBRTC SIGNALING ==========
socket.on('offer', async function(data) {
    try {
        if (!peerConnection) {
            peerConnection = createPeerConnection(currentRoomId);
            localStream.getTracks().forEach(function(track) {
                peerConnection.addTrack(track, localStream);
            });
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        var answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            roomId: currentRoomId,
            sdp: peerConnection.localDescription
        });
    } catch (e) {
        console.error('Offer handling error:', e);
    }
});

socket.on('answer', async function(data) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (e) {
        console.error('Answer handling error:', e);
    }
});

socket.on('ice-candidate', async function(data) {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (e) {
        console.error('ICE candidate error:', e);
    }
});

function createPeerConnection(roomId) {
    var pc = new RTCPeerConnection(servers);

    pc.onicecandidate = function(event) {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId: roomId,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = function(event) {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
            remoteLabel.textContent = 'Chatting with Stranger';
            strangerLeftMsg.classList.add('hidden');
        }
        remoteStream.addTrack(event.track);
    };

    pc.oniceconnectionstatechange = function() {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            remoteLabel.textContent = 'Connection lost';
        }
    };

    return pc;
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteStream = null;
}

function stopMatchmaking() {
    isSearching = false;
    currentRoomId = null;
    cleanupCall();
    if (localStream) {
        localStream.getTracks().forEach(function(t) { t.stop(); });
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    queueStatus.classList.add('hidden');

    videoContainer.classList.add('hidden');
    startPanel.classList.remove('hidden');
    socket.emit('leave-partner');
}

// ========== CONTROLS ==========
nextBtn.addEventListener('click', function() {
    socket.emit('leave-partner');
    cleanupCall();
    remoteLabel.textContent = 'Skipping… finding next partner';
    remoteVideo.srcObject = null;
    strangerLeftMsg.classList.add('hidden');
    socket.emit('find-partner', currentUser);
});

stopBtn.addEventListener('click', stopMatchmaking);

muteBtn.addEventListener('click', function() {
    if (!localStream) return;
    var audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.classList.toggle('muted', !audioTrack.enabled);
    muteBtn.textContent = audioTrack.enabled ? '🎤' : '🔇';
});

videoOffBtn.addEventListener('click', function() {
    if (!localStream) return;
    var videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    videoOffBtn.classList.toggle('muted', !videoTrack.enabled);
    videoOffBtn.textContent = videoTrack.enabled ? '📷' : '🚫';
});

// ========== LOGOUT ==========
document.getElementById('logout-btn').addEventListener('click', async function() {
    stopMatchmaking();
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
});

// ========== INIT ==========
verifyAccess();
