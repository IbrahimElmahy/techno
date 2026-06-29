# Feature Specification: Back-Office Desktop Application

**Feature Branch**: `004-backoffice-desktop-app`  
**Created**: 2026-06-28  
**Status**: Draft  
**Input**: User description: "Specify the Back-Office Desktop Application (installed Windows app, Electron + React, Arabic RTL), conforming to constitution v1.4.0. It is a THIN CLIENT of the existing backend OpenAPI contract (Foundation 001 + Sales & Inventory 002 + After-Sales 003) — it contains NO business logic; all rules, permissions, and calculations are server-authoritative. Used by all roles EXCEPT Sales Rep."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shell Foundation, Theme & Authentication (Priority: P1)

As a back-office employee (System Admin, Branch Manager, Purchasing Manager, Sales Manager, After-Sales Staff), I want to securely log in to the application and access a unified RTL interface themed around the "Techno Therm" brand, displaying only the menu sections authorized for my role.

**Why this priority**: Core prerequisite for all system access. Enforces user security, roles-based visibility, and baseline design system consistency.

**Independent Test**: Can be fully tested by launching the Electron app, entering valid credentials, and verifying that the layout aligns with the design system, displays user name and role, and renders navigation items appropriate for the logged-in role.

**Acceptance Scenarios**:

1. **Given** the app is launched and user is not authenticated, **When** they see the login screen, **Then** it is in Arabic, uses the Cairo font, aligns to RTL, and matches the light theme (Primary green #6AB42D, Accent orange #F5A11D).
2. **Given** the user enters username and password, **When** they click "تسجيل الدخول" (Login), **Then** a POST request is made to `/auth/login`, and a valid JWT is stored in session memory.
3. **Given** a user is logged in as `After-Sales Staff`, **When** the layout loads, **Then** the right collapsible navigation menu shows only "العملاء والذمم" (Customers & Receivables), "المنتجات والمخزون" (Products & Stock), "خدمة ما بعد البيع" (After-Sales), and "التقارير" (Reports), while hiding administrative or manufacturing menus.
4. **Given** any logged-in session, **When** the user clicks "تسجيل الخروج" (Logout) in the top bar, **Then** the JWT is destroyed, and the user is redirected to the login screen.

---

### User Story 2 - User & Organization Administration (Priority: P1)

As a System Admin or Branch Manager, I want to manage system users and organizational elements (governorates, territories, branches, warehouses, and custodies) through standard table grids.

**Why this priority**: Required to configure the company structure and warehouse settings before transactions can occur.

**Independent Test**: Can be tested by navigating to organization settings, filtering branches or warehouses, and adding new records.

**Acceptance Scenarios**:

1. **Given** the user is a `Branch Manager`, **When** they load the "الفروع والمخازن" (Branches & Warehouses) screen, **Then** they can only view and edit warehouses and custodies belonging to their own branch (enforced via API scope check).
2. **Given** the user is a `System Admin`, **When** they load the organization screen, **Then** they can view and edit governorates, territories, branches, warehouses, and custodies across the entire company.
3. **Given** any user list page, **When** the user adds a new user, **Then** they must assign one of the 6 roles, and the app validates that branch managers, purchasing managers, sales managers, and sales reps are assigned to a specific branch.

---

### User Story 3 - Customers & Accounts Receivable (Priority: P1)

As an authorized manager or after-sales staff member, I want to manage the customer list (including customer types) and view/reassign customer accounts.

**Why this priority**: Customers are the foundation for sales invoices, loyalty points, and receivables accounting.

**Independent Test**: Can be tested by adding a new customer, verifying their ledger-derived balance is zero, and reassigning a customer to a different sales rep.

**Acceptance Scenarios**:

1. **Given** the user is on the customer list screen, **When** they click "إضافة عميل" (Add Customer), **Then** they must enter customer name, phone, type (trader, plumber, other), and target territory.
2. **Given** a customer has transactions, **When** viewing their detail card, **Then** their receivable account balance is displayed as derived from the ledger (POSTed via backend, no client calculation).
3. **Given** a `Sales Manager` or `Branch Manager`, **When** they reassign a customer to a different territory or sales rep, **Then** they must confirm the change, and the app calls the reassign endpoint. A `Sales Rep` is not permitted to perform this.

---

### User Story 4 - Catalog & Supplier Management (Priority: P2)

As a Purchasing Manager, Branch Manager, or Sales Manager, I want to manage suppliers and browse the catalog containing raw materials and products.

**Why this priority**: Necessary to set up purchasing chains and understand point values per product.

**Independent Test**: Can be tested by listing suppliers, browsing catalog items, and viewing their assigned point values.

**Acceptance Scenarios**:

1. **Given** the catalog list screen, **When** viewing catalog items, **Then** raw materials (purchase price, consumed-only) and products (fixed sale price, sold-only) are clearly distinguished.
2. **Given** the catalog detail view, **When** an `After-Sales Staff` or `System Admin` views a product, **Then** they can edit the loyalty point value per product, while other roles see it as read-only.
3. **Given** a `Purchasing Manager`, **When** they view the supplier list, **Then** they can see supplier details and their corresponding ledger-derived payable balances.

---

### User Story 5 - Purchases, Stock Transfers & simple Manufacturing (Priority: P2)

As a Purchasing Manager or Branch Manager, I want to record raw material purchases, initiate and approve stock transfers between warehouses, and log simple manufacturing events.

**Why this priority**: Required for raw material intake, stock balancing across branches, and transforming raw materials into finished products.

**Independent Test**: Can be tested by entering a raw material purchase, initiating a transfer of raw materials, and recording a production entry of a product.

**Acceptance Scenarios**:

1. **Given** a purchase entry form, **When** a `Purchasing Manager` inputs supplier details and raw material items, **Then** submitting the form posts directly to the backend to debit stock and credit payables.
2. **Given** a stock transfer request from Warehouse A to Warehouse B, **When** initiated, **Then** it is marked as "Pending Approval" (معلق).
3. **Given** a pending stock transfer, **When** a `Branch Manager` of the receiving branch approves the transfer, **Then** the transfer is finalized and stock balances are updated. If rejected, it returns to original state.
4. **Given** the simple manufacturing screen, **When** a manager enters raw materials consumed and products produced, **Then** the app posts them as two independent stock movements (as there is no BOM recipe logic client-side).

---

### User Story 6 - Sales Invoices & Sales Returns (Priority: P1)

As a Branch Manager or Sales Manager, I want to create sales invoices with combined discounts and split cash/credit terms, and process returns that reverse sales and loyalty points.

**Why this priority**: Core revenue-generating interface. Must support exact financial tracking.

**Independent Test**: Can be tested by entering a sales transaction, validating it doesn't allow negative stock, and performing a partial return.

**Acceptance Scenarios**:

1. **Given** the sales invoice form, **When** adding items, **Then** the app queries available stock and warns/prevents input exceeding current stock (No Negative Stock).
2. **Given** a sales invoice, **When** payment is split, **Then** the user can input the exact cash paid and the credit balance posted to the customer's receivables account.
3. **Given** an existing invoice, **When** processing a return, **Then** a confirmation dialog forces the user to accept the action, and the backend reverses both the stock movement, ledger postings, and earned loyalty points.

---

### User Story 7 - After-Sales Loyalty: Settings, Points & Coupons (Priority: P3)

As an After-Sales Staff member, I want to manage loyalty settings, convert customer points to coupons, and manage coupon redemptions.

**Why this priority**: Extends basic sales to include customer retention and promotional mechanics.

**Independent Test**: Can be tested by modifying conversion settings, converting a customer's points, and redeeming the generated coupon.

**Acceptance Scenarios**:

1. **Given** the Coupon Management screen, **When** the user edits the points-to-coupon conversion rate, **Then** the settings are updated on the server.
2. **Given** a customer with sufficient points, **When** a conversion is manually requested, **Then** the app calls the points conversion endpoint and displays the generated unique coupon serial.
3. **Given** a coupon, **When** checked, **Then** its type is shown (money coupon vs. gift coupon). If money coupon, it is redeemed against the customer's receivables. If gift coupon, it can be redeemed as a product or money off an invoice.

---

### User Story 8 - Treasury, Ledgers & Reporting Dashboard (Priority: P2)

As a manager or admin, I want to view ledger entries, post manual treasury corrections, and review operational reports with extensive filters.

**Why this priority**: Required for auditability, double-entry validation, and business intelligence.

**Independent Test**: Can be tested by pulling reports with multiple filters, checking treasury ledger balances, and viewing the audit logs.

**Acceptance Scenarios**:

1. **Given** the treasury view, **When** checking balances, **Then** all values are derived from double-entry ledger transactions (debit/credit) fetched from the backend.
2. **Given** any ledger entry, **When** a reversal is triggered, **Then** a confirmation modal is shown, and submitting creates a mirror-image reversal entry without deleting the original record.
3. **Given** the Reports screen, **When** selecting daily, managerial, revenue, or purchase reports, **Then** the user can filter by customer, territory, date range, supplier, and sales representative, loading the results into an Ant Design data table.
4. **Given** the Audit Log screen, **When** loaded, **Then** it shows chronologically all user actions (reads/writes) tracked on the server.

---

### Edge Cases

- **Server Disconnection**: Since the desktop application is a thin client and has no offline database, if the server connection drops, the app MUST show a persistent error overlay preventing further inputs and retrying connection every 5 seconds.
- **Role Permission Changes**: If a user's permissions or role is changed on the server while they are logged in, the next API request will return a 403 Forbidden. The client application MUST catch this, log the user out, clear the stored JWT, and display a session-expired/unauthorized notification.
- **Simultaneous Stock Updates**: If two users try to allocate the last unit of stock of a product, the backend will reject the second transaction (No Negative Stock). The client application MUST display a specific stock exhaustion toast notification and reload the current stock data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST render all screens using Arabic RTL layout and the Cairo font.
- **FR-002**: The system MUST implement a light theme using primary green #6AB42D and accent orange #F5A11D.
- **FR-003**: The application MUST enforce the 5 back-office roles (`system_admin`, `branch_manager`, `purchasing_manager`, `sales_manager`, `after_sales_staff`) and restrict navigation menus client-side while relying on server-side RBAC for authorization.
- **FR-004**: Authentication MUST be done via JWT tokens sent in the Authorization header of all API requests.
- **FR-005**: All forms for creating or editing entities MUST be displayed inside Ant Design modals or side drawers.
- **FR-006**: Every data list MUST consist of a filter bar, an Ant Design data table, and action buttons.
- **FR-007**: Reversals, deactivations, and returns MUST require user confirmation via a confirmation dialog before sending the request to the server.
- **FR-008**: The system MUST display toast notifications for the success or failure of all server transactions.
- **FR-009**: The system MUST connect to the backend OpenAPI contract and MUST NOT contain client-side business logic, calculations, or validation rules (with the exception of basic form field checks like empty inputs).
- **FR-010**: All currencies displayed MUST be in Egyptian Pounds (EGP).
- **FR-011**: The system MUST support filtering all reports (daily, managerial, revenue, purchases) by customer, territory, date range, supplier, and sales representative.
- **FR-012**: The system MUST check for updates on startup. If a new version is available on the server, the application MUST alert the user with a download link for manual installation.
- **FR-013**: Reports MUST be exportable as PDF and Excel formats. The client application MUST request the generated files from the backend using the current filters.
- **FR-014**: The application MUST discover the backend API URL by reading a local configuration file (`config.json`) in the application directory on startup.

### Key Entities *(include if feature involves data)*

- **Session**: Represents the active logged-in user state. Attributes: JWT token, username, role, branch ID (if scoped), login timestamp.
- **DesignTokens**: Client-side styling configuration. Attributes: Primary color (#6AB42D), Accent color (#F5A11D), Font (Cairo), Theme (Light), Direction (RTL).
- **NavigationMenu**: Configuration of menu paths and items. Attributes: Label (Arabic), Path, Roles permitted, Icon.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the back-office screen forms are completed using Ant Design RTL modals/drawers and Cairo font.
- **SC-002**: Users can complete login and navigate to their specific dashboard menu in under 5 seconds from launching the application.
- **SC-003**: 100% of data mutating API actions (creates, updates, reversals, returns) show a success/failure toast notification.
- **SC-004**: 100% of reversals and deactivations display a confirmation dialog before submitting the request to the backend.

## Assumptions

- **A-001**: The user running the back-office application has a Windows desktop or laptop with a stable network connection to the backend server.
- **A-002**: No offline storage is required; all data is fetched and saved directly to the backend.
- **A-003**: The backend server is fully compliant with the OpenAPI contract (Foundation 001 + Sales & Inventory 002 + After-Sales 003).
- **A-004**: Legacy data migration will be handled entirely on the backend database level and is out of scope for the desktop client.
