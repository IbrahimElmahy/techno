# Tasks: Back-Office Desktop Application

**Input**: Design documents from `/specs/004-backoffice-desktop-app/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Includes exact file paths from repository root (prefixed with `frontend/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and bundler configuration

- [x] T001 Create folders structure in `frontend/` (src, electron, assets, tests) per implementation plan
- [x] T002 Initialize npm project with React, Vite, TypeScript, and Electron dependencies in [frontend/package.json](file:///d:/techno/frontend/package.json)
- [x] T003 [P] Configure ESLint and Prettier formatting configurations in [frontend/.eslintrc.json](file:///d:/techno/frontend/.eslintrc.json)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Configure code generation script to compile OpenAPI spec types to [frontend/src/api/types.ts](file:///d:/techno/frontend/src/api/types.ts)
- [x] T005 Implement config.json loading via IPC context bridge in [frontend/electron/main.ts](file:///d:/techno/frontend/electron/main.ts) and [frontend/electron/preload.ts](file:///d:/techno/frontend/electron/preload.ts)
- [x] T006 Setup global index styles and Google Fonts Cairo font registration in [frontend/src/index.css](file:///d:/techno/frontend/src/index.css)
- [x] T007 Configure Ant Design ConfigProvider (RTL layout + primary green #6AB42D theme) in [frontend/src/App.tsx](file:///d:/techno/frontend/src/App.tsx)
- [x] T008 Implement central Axios client with token insertion and 401/403 auto-logout interceptors in [frontend/src/api/client.ts](file:///d:/techno/frontend/src/api/client.ts)
- [x] T009 Create session management container in [frontend/src/components/AuthProvider.tsx](file:///d:/techno/frontend/src/components/AuthProvider.tsx)
- [x] T010 Create role-aware routing container in [frontend/src/components/RouteGuard.tsx](file:///d:/techno/frontend/src/components/RouteGuard.tsx)
- [x] T011 Create shared layout shell with collapsible right sidebar menu and top header in [frontend/src/components/AppLayout.tsx](file:///d:/techno/frontend/src/components/AppLayout.tsx)
- [x] T012 Implement reusable confirmation modal and error toast layouts in [frontend/src/components/ConfirmationDialog.tsx](file:///d:/techno/frontend/src/components/ConfirmationDialog.tsx)
- [x] T013 Setup Playwright testing suite configuration in [frontend/playwright.config.ts](file:///d:/techno/frontend/playwright.config.ts)

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Shell Foundation & Login Screen (Priority: P1) 🎯 MVP

**Goal**: Establish secure login interface and load layout shell with correct role-specific menus.
**Endpoints**: `POST /auth/login`
**Roles**: Any back-office employee (`system_admin`, `branch_manager`, `purchasing_manager`, `sales_manager`, `after_sales_staff`)
**Independent Test**: Playwright launches mock Electron instance, inputs valid credentials, gets JWT, and displays navigation matching role capabilities.

- [x] T014 Write Playwright UI tests for authorization and logout sequences in [frontend/tests/e2e/auth.spec.ts](file:///d:/techno/frontend/tests/e2e/auth.spec.ts)
- [x] T015 [US1] Create the Login page with validations in [frontend/src/pages/Login.tsx](file:///d:/techno/frontend/src/pages/Login.tsx) (consumes `POST /auth/login`)
- [x] T016 [US1] Integrate Login and AppLayout inside [frontend/src/App.tsx](file:///d:/techno/frontend/src/App.tsx)

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - User & Organization Administration (Priority: P1)

**Goal**: Manage system users and organizational trees (governorates, territories, branches, warehouses, custodies).
**Endpoints**: `/api/v1/users/` (GET, POST, PUT), `/api/v1/org/*` (GET, POST)
**Roles**: `system_admin` (full access), `branch_manager` (own branch write access)
**Independent Test**: Playwright logs in as Branch Manager, verifies they can create a warehouse for their own branch, and verifies other branch resources are locked/hidden.

- [x] T017 Write Playwright tests verifying role scopes for user management and branches in [frontend/tests/e2e/users.spec.ts](file:///d:/techno/frontend/tests/e2e/users.spec.ts)
- [x] T018 [US2] Implement user profiles screen with role assignments in [frontend/src/pages/Users.tsx](file:///d:/techno/frontend/src/pages/Users.tsx) (consumes `/api/v1/users/*`)
- [x] T019 [US2] Implement Tab-based Org management screen (Branches, Warehouses, Custodies) with modal creation forms in [frontend/src/pages/Org.tsx](file:///d:/techno/frontend/src/pages/Org.tsx) (consumes `/api/v1/org/*`)

**Checkpoint**: User Stories 1 and 2 are fully functional and integrated.

---

## Phase 5: User Story 3 - Customers & Accounts Receivable (Priority: P1)

**Goal**: Browse customer details, filter by type/rep/territory, view receivables ledger, reassign customers to reps.
**Endpoints**: `/api/v1/customers/` (GET, POST, PUT), `POST /api/v1/customers/{id}/reassign`
**Roles**: `system_admin`, `branch_manager`, `sales_manager`, `after_sales_staff`
**Independent Test**: Verify customer grid lists records, displays ledger-derived balance, and prompts confirmation dialog during sales representative reassignment.

- [x] T020 Write Playwright tests verifying customer creation schema and reassignment confirmation dialogs in [frontend/tests/e2e/customers.spec.ts](file:///d:/techno/frontend/tests/e2e/customers.spec.ts)
- [x] T021 [US3] Implement Customer listing grid, filtration headers, and adding drawer in [frontend/src/pages/Customers.tsx](file:///d:/techno/frontend/src/pages/Customers.tsx) (consumes `/api/v1/customers/*`)
- [x] T022 [US3] Implement customer reassignment side drawer inline in [frontend/src/pages/Customers.tsx](file:///d:/techno/frontend/src/pages/Customers.tsx) (consumes `POST /api/v1/customers/{id}/reassign`)

**Checkpoint**: Customer management and receivables views are fully testable.

---

## Phase 6: User Story 4 - Catalog & Supplier Management (Priority: P2)

**Goal**: Manage supplier payable accounts and browse catalog (setting per-product points).
**Endpoints**: `/api/v1/suppliers/` (GET, POST), `/api/v1/catalog/` (GET, POST), `PUT /api/v1/product_points/{id}`
**Roles**:
- Suppliers: `system_admin`, `branch_manager`, `purchasing_manager`
- Catalog (Read): All back-office roles
- Catalog (Points Write): `system_admin`, `after_sales_staff`
**Independent Test**: Verify non-authorized users cannot edit catalog point values. Verify supplier payable balances render correctly.

- [x] T023 Write Playwright tests verifying catalog view and conditional point editing in [frontend/tests/e2e/catalog.spec.ts](file:///d:/techno/frontend/tests/e2e/catalog.spec.ts)
- [x] T024 [US4] Implement Supplier payable accounts grid screen in [frontend/src/pages/Suppliers.tsx](file:///d:/techno/frontend/src/pages/Suppliers.tsx) (consumes `/api/v1/suppliers/*`)
- [x] T025 [US4] Implement Catalog view with inline point edits in [frontend/src/pages/Catalog.tsx](file:///d:/techno/frontend/src/pages/Catalog.tsx) (consumes `/api/v1/catalog/*` and `/api/v1/product_points/*`)

**Checkpoint**: Catalog and supplier ledgers are fully functional.

---

## Phase 7: User Story 5 - Purchases, Stock Transfers & simple Manufacturing (Priority: P2)

**Goal**: Track raw material purchases, log simple decoupled manufacturing, and manage stock transfers.
**Endpoints**: `POST /api/v1/purchases/`, `POST /api/v1/transfers/`, `/api/v1/transfers/{id}/[approve|reject]`, `/api/v1/manufacturing/[consume|produce]`
**Roles**: `system_admin`, `branch_manager`, `purchasing_manager`, `sales_manager` (Transfers initiation only)
**Independent Test**: Initiate a transfer from Warehouse A, log in as Warehouse B manager, verify transfer is displayed in pending table, approve it, and check status updates.

- [x] T026 Write Playwright tests verifying multi-step stock transfers and approval flows in [frontend/tests/e2e/transfers.spec.ts](file:///d:/techno/frontend/tests/e2e/transfers.spec.ts)
- [x] T027 [US5] Implement raw material Purchases ingestion screen in [frontend/src/pages/Purchases.tsx](file:///d:/techno/frontend/src/pages/Purchases.tsx) (consumes `POST /api/v1/purchases/`)
- [x] T028 [US5] Implement Decoupled Manufacturing dashboard (consume & produce panels) in [frontend/src/pages/Manufacturing.tsx](file:///d:/techno/frontend/src/pages/Manufacturing.tsx) (consumes `/api/v1/manufacturing/*`)
- [x] T029 [US5] Implement Stock Transfers manager (initiate request & approvals) in [frontend/src/pages/Transfers.tsx](file:///d:/techno/frontend/src/pages/Transfers.tsx) (consumes `/api/v1/transfers/*`)

**Checkpoint**: Stock control, purchases, and manufacturing logs are complete.

---

## Phase 8: User Story 6 - Sales Invoices & Sales Returns (Priority: P1)

**Goal**: Create sales invoices with discount and split payment features, and process returns.
**Endpoints**: `/api/v1/sales/` (GET, POST), `POST /api/v1/sales/{id}/return`
**Roles**: `system_admin`, `branch_manager`, `sales_manager`
**Independent Test**: Complete a sales invoice with cash + credit split. Attempt invoice exceeding available stock to verify negative stock rejection triggers. Initiate a return and confirm.

- [x] T030 Write Playwright tests verifying invoice validation, payment splits, and return confirmations in [frontend/tests/e2e/sales.spec.ts](file:///d:/techno/frontend/tests/e2e/sales.spec.ts)
- [x] T031 [US6] Implement Sales Invoices history list screen in [frontend/src/pages/Invoices.tsx](file:///d:/techno/frontend/src/pages/Invoices.tsx) (consumes `GET /api/v1/sales/`)
- [x] T032 [US6] Implement Invoice Creation screen inline in [frontend/src/pages/Invoices.tsx](file:///d:/techno/frontend/src/pages/Invoices.tsx) (consumes `POST /api/v1/sales/`)
- [x] T033 [US6] Implement Return wizard modal inline in [frontend/src/pages/Invoices.tsx](file:///d:/techno/frontend/src/pages/Invoices.tsx) (consumes `POST /api/v1/sales/{id}/returns`)

**Checkpoint**: Invoicing and sales flows are fully verified.

---

## Phase 9: User Story 7 - After-Sales Loyalty: Settings, Points & Coupons (Priority: P3)

**Goal**: Manage loyalty points conversion settings, convert customer points manually, view generated coupons, and redeem coupons.
**Endpoints**: `/api/v1/loyalty_settings/` (GET, PUT), `POST /api/v1/points/convert`, `/api/v1/coupons/` (GET), `POST /api/v1/coupons/redeem`
**Roles**: `after_sales_staff`, `system_admin`
**Independent Test**: Modify conversion points settings, convert customer points to generate coupon serial, verify coupon renders under appropriate type.

- [x] T034 Write Playwright tests verifying manual conversion flows and coupon validations in [frontend/tests/e2e/loyalty.spec.ts](file:///d:/techno/frontend/tests/e2e/loyalty.spec.ts)
- [x] T035 [US7] Implement Loyalty Settings & manual points conversion page in [frontend/src/pages/Loyalty.tsx](file:///d:/techno/frontend/src/pages/Loyalty.tsx) (consumes `/api/v1/loyalty_settings/` and `POST /api/v1/points/convert`)
- [x] T036 [US7] Implement Coupon catalog and redemption panels inline in [frontend/src/pages/Loyalty.tsx](file:///d:/techno/frontend/src/pages/Loyalty.tsx) (consumes `/api/v1/coupons/` and `POST /api/v1/coupons/redeem`)

**Checkpoint**: Loyalty and promotion management modules are complete.

---

## Phase 10: User Story 8 - Treasury, Ledgers & Reporting Dashboard (Priority: P2)

**Goal**: Display double-entry treasury ledgers, perform manual reversals, browse chronicled audit logs, and filter reporting modules.
**Endpoints**: `GET /api/v1/treasury/ledger`, `POST /api/v1/treasury/reverse`, `GET /api/v1/audit/`, `/api/v1/reports/*` (daily, managerial, revenue, purchases), `GET /api/v1/reports/export` **[NEEDS BACKEND ENDPOINT]**
**Roles**:
- Treasury/Audit: `system_admin`, `branch_manager`, `purchasing_manager`
- Reports: `system_admin`, `branch_manager`, `purchasing_manager`, `sales_manager`
**Independent Test**: Load treasury ledger, click reverse on transaction, confirm, and verify reversed ledger lines display. Verify reports filter by Date, Rep, Customer, Supplier.

- [x] T037 Write Playwright tests verifying ledger reversals and report filtration parameters in [frontend/tests/e2e/treasury.spec.ts](file:///d:/techno/frontend/tests/e2e/treasury.spec.ts)
- [x] T038 [US8] Implement Treasury ledger screen and reversal modals in [frontend/src/pages/Treasury.tsx](file:///d:/techno/frontend/src/pages/Treasury.tsx) (consumes `/api/v1/treasury/*`)
- [x] T039 [US8] Implement Audit log details view in [frontend/src/pages/Audit.tsx](file:///d:/techno/frontend/src/pages/Audit.tsx) (consumes `/api/v1/audit/`)
- [x] T040 [US8] Implement Reports dashboard with multi-filter headers in [frontend/src/pages/Reports.tsx](file:///d:/techno/frontend/src/pages/Reports.tsx) (consumes `/api/v1/reports/*` endpoints)
- [x] T041 [US8] **[BACKEND TASK]** Create backend endpoints for PDF and Excel reports generation and exports (`GET /api/v1/reports/export`)

**Checkpoint**: Treasury controls and reporting are complete.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Production packaging, updates checks, and stability testing

- [x] T042 [P] Configure electron-builder properties in [frontend/package.json](file:///d:/techno/frontend/package.json) for Windows EXE compilation
- [x] T043 Implement application version update checkers in [frontend/electron/main.ts](file:///d:/techno/frontend/electron/main.ts)
- [x] T044 Implement network disconnection overlay blocker in [frontend/src/components/AppLayout.tsx](file:///d:/techno/frontend/src/components/AppLayout.tsx)
- [ ] T045 Execute full Playwright E2E integration test suite

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - starts immediately.
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) - BLOCKS all user story views.
- **User Story 1 (P1)**: Depends on Foundational (Phase 2).
- **User Story 2 & 3 (P1)**: Depends on US1 (Login/Layout shell).
- **User Story 4 & 5 (P2)**: Depends on US2 (Org/Branches Setup) and US3 (Customers).
- **User Story 6 (P1)**: Depends on US3 (Customers), US4 (Catalog), and US5 (Stock/Warehouses).
- **User Story 7 (P3)**: Depends on US6 (Sales/Invoicing) for coupon validation.
- **User Story 8 (P2)**: Depends on US5 (Purchases) and US6 (Sales) to render ledger entries.
- **Polish (Phase 11)**: Depends on all User Story phases.

### Parallel Opportunities
- Foundational tasks T005, T006, T008, T009 can be built concurrently.
- User Story screens can be worked on in parallel by separate developers once Phase 2 completes:
  - Developer A: US2 (Users/Org) & US3 (Customers)
  - Developer B: US4 (Catalog/Suppliers) & US5 (Purchases/Manufacturing/Transfers)
  - Developer C: US6 (Sales Invoices & Returns)

---

## Parallel Example: Foundational Infrastructure

```bash
# Developer A sets up dynamic configurations:
Task: "Implement config.json loading via IPC context bridge in frontend/electron/main.ts and frontend/electron/preload.ts"

# Developer B sets up core styles:
Task: "Setup global index styles and Google Fonts Cairo font registration in frontend/src/index.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Setup (Phase 1)
2. Complete Foundational (Phase 2)
3. Complete User Story 1 (Login & Shell Foundation)
4. **STOP and VALIDATE**: Verify login token exchanges and routing menus render based on role JWT details.

### Incremental Delivery
1. Foundation Complete → Shell is ready.
2. User Story 1-3 Complete → Org setup, User roles, and Customer management is ready.
3. User Story 4-6 Complete → Catalog items, raw material purchases, transfers, and sales invoicing is ready. (Functional Sales MVP).
4. User Story 7-8 Complete → Loyalty programs, treasury audits, and managerial reports are ready.
