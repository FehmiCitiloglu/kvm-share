// Antigravity KVM Client Logic

// UI Elements
const connectView = document.getElementById('connect-view');
const sessionView = document.getElementById('session-view');
const serverAddressInput = document.getElementById('server-address');
const connectBtn = document.getElementById('connect-btn');
const connectionStatus = document.getElementById('connection-status');
const hudConnectionStatus = document.getElementById('hud-connection-status');
const canvas = document.getElementById('screen-canvas');
const ctx = canvas.getContext('2d');
const inputLockOverlay = document.getElementById('input-lock-overlay');

// HUD Settings Elements
const hudPanel = document.getElementById('hud-panel');
const hudToggleBtn = document.getElementById('hud-toggle-btn');
const settingScale = document.getElementById('setting-scale');
const valScale = document.getElementById('val-scale');
const settingQuality = document.getElementById('setting-quality');
const valQuality = document.getElementById('val-quality');
const toggleMouse = document.getElementById('toggle-mouse');
const toggleKeyboard = document.getElementById('toggle-keyboard');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnDisconnect = document.getElementById('btn-disconnect');

// HUD Stats Elements
const statLatency = document.getElementById('stat-latency');
const statFps = document.getElementById('stat-fps');
const statBandwidth = document.getElementById('stat-bandwidth');

// App State
let ws = null;
let connected = false;
let screenWidth = 1920;
let screenHeight = 1080;
let mouseEnabled = true;
let keyboardEnabled = true;
let isInputLocked = false;
let targetFps = 30; // Max target FPS

// Stats Tracking
let lastFrameTime = 0;
let frameCount = 0;
let fpsIntervalId = null;
let totalBytesReceived = 0;
let bandwidthIntervalId = null;
let lastFrameRequestTime = 0;

// Initialize Server Address Input from URL bar
const defaultHost = window.location.host || 'localhost:8000';
serverAddressInput.value = defaultHost;

// Event Listeners
connectBtn.addEventListener('click', connect);
btnDisconnect.addEventListener('click', disconnect);
hudToggleBtn.addEventListener('click', () => hudPanel.classList.toggle('collapsed'));

// Update scale and quality values
settingScale.addEventListener('input', (e) => {
    valScale.textContent = `${e.target.value}%`;
    sendSettings();
});

settingQuality.addEventListener('input', (e) => {
    valQuality.textContent = `${e.target.value}%`;
    sendSettings();
});

toggleMouse.addEventListener('change', (e) => {
    mouseEnabled = e.target.checked;
});

toggleKeyboard.addEventListener('change', (e) => {
    keyboardEnabled = e.target.checked;
    if (!keyboardEnabled) {
        unlockInput();
    }
});

btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        sessionView.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
});

// Lock and Unlock input overlay on canvas click
canvas.addEventListener('click', (e) => {
    if (keyboardEnabled && !isInputLocked) {
        lockInput();
    }
});

// WebSocket Connection Functions
function updateConnectionUI(status) {
    // status can be: 'disconnected', 'connecting', 'connected'
    connectionStatus.className = `status-badge ${status}`;
    hudConnectionStatus.className = `status-badge ${status}`;
    
    const textMap = {
        'disconnected': 'Disconnected',
        'connecting': 'Connecting...',
        'connected': 'Connected'
    };
    
    connectionStatus.querySelector('.status-text').textContent = textMap[status];
    hudConnectionStatus.querySelector('.status-text').textContent = textMap[status];
    
    if (status === 'connected') {
        connectView.classList.remove('active');
        sessionView.classList.add('active');
    } else if (status === 'disconnected') {
        connectView.classList.add('active');
        sessionView.classList.remove('active');
        unlockInput();
    }
}

function connect() {
    let addr = serverAddressInput.value.trim();
    if (!addr.startsWith('ws://') && !addr.startsWith('wss://')) {
        addr = 'ws://' + addr;
    }
    if (!addr.endsWith('/ws')) {
        addr = addr + '/ws';
    }
    
    updateConnectionUI('connecting');
    console.log(`Connecting to server: ${addr}`);
    
    try {
        ws = new WebSocket(addr);
    } catch (e) {
        console.error("WebSocket creation error:", e);
        updateConnectionUI('disconnected');
        alert("Failed to create WebSocket. Please check the address format.");
        return;
    }
    
    ws.binaryType = 'blob';
    
    ws.onopen = () => {
        connected = true;
        updateConnectionUI('connected');
        sendSettings();
        
        // Start statistics intervals
        startStatsTracking();
        
        // Request the first frame
        requestNextFrame();
    };
    
    ws.onclose = () => {
        connected = false;
        updateConnectionUI('disconnected');
        stopStatsTracking();
        ws = null;
    };
    
    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        connected = false;
        updateConnectionUI('disconnected');
        stopStatsTracking();
        ws = null;
    };
    
    ws.onmessage = handleWebSocketMessage;
}

function disconnect() {
    if (ws) {
        ws.close();
    }
}

// Send settings to the server
function sendSettings() {
    if (!connected || !ws) return;
    
    const quality = parseInt(settingQuality.value);
    const scale = parseFloat(settingScale.value) / 100.0;
    
    ws.send(JSON.stringify({
        type: 'set_settings',
        quality: quality,
        scale: scale
    }));
}

// Frame requesting logic (self-throttling pull model)
function requestNextFrame() {
    if (!connected) return;
    
    const now = Date.now();
    const elapsed = now - lastFrameRequestTime;
    const minInterval = 1000 / targetFps;
    
    if (elapsed >= minInterval) {
        sendFrameRequest();
    } else {
        setTimeout(sendFrameRequest, minInterval - elapsed);
    }
}

function sendFrameRequest() {
    if (!connected || !ws) return;
    lastFrameRequestTime = Date.now();
    ws.send(JSON.stringify({
        type: 'request_frame',
        timestamp: lastFrameRequestTime
    }));
}

// Handle WebSocket messages
function handleWebSocketMessage(event) {
    if (typeof event.data !== 'string') return;
    
    let msg;
    try {
        msg = JSON.parse(event.data);
    } catch (e) {
        return;
    }
    
    if (msg.type === 'screen_size') {
        screenWidth = msg.width;
        screenHeight = msg.height;
        canvas.width = screenWidth;
        canvas.height = screenHeight;
        console.log(`Host Screen resolution: ${screenWidth}x${screenHeight}`);
        
    } else if (msg.type === 'frame') {
        const now = Date.now();
        
        // Calculate latency
        const reqTimestamp = msg.timestamp;
        const latency = now - reqTimestamp;
        statLatency.textContent = `${latency} ms`;
        
        // Keep track of incoming data size (base64 length is approx 4/3 of binary bytes)
        const approxBytes = msg.image.length * 0.75;
        totalBytesReceived += approxBytes;
        
        // Render image
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Frame rate stats
            frameCount++;
            
            // Request next frame
            requestNextFrame();
        };
        img.src = 'data:image/jpeg;base64,' + msg.image;
    }
}

// Input locking functions
function lockInput() {
    isInputLocked = true;
    inputLockOverlay.classList.remove('hidden');
    canvas.classList.add('captured');
    // Request focus so keyboard events target the document correctly
    canvas.focus();
}

function unlockInput() {
    isInputLocked = false;
    inputLockOverlay.classList.add('hidden');
    canvas.classList.remove('captured');
}

// Input Capturing - Mouse events
function getNormalizedCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // Bound coordinates between 0 and 1
    return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y))
    };
}

canvas.addEventListener('mousemove', (e) => {
    if (!connected || !mouseEnabled) return;
    
    const coords = getNormalizedCoordinates(e);
    ws.send(JSON.stringify({
        type: 'mouse_move',
        x: coords.x,
        y: coords.y
    }));
});

canvas.addEventListener('mousedown', (e) => {
    if (!connected || !mouseEnabled) return;
    e.preventDefault();
    
    ws.send(JSON.stringify({
        type: 'mouse_down',
        button: e.button
    }));
});

canvas.addEventListener('mouseup', (e) => {
    if (!connected || !mouseEnabled) return;
    e.preventDefault();
    
    ws.send(JSON.stringify({
        type: 'mouse_up',
        button: e.button
    }));
});

canvas.addEventListener('dblclick', (e) => {
    if (!connected || !mouseEnabled) return;
    e.preventDefault();
    
    ws.send(JSON.stringify({
        type: 'mouse_click',
        button: e.button,
        clicks: 2
    }));
});

// Disable browser context menu on remote canvas
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Mouse wheel/scroll support
canvas.addEventListener('wheel', (e) => {
    if (!connected || !mouseEnabled) return;
    e.preventDefault();
    
    ws.send(JSON.stringify({
        type: 'mouse_wheel',
        dx: e.deltaX,
        dy: e.deltaY
    }));
}, { passive: false });

// Input Capturing - Keyboard events
window.addEventListener('keydown', (e) => {
    if (!connected || !keyboardEnabled) return;
    
    // Unlock input lock when pressing Escape
    if (e.key === 'Escape' && isInputLocked) {
        unlockInput();
        return;
    }
    
    if (isInputLocked) {
        e.preventDefault();
        
        ws.send(JSON.stringify({
            type: 'key_down',
            key: e.key,
            code: e.code
        }));
    }
});

window.addEventListener('keyup', (e) => {
    if (!connected || !keyboardEnabled || !isInputLocked) return;
    e.preventDefault();
    
    ws.send(JSON.stringify({
        type: 'key_up',
        key: e.key,
        code: e.code
    }));
});

// Stats tracking intervals
function startStatsTracking() {
    // Track FPS
    lastFrameTime = Date.now();
    frameCount = 0;
    fpsIntervalId = setInterval(() => {
        const now = Date.now();
        const fps = Math.round((frameCount * 1000) / (now - lastFrameTime));
        statFps.textContent = fps;
        
        frameCount = 0;
        lastFrameTime = now;
    }, 1000);
    
    // Track Bandwidth
    totalBytesReceived = 0;
    bandwidthIntervalId = setInterval(() => {
        const bandwidthKB = (totalBytesReceived / 1024).toFixed(1);
        statBandwidth.textContent = `${bandwidthKB} KB/s`;
        totalBytesReceived = 0;
    }, 1000);
}

function stopStatsTracking() {
    if (fpsIntervalId) clearInterval(fpsIntervalId);
    if (bandwidthIntervalId) clearInterval(bandwidthIntervalId);
    
    statLatency.textContent = '-- ms';
    statFps.textContent = '--';
    statBandwidth.textContent = '-- KB/s';
}
