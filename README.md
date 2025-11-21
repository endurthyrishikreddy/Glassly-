
# Gemini Glass Overlay

A transparent, glass-morphism chat overlay powered by Google's Gemini 2.5 Flash and Pro models. This application allows you to chat with an AI that can see your screen, browse the web, and perform OCR on specific screen regions.

## 🚀 Quick Start (Fixing the Blank Screen)

If you are seeing a **blank screen**, it is likely because:
1. Browsers cannot execute `.tsx` (TypeScript/React) files directly without compilation.
2. The code uses `process.env.API_KEY`, which does not exist in the browser by default.

Follow these steps to run the app locally using **Vite**.

### 1. Initialize Project
Open your terminal and create a new Vite project:

```bash
npm create vite@latest gemini-glass-overlay -- --template react-ts
cd gemini-glass-overlay
npm install
```

### 2. Install Dependencies
Install the specific libraries used in this application:

```bash
npm install @google/genai lucide-react
```

### 3. Configure Environment Variables
This is the most common cause of errors. The app expects `process.env.API_KEY`.

1. Create a file named `.env` in the root of your project.
2. Add your API key:
   ```env
   API_KEY=your_google_genai_api_key_here
   ```
3. **Crucial Step**: Update `vite.config.ts` to expose this variable to the browser:

   ```typescript
   import { defineConfig, loadEnv } from 'vite'
   import react from '@vitejs/plugin-react'

   // https://vitejs.dev/config/
   export default defineConfig(({ mode }) => {
     const env = loadEnv(mode, process.cwd(), '');
     return {
       plugins: [react()],
       define: {
         // This allows the app to access process.env.API_KEY
         'process.env.API_KEY': JSON.stringify(env.API_KEY),
       },
     }
   })
   ```

### 4. Organize Files
1. **Copy `index.html`**: Replace the `index.html` in your project root with the one provided. 
   * **Important**: Ensure the script tag in `index.html` points to your entry file. Change:
     ```html
     <div id="root"></div>
     <!-- Change this line if it points to index.js or main.tsx -->
     <script type="module" src="/src/index.tsx"></script>
     ```
2. **Source Files**: Place the provided `.tsx` and `.ts` files into your `src` folder.
   * `src/index.tsx` (Entry point)
   * `src/App.tsx`
   * `src/types.ts`
   * `src/services/geminiService.ts`
   * `src/components/GlassOverlay.tsx`
   * `src/components/MessageBubble.tsx`

### 5. Run Locally
```bash
npm run dev
```
Open the URL provided (usually `http://localhost:5173`).

---

## 🎮 Features & Controls

*   **Toggle Overlay**: Press `Alt + H` to fade the overlay in or out.
*   **Stealth Mode**: Press `Alt + S` to toggle low-opacity mode.
*   **Crop & Ask**: Click the crop icon in the toolbar to freeze the screen, draw a box, and perform OCR or Image Analysis on that specific region.
*   **Settings**: Click the gear icon to:
    *   Switch between **Gemini 2.5 Flash** (Fast) and **Gemini 3 Pro** (Reasoning).
    *   Enable **Google Search** or **Google Maps** tools.
    *   Adjust **Temperature** (Creativity).
    *   Set custom **System Instructions** (Persona).

## 🛠 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Blank Screen** | Check the console (F12). If you see `process is not defined`, follow Step 3 above to update `vite.config.ts`. |
| **Microphone/Screen Error** | Ensure your browser permissions allow microphone and screen recording access for `localhost`. |
| **"Display Capture" Error** | The app requires `getDisplayMedia`. Ensure you are running on HTTPS or `localhost`. Mobile browsers often do not support this API. |

## 📦 Permissions
This app requires the following permissions defined in `metadata.json`:
*   `microphone` (For voice input)
*   `display-capture` (For "Watch Screen" and "Crop & Ask")
*   `geolocation` (For Google Maps grounding)