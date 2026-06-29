# Research Notes: Back-Office Desktop Application

## 1. Electron + React Integration Architecture

### Decision
Use **Vite** as the build tool combined with `vite-plugin-electron` to manage the dual processes (Main and Renderer). Packaging will be handled by `electron-builder` to produce a standalone Windows installer (`.exe`).

### Rationale
- Vite provides extremely fast Hot Module Replacement (HMR) during development.
- `electron-builder` is the industry standard for creating production-ready Windows installers with code signing capabilities.
- Separation of Main (Node.js backend context) and Renderer (React frontend context) is cleanly maintained via preloads and context isolation.

### Alternatives Considered
- **Electron Forge**: Rejected as it has more boilerplate bloat and slower build/start times compared to Vite.
- **Manual Webpack setup**: Rejected due to high configuration overhead and maintenance debt.

---

## 2. OpenAPI TypeScript Generation

### Decision
Use the **`openapi-typescript`** CLI tool to generate strict type definitions directly from the backend's FastAPI OpenAPI JSON contract (`openapi.json`). 

### Rationale
- Zero-drift guarantee: Frontend API request and response models will be automatically regenerated and statically checked against backend schema definitions.
- Keeps client-side thin and ensures strict TypeScript compilation errors if the backend contract changes.

### Alternatives Considered
- **openapi-generator-cli**: Generates full client classes but creates unnecessary class bloat and boilerplate. `openapi-typescript` generates pure types, letting us use a lean, centralized Axios wrapper.
- **Hand-written interfaces**: Rejected because it violates Principle II (Single Source of Truth) and allows model drift.

---

## 3. Dynamic Configuration Discovery (config.json)

### Decision
Read the `config.json` file dynamically at runtime rather than compile-time. 
- In development, the file is read from the project root.
- In production, Electron's Main process reads `config.json` from the application directory (adjacent to the executable) using `process.resourcesPath` or `app.getPath('userData')`, then passes the configuration to the Renderer process via IPC (Inter-Process Communication) on startup.

### Rationale
- Allows IT staff to change the backend API server URL or configuration without needing to rebuild and redistribute the desktop installer.
- Context isolation prevents the Renderer process from reading files directly from the OS, so IPC is the secure method to share config.

---

## 4. Automatic Update Check

### Decision
Implement a lightweight update checking mechanism. On app startup:
1. Electron Main process sends an HTTP GET request to `{API_URL}/api/v1/settings/desktop-version` (or configured update server).
2. The response returns the latest version (e.g. `{"version": "1.5.0", "url": "https://server/downloads/techno-setup.exe"}`).
3. If the latest version is greater than the current app version (read from `package.json`), the Main process sends an event to the Renderer process.
4. The Renderer process displays an Arabic RTL Ant Design Modal indicating a new version is available, with a button to download the installer.

---

## 5. Design System and Ant Design RTL

### Decision
Wrap the entire React application in `ConfigProvider` from Ant Design:
- Set `direction="rtl"`.
- Use `locale` from `antd/locale/ar_EG`.
- Configure custom theme tokens for Cairo font and brand colors:
  ```json
  {
    "token": {
      "colorPrimary": "#6AB42D",
      "colorInfo": "#6AB42D",
      "colorWarning": "#F5A11D",
      "fontFamily": "Cairo, sans-serif"
    }
  }
  ```

### Rationale
- Native Ant Design support for RTL minimizes custom CSS for mirroring layouts.
- Dynamic theme injection ensures color consistency across all widgets (tables, modals, forms).
