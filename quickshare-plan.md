# QuickShare PWA — Implementation Plan

> **For agentic workers:** Use `executing-plans` kết hợp `verification-before-completion` để implement từng task. Steps dùng checkbox `- [ ]` để tracking.

**Goal:** Xây dựng QuickShare — ứng dụng PWA chia sẻ file/text P2P, zero-egress, zero-trust E2EE, bypass firewall đại học, tích hợp AI client-side.

**Architecture:** Edge signaling (Cloudflare Workers + Durable Objects) → WebRTC P2P Data Channel (TURN TCP/443 fallback) → AES-GCM E2EE via Web Crypto API → Next.js App Router + Glassmorphic UI.

**Tech Stack:** Next.js 14+ (App Router), React 18+, TypeScript, Tailwind CSS, Shadcn/Radix UI, cmdk, Hono.js, Cloudflare Workers/Durable Objects, WebRTC, Web Crypto API, Tesseract.js (WASM), Highlight.js.

---

## Cấu trúc Monorepo

```
QUICK_SHARE/
├── apps/
│   ├── web/                    # Next.js Frontend (PWA)
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ui/             # Shadcn components
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── ThemeProvider.tsx
│   │   │   ├── AnimatedBackground.tsx
│   │   │   ├── TransferStatus.tsx
│   │   │   └── DropZone.tsx
│   │   ├── lib/
│   │   │   ├── crypto.ts       # Web Crypto API wrapper
│   │   │   ├── webrtc.ts       # WebRTC manager class
│   │   │   └── hooks/
│   │   │       └── useWebRTC.ts
│   │   ├── utils/
│   │   │   ├── ai.ts           # AI agent orchestrator
│   │   │   └── language-detect.ts
│   │   ├── workers/
│   │   │   └── ocr.worker.ts   # Tesseract Web Worker
│   │   ├── public/
│   │   │   └── manifest.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── signaling/              # Cloudflare Worker (Hono.js)
│       ├── src/
│       │   ├── index.ts        # Hono router + endpoints
│       │   └── room.ts         # Durable Object: RoomCoordinator
│       ├── wrangler.toml
│       └── package.json
└── package.json                # Root workspace
```

---

## Phase 1: Infrastructure & Edge Signaling Engine

> **Deliverables:** `wrangler.toml`, `package.json`, `src/index.ts`, `src/room.ts`

### Task 1.1: Khởi tạo Signaling Worker project

**Files:**
- Create: `apps/signaling/package.json`
- Create: `apps/signaling/wrangler.toml`
- Create: `apps/signaling/tsconfig.json`

- [ ] **Step 1:** Khởi tạo project Cloudflare Worker với Hono.js
  - `npm init -y` trong `apps/signaling/`
  - Install: `hono`, `@cloudflare/workers-types`
  - Cấu hình `wrangler.toml` với Durable Object binding `ROOM`

- [ ] **Step 2:** Cấu hình TypeScript strict mode
  - `tsconfig.json` với `strict: true`, target `ES2022`, module `ESNext`

- [ ] **Step 3:** Verify — chạy `npx wrangler dev` khởi động không lỗi

---

### Task 1.2: Hono.js Router + API Endpoints

**Files:**
- Create: `apps/signaling/src/index.ts`

- [ ] **Step 1:** Implement Hono router
  - `GET /` — health check
  - `GET /api/room/new` — tạo Room ID mới (nanoid 8 ký tự), trả về `{ roomId }`
  - `GET /api/room/:roomId/ws` — upgrade lên WebSocket, forward đến Durable Object

- [ ] **Step 2:** Middleware: CORS (allow all origins), secure headers, rate limiting cơ bản

- [ ] **Step 3:** Verify — `curl localhost:8787/api/room/new` trả về JSON `{ roomId: "..." }`

---

### Task 1.3: Durable Object — RoomCoordinator

**Files:**
- Create: `apps/signaling/src/room.ts`
- Modify: `apps/signaling/src/index.ts` (export DO class)
- Modify: `apps/signaling/wrangler.toml` (DO binding)

- [ ] **Step 1:** Implement `RoomCoordinator` class
  - `fetch()` → upgrade HTTP → WebSocket
  - Track max 2 peers per room (`Map<WebSocket, PeerInfo>`)
  - Reject peer thứ 3+ với error message

- [ ] **Step 2:** Handle WebSocket messages
  - Message types: `offer`, `answer`, `ice-candidate`, `peer-joined`, `peer-left`
  - Relay signaling messages từ peer A → peer B (KHÔNG log/lưu payload)
  - Broadcast `peer-joined`/`peer-left` events

- [ ] **Step 3:** Implement cleanup & timeout
  - Auto-close room sau 30 phút idle
  - Handle `close`/`error` events → notify remaining peer
  - Alarm API cho dead connection cleanup

- [ ] **Step 4:** Verify — test bằng 2 WebSocket clients (`wscat`) kết nối cùng room, gửi/nhận message relay

---

## Phase 2: Cryptography & WebRTC Core Engine

> **Deliverables:** `crypto.ts`, `webrtc.ts`, `useWebRTC.ts`

### Task 2.1: Web Crypto API Wrapper — E2EE Module

**Files:**
- Create: `apps/web/lib/crypto.ts`

- [ ] **Step 1:** Implement key generation
  ```typescript
  generateKey(): Promise<CryptoKey>  // AES-GCM 256-bit
  exportKeyToBase64URL(key: CryptoKey): Promise<string>
  importKeyFromBase64URL(base64: string): Promise<CryptoKey>
  ```

- [ ] **Step 2:** Implement streaming encryption/decryption
  ```typescript
  encryptChunk(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer>
  // Prepend random 12-byte IV to ciphertext
  decryptChunk(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer>
  // Extract IV from first 12 bytes
  ```

- [ ] **Step 3:** Implement URI fragment helpers
  ```typescript
  buildShareURL(roomId: string, key: CryptoKey): Promise<string>
  extractKeyFromHash(hash: string): Promise<CryptoKey>
  ```

- [ ] **Step 4:** Verify — unit test: generate key → encrypt "Hello" → decrypt → assert match

---

### Task 2.2: WebRTC Manager Class

**Files:**
- Create: `apps/web/lib/webrtc.ts`

- [ ] **Step 1:** Implement `WebRTCManager` class
  ```typescript
  class WebRTCManager {
    private pc: RTCPeerConnection
    private dc: RTCDataChannel | null
    private ws: WebSocket
    // ICE config với STUN + TURN TCP/443 fallback
  }
  ```

- [ ] **Step 2:** ICE Configuration — TURN TCP/443 bắt buộc
  ```typescript
  const iceConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:<TURN_SERVER>:443?transport=tcp',
        username: '<USERNAME>',
        credential: '<CREDENTIAL>'
      }
    ]
  }
  ```

- [ ] **Step 3:** Signaling state machine
  - `connect(roomId)` → WebSocket → listen for peer
  - Sender: `createOffer()` → send via WS → wait `answer`
  - Receiver: receive `offer` → `createAnswer()` → send via WS
  - Both: exchange ICE candidates qua WS

- [ ] **Step 4:** DataChannel với backpressure control
  ```typescript
  private BUFFER_THRESHOLD = 256 * 1024 // 256KB
  // Pause sending khi bufferedAmount > threshold
  // Resume khi bufferedamountlow event fires
  ```

- [ ] **Step 5:** File chunking & transfer protocol
  - Chunk size: 64KB (tunable)
  - Message format: `{ type: 'meta'|'chunk'|'done', ... }`
  - Meta message: filename, size, totalChunks, mimeType

- [ ] **Step 6:** Verify — test DataChannel gửi/nhận data giữa 2 browser tabs (localhost)

---

### Task 2.3: React Hook — useWebRTC

**Files:**
- Create: `apps/web/lib/hooks/useWebRTC.ts`

- [ ] **Step 1:** Implement hook
  ```typescript
  export function useWebRTC() {
    // States: idle | connecting | waiting | transferring | done | error
    // Returns: { status, progress, sendFile, sendText, connect, ... }
  }
  ```
  - Wrap `WebRTCManager` + `CryptoModule` thành reactive state
  - Encrypt trước khi gửi, decrypt khi nhận
  - Track transfer progress (%)

- [ ] **Step 2:** Verify — mount hook trong test component, log state transitions

---

## Phase 3: UI Shell, Theming & PWA Setup

> **Deliverables:** `tailwind.config.ts`, `globals.css`, `layout.tsx`, `manifest.json`

### Task 3.1: Next.js Project Setup

**Files:**
- Create: `apps/web/` (via `npx create-next-app`)
- Install: `tailwindcss`, `@shadcn/ui`, `next-themes`, `cmdk`

- [ ] **Step 1:** `npx -y create-next-app@latest ./apps/web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"`

- [ ] **Step 2:** Install dependencies
  ```bash
  npm i next-themes cmdk sonner lucide-react class-variance-authority clsx tailwind-merge
  npx shadcn@latest init
  ```

- [ ] **Step 3:** Verify — `npm run dev` khởi động, truy cập `localhost:3000` hiển thị trang

---

### Task 3.2: Glassmorphic Design System

**Files:**
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1:** CSS Variables — Light Mode (Playful Pastel)
  ```css
  :root {
    --background: #FAFAFA;
    --glass-bg: rgba(255,255,255,0.4);
    --glass-border: rgba(255,255,255,0.5);
    --accent-primary: #D7BDE2; /* Lavender */
    --accent-secondary: #A3E4D7; /* Mint */
  }
  ```

- [ ] **Step 2:** CSS Variables — Dark Mode (Lofi Night)
  ```css
  .dark {
    --background: #2C2621;
    --glass-bg: rgba(0,0,0,0.3);
    --glass-border: rgba(255,255,255,0.1);
    --accent-primary: #F5A623; /* Warm Amber */
  }
  ```

- [ ] **Step 3:** Tailwind config — extend với glass utilities, rounded-2xl/3xl, soft shadows, font Nunito/Quicksand

- [ ] **Step 4:** Animated mesh gradient background (CSS `@keyframes` — slow moving gradients)

- [ ] **Step 5:** Verify — toggle dark/light mode, glassmorphic panels render đúng cả 2 mode

---

### Task 3.3: Root Layout + Theme Provider

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/components/ThemeProvider.tsx`
- Create: `apps/web/components/AnimatedBackground.tsx`

- [ ] **Step 1:** `ThemeProvider` wrap `next-themes` — prevent hydration mismatch (`attribute="class"`, `defaultTheme="system"`)

- [ ] **Step 2:** `AnimatedBackground` — full-screen animated mesh gradient layer (z-0)

- [ ] **Step 3:** Root layout: `<ThemeProvider>` → `<AnimatedBackground>` → `{children}`

- [ ] **Step 4:** Verify — page load không hydration error, background gradient animate mượt

---

### Task 3.4: PWA Manifest + Web Share Target

**Files:**
- Create: `apps/web/public/manifest.json`
- Modify: `apps/web/app/layout.tsx` (link manifest)

- [ ] **Step 1:** `manifest.json`
  ```json
  {
    "name": "QuickShare",
    "short_name": "QuickShare",
    "display": "standalone",
    "theme_color": "#2C2621",
    "background_color": "#FAFAFA",
    "share_target": {
      "action": "/share",
      "method": "POST",
      "enctype": "multipart/form-data",
      "params": {
        "title": "title",
        "text": "text",
        "files": [{ "name": "files", "accept": ["*/*"] }]
      }
    }
  }
  ```

- [ ] **Step 2:** Icons (192x192, 512x512) + meta tags trong layout

- [ ] **Step 3:** Verify — Lighthouse PWA audit score ≥ 80

---

## Phase 4: Command Palette — The Brain

> **Deliverables:** `CommandPalette.tsx`, `page.tsx`

### Task 4.1: Command Palette Component

**Files:**
- Create: `apps/web/components/CommandPalette.tsx`

- [ ] **Step 1:** Implement `cmdk` wrapper với glassmorphic styling
  - Auto-focus on page load
  - `Ctrl+K` / `⌘K` toggle
  - `Escape` close/clear
  - Arrow keys navigation

- [ ] **Step 2:** Command groups
  - **Share:** "Send File", "Paste Snippet", "Paste from Clipboard"
  - **AI Tools:** "Extract Text from Image (OCR)", "Format Source Code"
  - **System:** "Toggle Theme", "View Diagnostics", "Destroy Room"

- [ ] **Step 3:** Dynamic states trong palette context
  - "Waiting for peer connection..." (pulse animation)
  - "Encrypting payload..." (progress bar)
  - "Transferring data..." (progress %)

- [ ] **Step 4:** Verify — tất cả keyboard shortcuts hoạt động, command filtering đúng

---

### Task 4.2: Main Page + Drop Zone

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/components/DropZone.tsx`
- Create: `apps/web/components/TransferStatus.tsx`

- [ ] **Step 1:** Main page layout
  - Center: Command Palette (always visible trigger bar)
  - Drop zone overlay (file drag & drop với ripple animation)
  - Room status indicator (connected/waiting)

- [ ] **Step 2:** `DropZone` — drag & drop file handling
  - `onDragOver`, `onDrop` events
  - Visual feedback: pulse/ripple khi drop
  - Trigger encryption + transfer flow

- [ ] **Step 3:** `TransferStatus` — progress UI
  - File name, size, progress bar
  - Speed indicator (KB/s)
  - Success/error toast (Sonner)

- [ ] **Step 4:** Wire up `useWebRTC` hook với Command Palette actions

- [ ] **Step 5:** Verify — full flow: tạo room → copy link → mở tab mới → peer connect → gửi file text → nhận thành công

---

## Phase 5: Client-Side AI Integration & Final Polish

> **Deliverables:** `ai.ts`, `ocr.worker.ts`, updated UI components

### Task 5.1: OCR Web Worker (Tesseract.js)

**Files:**
- Create: `apps/web/workers/ocr.worker.ts`
- Create: `apps/web/utils/ai.ts`

- [ ] **Step 1:** Web Worker setup
  ```typescript
  // ocr.worker.ts
  importScripts('tesseract.js')
  // Listen for image Blob messages
  // Canvas → grayscale → threshold → Tesseract recognize
  // postMessage result text
  ```

- [ ] **Step 2:** Image preprocessing trong worker
  - `OffscreenCanvas` → grayscale conversion → binary thresholding
  - Chỉ load English + Vietnamese language packs

- [ ] **Step 3:** `ai.ts` orchestrator
  ```typescript
  export async function extractTextFromImage(blob: Blob): Promise<string>
  // Spawn worker → send blob → await result
  ```

- [ ] **Step 4:** Verify — paste ảnh chứa text → OCR trả về text chính xác ≥ 80%

---

### Task 5.2: Code Detection & Syntax Highlighting

**Files:**
- Create: `apps/web/utils/language-detect.ts`
- Modify: `apps/web/components/CommandPalette.tsx`

- [ ] **Step 1:** Language detection bằng regex heuristics
  ```typescript
  export function detectLanguage(text: string): string | null
  // Check patterns: import/from (JS), def/class (Python), #include (C++), { } ; (JSON), etc.
  ```

- [ ] **Step 2:** Highlight.js integration
  - Lazy load highlight.js
  - Theme sync: pastel theme (light) / dark theme (dark mode)
  - Render highlighted code trong Command Palette preview

- [ ] **Step 3:** Verify — paste Python code → auto-detect → highlight đúng syntax

---

### Task 5.3: Toast Notifications & Final Polish

**Files:**
- Modify: Multiple UI components

- [ ] **Step 1:** Sonner toast integration
  - Success: "File received successfully ✓"
  - Error: "Connection lost. Retrying..."
  - Info: "Peer joined the room"

- [ ] **Step 2:** Micro-interactions polish
  - `hover:scale-[1.02]`, `active:scale-[0.98]` trên buttons
  - `transition-all duration-300 ease-in-out` toàn app
  - Focus rings với accent color

- [ ] **Step 3:** Responsive design check (mobile, tablet, desktop)

- [ ] **Step 4:** Final verify — full E2E test:
  1. Mở QuickShare → tạo room
  2. Copy link (chứa encryption key trong fragment)
  3. Mở link ở tab/device khác → peer connect
  4. Gửi file → encrypted → P2P transfer → decrypt → download
  5. Paste ảnh → OCR extract text
  6. Paste code → auto-detect language → syntax highlight
  7. Toggle theme → tất cả components render đúng

---

## Verification Plan

### Automated
- `npm run build` — zero errors cho cả `apps/web` và `apps/signaling`
- `npx wrangler dev` — signaling server hoạt động
- `npm run dev` — frontend chạy localhost
- Lighthouse audit: Performance ≥ 90, PWA ≥ 80

### Manual / Browser Tests
- 2-tab test: full P2P file transfer flow
- Encryption verify: check URI fragment KHÔNG gửi lên server (Network tab)
- Theme toggle: Light ↔ Dark không hydration error
- Keyboard-only navigation: toàn bộ app dùng được bằng keyboard
- Mobile responsive: test trên viewport 375px

---

## Open Questions

> [!IMPORTANT]
> **1. TURN Server:** Dùng dịch vụ TURN miễn phí nào? Gợi ý: [Metered.ca](https://metered.ca) (free tier) hoặc [Open Relay Project](https://www.metered.ca/tools/openrelay/). Hay bạn muốn self-host Coturn?

> [!IMPORTANT]
> **2. Cloudflare Account:** Bạn đã có Cloudflare account với Workers plan (free tier đủ dùng) chưa? Cần account để deploy Durable Objects.

> [!WARNING]
> **3. Scope MVP:** MegaPrompt rất lớn. Bạn muốn build full 5 phases hay ưu tiên MVP (Phase 1-4 trước, Phase 5 AI sau)?

> [!NOTE]
> **4. Domain:** Deploy frontend ở đâu? Vercel (free) cho Next.js? Và signaling worker trên `*.workers.dev`?
