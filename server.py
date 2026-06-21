import os
import io
import json
import base64
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import mss
from PIL import Image
from pynput.mouse import Controller as MouseController, Button
from pynput.keyboard import Controller as KeyboardController, Key
import uvicorn

app = FastAPI()

# Mount static folder
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

mouse = MouseController()
keyboard = KeyboardController()

# Redirect root to static index
@app.get("/")
async def get_index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path) as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Client files not found.</h1>")

# Mapping of JS key values to pynput Keys (built dynamically per platform)
KEY_MAP = {}
_candidates = {
    "Enter": "enter",
    "Backspace": "backspace",
    "Tab": "tab",
    "Escape": "esc",
    "Space": "space",
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "Shift": "shift",
    "ShiftLeft": "shift",
    "ShiftRight": "shift_r",
    "Control": "ctrl",
    "ControlLeft": "ctrl",
    "ControlRight": "ctrl_r",
    "Alt": "alt",
    "AltLeft": "alt",
    "AltRight": "alt_r",
    "Meta": "cmd",
    "MetaLeft": "cmd",
    "MetaRight": "cmd_r",
    "CapsLock": "caps_lock",
    "Delete": "delete",
    "Insert": "insert",
    "Home": "home",
    "End": "end",
    "PageUp": "page_up",
    "PageDown": "page_down",
}
for _i in range(1, 21):
    _candidates[f"F{_i}"] = f"f{_i}"

for _js_name, _py_name in _candidates.items():
    if hasattr(Key, _py_name):
        KEY_MAP[_js_name] = getattr(Key, _py_name)


BUTTON_MAP = {
    0: Button.left,
    1: Button.middle,
    2: Button.right
}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected via WebSocket")
    
    # Default capture parameters
    quality = 60
    scale = 0.8
    
    # Get primary monitor size
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        screen_w = monitor["width"]
        screen_h = monitor["height"]
        
    # Send screen dimensions to client
    await websocket.send_json({
        "type": "screen_size",
        "width": screen_w,
        "height": screen_h
    })
    
    try:
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)
            event_type = event.get("type")
            
            if event_type == "request_frame":
                client_timestamp = event.get("timestamp")
                
                # Capture and compress in a thread to keep WebSocket loop responsive
                def grab_and_encode():
                    with mss.mss() as sct_local:
                        monitor_local = sct_local.monitors[1]
                        sct_img = sct_local.grab(monitor_local)
                        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                        if scale < 1.0:
                            new_size = (int(img.width * scale), int(img.height * scale))
                            img = img.resize(new_size, Image.Resampling.BILINEAR)
                        img_byte_arr = io.BytesIO()
                        img.save(img_byte_arr, format='JPEG', quality=quality)
                        return img_byte_arr.getvalue()
                
                try:
                    frame_bytes = await asyncio.to_thread(grab_and_encode)
                    base64_frame = base64.b64encode(frame_bytes).decode("utf-8")
                    
                    await websocket.send_json({
                        "type": "frame",
                        "image": base64_frame,
                        "timestamp": client_timestamp
                    })
                except Exception as capture_err:
                    print(f"Error capturing or encoding frame: {capture_err}")
                    # Send an error message or retry
                
            elif event_type == "set_settings":
                quality = int(event.get("quality", quality))
                scale = float(event.get("scale", scale))
                print(f"Settings updated: Quality={quality}%, Scale={scale*100}%")
                
            elif event_type == "mouse_move":
                norm_x = event.get("x")
                norm_y = event.get("y")
                # Calculate host coordinates
                host_x = int(norm_x * screen_w) + monitor["left"]
                host_y = int(norm_y * screen_h) + monitor["top"]
                try:
                    mouse.position = (host_x, host_y)
                except Exception as mouse_err:
                    print(f"Error moving mouse: {mouse_err}")
                
            elif event_type == "mouse_down":
                btn_id = event.get("button")
                btn = BUTTON_MAP.get(btn_id, Button.left)
                try:
                    mouse.press(btn)
                except Exception as mouse_err:
                    print(f"Error pressing mouse button {btn}: {mouse_err}")
                
            elif event_type == "mouse_up":
                btn_id = event.get("button")
                btn = BUTTON_MAP.get(btn_id, Button.left)
                try:
                    mouse.release(btn)
                except Exception as mouse_err:
                    print(f"Error releasing mouse button {btn}: {mouse_err}")
                
            elif event_type == "mouse_click":
                btn_id = event.get("button")
                btn = BUTTON_MAP.get(btn_id, Button.left)
                clicks = event.get("clicks", 1)
                try:
                    mouse.click(btn, clicks)
                except Exception as mouse_err:
                    print(f"Error clicking mouse button {btn}: {mouse_err}")
                
            elif event_type == "mouse_wheel":
                dx = event.get("dx", 0)
                dy = event.get("dy", 0)
                # Normalize scroll step
                scroll_x = 1 if dx > 0 else (-1 if dx < 0 else 0)
                scroll_y = 1 if dy > 0 else (-1 if dy < 0 else 0)
                try:
                    # pynput scroll uses (dx, dy).
                    # scroll_y is inverted since positive is scroll up, negative is scroll down.
                    mouse.scroll(scroll_x, -scroll_y)
                except Exception as mouse_err:
                    print(f"Error scrolling mouse: {mouse_err}")
                
            elif event_type == "key_down":
                key_name = event.get("key")
                try:
                    if key_name in KEY_MAP:
                        keyboard.press(KEY_MAP[key_name])
                    elif len(key_name) == 1:
                        keyboard.press(key_name.lower())
                except Exception as key_err:
                    print(f"Error simulating key down for '{key_name}': {key_err}")
                    
            elif event_type == "key_up":
                key_name = event.get("key")
                try:
                    if key_name in KEY_MAP:
                        keyboard.release(KEY_MAP[key_name])
                    elif len(key_name) == 1:
                        keyboard.release(key_name.lower())
                except Exception as key_err:
                    print(f"Error simulating key up for '{key_name}': {key_err}")
                    
    except WebSocketDisconnect:
        print("Client disconnected via WebSocket")
    except Exception as e:
        print(f"Unexpected error in websocket loop: {e}")

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
