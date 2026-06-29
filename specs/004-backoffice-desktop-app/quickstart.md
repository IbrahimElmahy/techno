# Quickstart Guide: Back-Office Desktop Application

This guide outlines the steps to build, run, and develop the Electron + React desktop application.

## Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)
- Python backend running locally (to fetch OpenAPI schema)

## Development Setup

1. **Navigate to the frontend project directory** (if sub-folder `frontend` exists, otherwise current root if frontend is mixed. According to project structure, we will structure it inside `frontend/`):
   ```bash
   cd frontend
   npm install
   ```

2. **Initialize configuration**:
   Create a `config.json` in the root of the frontend folder:
   ```json
   {
     "apiUrl": "http://127.0.0.1:8000"
   }
   ```

3. **Generate API Types from backend OpenAPI**:
   Ensure the backend is running and execute:
   ```bash
   npm run generate-types
   ```
   *Note: This runs `openapi-typescript http://127.0.0.1:8000/openapi.json --output src/api/types.ts`*

4. **Start Development Server**:
   Launch Electron and React concurrently in hot-reload mode:
   ```bash
   npm run dev
   ```

## Production Building
To package the application for Windows distribution:
```bash
npm run build
```
This compile assets using Vite, runs the compilation, and triggers `electron-builder` to bundle the app as an installed `.exe` in the `dist` folder.
