# DexConnect for Mac

A high-performance macOS desktop hub for **Samsung DeX**, **Motorola Smart Connect (Ready For)**, and **Universal Android Desktop / Screen Mirroring** over both **wired (USB)** and **wireless (Wi-Fi)** connections via ADB and virtual display orchestration.

## Features

- 🪐 **Samsung DeX Desktop**: Native 60–120 FPS, <35ms latency, full Mac trackpad/mouse control, UHID keyboard passthrough, audio streaming, clipboard sync, and drag-and-drop file transfer.
- ⚡ **Motorola Smart Connect (Ready For)**: Native desktop workspace launcher with app streaming.
- 🖥️ **Universal Android Desktop**: Freeform desktop mode for Google Pixel, OnePlus, Xiaomi, and other Android 10+ devices.
- 📶 **1-Click Wireless Migration**: Plug in via USB once → click "Switch to Wireless" → app automatically configures port 5555, finds the phone's Wi-Fi IP, and connects wirelessly. Unplug and use cordless!
- 🔑 **Android 11+ Wireless Debugging Pairing GUI**: Pair wirelessly with 6-digit code and port without ever plugging in a cable.

## Architecture

- **Frontend**: Electron, Vite, React 18, TypeScript, Tailwind CSS (macOS glassmorphic dark theme).
- **Backend**: Node.js process supervisor driving `/opt/homebrew/bin/adb` and `/opt/homebrew/bin/scrcpy` with pluggable adapters.

## Requirements

- macOS 13+ (Apple Silicon or Intel)
- `adb` (Android Platform Tools)
- `scrcpy` 5.x (`brew install scrcpy`)
- Android device with USB Debugging enabled (Samsung One UI 5+, Motorola Hello UI / My UX, or Android 10+)
