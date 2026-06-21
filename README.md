# Antigravity KVM

A cross-platform web-based Keyboard, Video, and Mouse (KVM) remote control application. It allows you to share your screen and control a computer remotely using only a web browser on the client side (no installation needed on the controlling device).

## Features
- **Zero Client Setup**: Any device with a modern browser (phone, tablet, laptop, PC) can connect and control the host.
- **Low Latency & High Performance**: Employs a self-throttling pull-based WebSocket stream and multi-threaded screen capture.
- **Interactive Control**: Simulates mouse movements, left/middle/right clicks, double clicks, scrolls, and full keyboard typing.
- **Sleek HUD Panel**: Change scale, image quality, toggle mouse/keyboard control, and view real-time stats (FPS, Latency, Bandwidth) on the fly.
- **Secure Input Lock**: Escapes normal browser keys and focuses inputs when locked to prevent browser hotkeys from triggering locally.

---

## Host Setup

### 1. Prerequisites
Ensure you have Python 3.10+ installed.

### 2. Installation
We recommend setting up a virtual environment:

```bash
# Create a virtual environment
python3 -m venv .venv

# Activate it (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Run the Server
Activate your virtual environment and run the server script:

```bash
python server.py
```
The server will start on port `8000`.

---

## Client Connection

1. Open your web browser on any device connected to the same local network.
2. Navigate to: `http://<host-ip-address>:8000/` (e.g., `http://192.168.1.50:8000/` or `http://localhost:8000/` if testing on the same machine).
3. Click **Establish Connection**.
4. Click the remote screen canvas to lock your keyboard and mouse controls.
5. Press **Escape** (`Esc`) at any time to unlock your mouse and keyboard.

---

## macOS Configuration (Required for Host)

If you are running the host server on macOS, the system security settings will block Python from simulating mouse and keyboard movements unless granted **Accessibility** permissions.

### How to Grant Accessibility Permissions:
1. Open **System Settings** on your Mac.
2. Go to **Privacy & Security** -> **Accessibility**.
3. Under the **Allow the applications below to control your computer** list:
   - Click the `+` button.
   - Add your Terminal application (e.g., Terminal, iTerm2, VS Code) or the Python binary itself if executing outside a shell wrapper.
   - Ensure the toggle switch next to the app is turned **ON**.
4. Restart the server in your Terminal for the permissions to take effect.
