const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// =============================================
// SECURITY HEADERS MIDDLEWARE
// =============================================
app.use(function(req, res, next) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Referrer policy — don't leak URLs
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // XSS Protection (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Permissions Policy — restrict browser features
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');

    // Content Security Policy
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' https://cdn.jsdelivr.net https://pagead2.googlesyndication.com https://www.googletagmanager.com 'unsafe-inline'",
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' https://onwaakkxvnbmbdmwzegg.supabase.co data: blob:",
        "connect-src 'self' https://onwaakkxvnbmbdmwzegg.supabase.co wss://onwaakkxvnbmbdmwzegg.supabase.co https://pagead2.googlesyndication.com",
        "media-src 'self' blob:",
        "frame-src https://pagead2.googlesyndication.com https://tpc.googlesyndication.com"
    ].join('; '));

    next();
});

// Block admin, password reset, and account-settings from being indexed
app.use(function(req, res, next) {
    if (
        req.path.startsWith('/adlg') ||
        req.path.startsWith('/adtg') ||
        req.path.startsWith('/forgot-password') ||
        req.path.startsWith('/reset-password') ||
        req.path.startsWith('/account-settings')
    ) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    next();
});

// Serve static files
app.use(express.static('public'));

// robots.txt — allow public pages, block admin & sensitive
app.get('/robots.txt', function(req, res) {
    res.type('text/plain');
    res.send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /adlg.html',
        'Disallow: /adtg.html',
        'Disallow: /forgot-password.html',
        'Disallow: /reset-password.html',
        '',
        'Sitemap: https://sleekconnect.com/sitemap.xml'
    ].join('\n'));
});

// =============================================
// SOCKET.IO
// =============================================
const io = new Server(server, {
    cors: {
        origin: function(origin, callback) {
            // Allow same-origin and common dev origins
            var allowed = [
                'http://localhost:3000',
                'http://127.0.0.1:3000',
                'https://sleekconnect.onrender.com'
            ];
            if (!origin || allowed.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.warn('Blocked CORS from:', origin);
                callback(new Error('Not allowed by CORS'));
            }
        }
    },
    // Rate-limit connection attempts
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000
    }
});

// Socket.IO rate limiter — simple in-memory tracker
var socketRateLimit = {};
var SOCKET_RATE_WINDOW = 10000; // 10 seconds
var SOCKET_MAX_EVENTS = 30; // max events per window

function checkSocketRate(socketId) {
    var now = Date.now();
    if (!socketRateLimit[socketId]) {
        socketRateLimit[socketId] = { count: 0, windowStart: now };
    }
    var entry = socketRateLimit[socketId];
    if (now - entry.windowStart > SOCKET_RATE_WINDOW) {
        entry.count = 0;
        entry.windowStart = now;
    }
    entry.count++;
    return entry.count <= SOCKET_MAX_EVENTS;
}

// UUID validation
function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

let waitingQueue = [];

io.on('connection', function(socket) {
    console.log('Socket connected:', socket.id);

    socket.on('find-partner', function(userId) {
        // Rate limit
        if (!checkSocketRate(socket.id)) {
            socket.emit('error', { message: 'Rate limit exceeded' });
            return;
        }
        // Validate userId
        if (userId && !isValidUUID(userId)) {
            socket.emit('error', { message: 'Invalid user ID' });
            return;
        }

        // Remove from queue if already there
        waitingQueue = waitingQueue.filter(function(u) { return u.socketId !== socket.id; });

        if (waitingQueue.length > 0) {
            var partner = waitingQueue.shift();
            var roomId = 'room_' + socket.id + '_' + partner.socketId;

            socket.join(roomId);
            var partnerSocket = io.sockets.sockets.get(partner.socketId);
            if (partnerSocket) partnerSocket.join(roomId);

            socket.emit('partner-found', { roomId: roomId, role: 'initiator' });
            io.to(partner.socketId).emit('partner-found', { roomId: roomId, role: 'receiver' });

            console.log('Matched ' + socket.id + ' with ' + partner.socketId);
        } else {
            waitingQueue.push({ socketId: socket.id, userId: userId });
            socket.emit('waiting');
            console.log('User ' + socket.id + ' waiting. Queue: ' + waitingQueue.length);
        }
    });

    // WebRTC Signaling
    socket.on('offer', function(data) {
        if (!checkSocketRate(socket.id)) return;
        if (data && data.roomId && data.sdp) {
            socket.to(data.roomId).emit('offer', { sender: socket.id, sdp: data.sdp });
        }
    });

    socket.on('answer', function(data) {
        if (!checkSocketRate(socket.id)) return;
        if (data && data.roomId && data.sdp) {
            socket.to(data.roomId).emit('answer', { sender: socket.id, sdp: data.sdp });
        }
    });

    socket.on('ice-candidate', function(data) {
        if (!checkSocketRate(socket.id)) return;
        if (data && data.roomId && data.candidate) {
            socket.to(data.roomId).emit('ice-candidate', { sender: socket.id, candidate: data.candidate });
        }
    });

    // Disconnection
    var handleDisconnection = function() {
        waitingQueue = waitingQueue.filter(function(u) { return u.socketId !== socket.id; });

        var rooms = Array.from(socket.rooms);
        rooms.forEach(function(roomId) {
            if (roomId !== socket.id) {
                socket.to(roomId).emit('stranger-left');
                socket.leave(roomId);
            }
        });
    };

    socket.on('leave-partner', function() {
        if (!checkSocketRate(socket.id)) return;
        handleDisconnection();
    });

    socket.on('disconnect', function() {
        console.log('Disconnected:', socket.id);
        delete socketRateLimit[socket.id];
        handleDisconnection();
    });
});

// Cleanup stale rate limit entries every 5 minutes
setInterval(function() {
    var now = Date.now();
    Object.keys(socketRateLimit).forEach(function(key) {
        if (now - socketRateLimit[key].windowStart > 60000) {
            delete socketRateLimit[key];
        }
    });
}, 300000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() {
    console.log('SleekConnect Server running on http://localhost:' + PORT);
});
