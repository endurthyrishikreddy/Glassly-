
# Installation & Requirements

To run this application locally, ensure you have **Node.js** (version 18 or higher) installed.

## 1. Setup Files
Ensure the following files (provided in the code updates) are in your project root folder:
- `package.json`
- `vite.config.ts`
- `.env` (You must create this manually)

## 2. Create .env File
Create a file named `.env` in the root directory and add your Google Gemini API key:

```env
API_KEY=AIzaSy...YourKeyHere...
```

## 3. Install Dependencies
Open your terminal in the project folder and run:

```bash
npm install
```

This command reads `package.json` and installs all required libraries (`react`, `@google/genai`, `vite`, etc.).

## 4. Run the App
Start the development server:

```bash
npm run dev
```

Open your browser to `http://localhost:5173`.

## Troubleshooting
- **"process is not defined"**: Ensure `vite.config.ts` is present and identical to the provided file.
- **Blank Screen**: Check the browser console (F12). If you see generic script errors, try deleting the `node_modules` folder and running `npm install` again.