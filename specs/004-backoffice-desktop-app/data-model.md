# Client State Model: Back-Office Desktop Application

As a thin client, the application does not persist data to a local database. All data models are defined by the backend OpenAPI contract. The client maintains transient, in-memory states for authentication, application shell layout, and UI interactions.

## 1. Authentication State (AuthContext)
Managed globally via React Context, available to all views.
- **isAuthenticated**: `boolean` (True if JWT is present and valid)
- **user**: `SessionUser | null`
  - **username**: `string`
  - **role**: `RoleName` (`system_admin` | `branch_manager` | `purchasing_manager` | `sales_manager` | `after_sales_staff`)
  - **branchId**: `number | null` (Null for system_admin, set for branch-scoped managers)
  - **name**: `string` (Real name of the employee)
- **token**: `string | null` (JWT token used for API auth header)

## 2. Configuration Settings (ConfigContext)
Loaded from the local `config.json` file.
- **apiUrl**: `string` (HTTP url of the backend FastAPI endpoint)
- **version**: `string` (Current client application version read from package.json)

## 3. UI and Shell Layout State
Controls the responsive behaviour of the shared layout.
- **isNavCollapsed**: `boolean` (Controls right-side navigation collapse/expand state)
- **breadcrumbs**: `Array<{ title: string, path?: string }>` (Active navigation path hierarchy)
- **activeView**: `string` (Key of the current active menu path)

## 4. Transient Lookup Data (Cache)
Caches static or slow-changing backend catalogs to populate dropdown selects across screens.
- **branches**: `Array<Branch>` (List of all branches, system_admin only)
- **warehouses**: `Array<Warehouse>` (Filtered based on role scope)
- **governorates**: `Array<Governorate>`
- **territories**: `Array<Territory>`
- **custodies**: `Array<Custody>`
