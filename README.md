# IAV Dashboard

A **Next.js 16 App Router** financial dashboard that processes a master Excel workbook and produces a full P&L statement with per-channel breakdowns for **Amazon, Flipkart, Meesho, Myntra, IAV_IN, Bulk Domestic, Showroom, IAV_COM, and Bulk Export**.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [File System Map](#file-system-map)
3. [Excel Workbook — Required Sheets & Columns](#excel-workbook--required-sheets--columns)
4. [Data Flow — End to End](#data-flow--end-to-end)
5. [Processor Pipeline](#processor-pipeline)
6. [API Routes](#api-routes)
7. [Database Models](#database-models)
8. [Store (State Management)](#store-state-management)
9. [Dashboard Pages](#dashboard-pages)
10. [Environment Variables](#environment-variables)
11. [Running Locally](#running-locally)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (light-mode only) |
| State | Zustand |
| Database | MongoDB via Mongoose |
| Excel Parsing | SheetJS (xlsx) |
| Charts | Recharts |

---

## File System Map

```
iav-dashboard/
│
├── app/                            # Next.js App Router pages & API
│   ├── globals.css                 # Global styles (light mode, Tailwind)
│   ├── layout.tsx                  # Root HTML layout (Geist font)
│   ├── page.tsx                    # Root redirect → /upload
│   │
│   ├── upload/
│   │   ├── page.tsx                # Upload UI page (drag & drop + submit)
│   │   └── actions.ts              # Server Action: reads file, calls buildPL()
│   │
│   ├── dashboard/
│   │   ├── layout.tsx              # Shared layout: sticky DashboardNav + Suspense
│   │   ├── page.tsx                # Dashboard home: KPI cards, donut chart, nav grid
│   │   ├── pl/page.tsx             # Full P&L table (all channels)
│   │   ├── monthwise/page.tsx      # Month-by-month Amazon P&L
│   │   ├── statewise/page.tsx      # Amazon statewise breakdown table
│   │   ├── orders/page.tsx         # Order flow only (Gross→Net Sales per channel)
│   │   ├── expenses/page.tsx       # Expense sheet with allocation basis
│   │   ├── comparative/page.tsx    # Full P&L in section-grouped table
│   │   └── kpi/page.tsx            # % KPI sheet: GP%, Exp%, NP% per channel
│   │
│   └── api/
│       ├── pl/route.ts             # GET /api/pl?uploadId=  → PLOutput from DB
│       ├── uploads/route.ts        # GET /api/uploads       → last 20 uploads list
│       ├── upload/route.ts         # POST /api/upload       → lookup upload by ID
│       ├── monthwise/route.ts      # GET /api/monthwise?uploadId= → monthly rows
│       └── statewise/route.ts      # GET /api/statewise?uploadId= → statewise rows
│
├── components/
│   ├── ErrorBoundary.tsx           # React error boundary wrapper
│   │
│   ├── dashboard/
│   │   ├── DashboardNav.tsx        # Sticky top nav bar (← Dashboard | P&L | … | KPI)
│   │   ├── ChannelTable.tsx        # Reusable sectioned P&L table (Orders & Comparative)
│   │   ├── KpiCards.tsx            # Summary KPI card component
│   │   ├── MonthlyChart.tsx        # Line/bar chart for monthwise data
│   │   └── StatewiseMap.tsx        # Table of Amazon statewise P&L rows
│   │
│   └── upload/
│       ├── FileDropzone.tsx        # Drag-and-drop Excel file picker
│       └── SheetMapper.tsx         # Sheet detection display
│
├── lib/
│   ├── constants.ts                # CHANNELS array, BUSY_ACCOUNT_TO_CHANNEL map, states list
│   ├── types.ts                    # All TypeScript interfaces (see below)
│   │
│   ├── db/
│   │   ├── connection.ts           # Mongoose singleton connection (hot-reload safe)
│   │   ├── index.ts                # Re-exports connectDB + all models
│   │   └── models/
│   │       ├── Upload.ts           # MongoDB Upload document schema
│   │       ├── PLResult.ts         # MongoDB PLResult document schema
│   │       ├── MonthlyData.ts      # MongoDB MonthlyData document schema
│   │       └── StatewiseData.ts    # MongoDB StatewiseData document schema
│   │
│   ├── processors/
│   │   ├── plBuilder.ts            # MAIN ORCHESTRATOR — calls all processors, builds PLOutput, saves to DB
│   │   ├── amazonProcessor.ts      # Reads Amazon B2B/B2C/Cancel/Payment sheets → AmazonSummary + AmazonFees
│   │   ├── flipkartProcessor.ts    # Reads Flipkart Sales + Cashback sheets → FlipkartSummary
│   │   ├── iavInProcessor.ts       # Reads IAV Tally GST + Statewise Sale sheets → IAV_IN / IAV_COM / MYNTRA
│   │   ├── salesBusyProcessor.ts   # Reads SALES BUSY + PURCHASE LEDGER + STOCK VALUE sheets → channel sales + purchases
│   │   └── expenseAllocator.ts     # Reads EXP SHEET → ExpenseRow[] with per-channel allocations
│   │
│   └── utils/
│       ├── formatter.ts            # formatIndianCurrency, formatIndianNumber, formatPercentage
│       ├── parser.ts               # readSheet, readTripleHeaderSheet, parseDate, safeNum, cleanFlipkartSKU
│       └── plRows.ts               # plOutputToSections (Comparative), plOutputToOrderRows (Orders), plOutputToRows (flat)
│
├── store/
│   ├── outputStore.ts              # Zustand: uploadId, month, cachedPL, processingErrors
│   └── rawDataStore.ts             # Zustand: workbook, fileName, isProcessing, error
│
├── next.config.ts                  # Next.js config (React Compiler, serverActions bodySizeLimit: 10MB)
├── tailwind.config.ts              # Tailwind config
├── tsconfig.json                   # TypeScript config
└── package.json
```

---

## Excel Workbook — Required Sheets & Columns

The dashboard expects a **single master .xlsx workbook** with the sheets listed below. All sheets use a **triple-header row** structure (row 1 = merged column headers, row 2 = TRUE filter row, row 3 = real field headers, row 4+ = data) unless marked otherwise.

---

### `AMAZON B2C MAIN SHEET` & `AMAZON B2B MAIN SHEET`
**Parser:** `amazonProcessor.ts → parseMainRows()`

| Column | Description |
|---|---|
| Col 0 | Transaction Type (`Shipment` / `Refund`) |
| Order Id | Amazon order ID |
| Shipment Id | Shipment reference |
| Shipment Date / Invoice Date | Date of shipment |
| Order Date | Date of order |
| Quantity Purchased | Units sold |
| SKU | Seller SKU |
| Col 21 (fixed) | Ship To State (used for statewise breakdown) |
| Invoice Amount | Gross invoice value (₹) |
| Tax Exclusive Gross | Taxable value |
| IGST Amount | IGST tax |
| CGST Amount | CGST tax |
| SGST Amount | SGST tax |
| Shipping Amount | Shipping credits received |
| Item Promo Discount | Promotional discount applied |

---

### `AMAZON B2C CANCEL SHEET` & `AMAZON B2B CANCEL SHEET`
**Parser:** `amazonProcessor.ts → parseCancelRows()`

Same columns as MAIN SHEET, plus:

| Column | Description |
|---|---|
| Per Pcs Rate | Per-unit rate used to calculate cancellation value (qty × rate) |

---

### `AMAZON PAYMENT SHEET`
**Parser:** `amazonProcessor.ts → parsePaymentRows()`

| Column | Description |
|---|---|
| Date/Time | Transaction date |
| Type | Transaction type |
| Order ID | Amazon order reference |
| SKU | Product SKU |
| Description | Fee category description |
| Product Sales | Sale amount |
| Shipping Credits | Shipping income |
| Promo Rebates | Promotional rebates |
| Selling Fees | Amazon commission |
| FBA Fees | Fulfilment fees |
| Other | Miscellaneous fees |
| Total | Net settlement amount |

> **Used for:** Amazon fee breakdown (commission, FBA, ads, storage fees).

---

### `AMAZON MERGER SKU SHEET v2`
**Parser:** `amazonProcessor.ts`

Used to merge/de-duplicate SKU data across B2B and B2C sheets.

---

### `Flipkart Sales Report Main ` *(trailing space intentional)*
**Parser:** `flipkartProcessor.ts → parseSalesRows()`

| Column | Description |
|---|---|
| Event Type | `Sale` / `Return` / `Cancellation` / `Return Cancellation` |
| Order ID | Flipkart order reference |
| Order Item ID | Line-item ID |
| Order Date | Transaction date |
| SKU | SKU (triple-quoted, stripped by `cleanFlipkartSKU`) |
| Customer's Delivery State | Delivery state |
| Seller's Share | Net amount received by seller |
| Final Invoice Amount | Gross invoice to customer |
| IGST / CGST / SGST Amount | Tax breakdown |
| TCS Total | TCS deducted |

---

### `Flipkart Cash Back Report Main ` *(trailing space intentional)*
**Parser:** `flipkartProcessor.ts → parseCashbackRows()`

| Column | Description |
|---|---|
| Order ID | Flipkart order reference |
| Document Type | `Credit Note` / `Debit Note` |
| Document Sub Type | `Sale` / `Return` |
| Invoice Amount | Gross amount |
| Taxable Value | Tax-exclusive value |
| Customer's Delivery State | Delivery state |

---

### `Export-Tally GST Report-indiana`
**Parser:** `iavInProcessor.ts → parseTallySheet()`

| Column | Description |
|---|---|
| Currency | `INR` or `USD` (USD rows → IAV_COM channel) |
| Channel Ledger | Ledger name (e.g. `INDIANARTVILLA INDIA`, `MYNTRAPPMP`) |
| Voucher Type Name | `Sales`, `Credit Note`, etc. |
| Ship To State | Delivery state |
| Total / Invoice Amount | Invoice total |

> **Channel classification logic:**
> - `MYNTRAPPMP` / starts with `MYNTRA` → **MYNTRA**
> - Currency = `USD` → **IAV_COM**
> - Ledger = `INDIANARTVILLA INDIA` or `INDIANARTVILLA.IN` → **IAV_IN**
> - Currency = `INR` fallback → **IAV_IN**

---

### `SALES BUSY`
**Parser:** `salesBusyProcessor.ts → parseSalesBusyRows()`

Row structure: Row 0 = display headers, Row 1 = TRUE filter row, Row 2 = real headers, Row 3+ = data.

| Column | Description |
|---|---|
| Date | Transaction date |
| Revised Account | Channel name (mapped via `BUSY_ACCOUNT_TO_CHANNEL`) |
| Net Amount | Net sale amount |
| Debit(Rs.) | Debit entry amount |
| Credit(Rs.) | Credit entry amount |

> **Channel mapping (`constants.ts`):**
> `Amazon India` / `Amazon` → AMAZON · `Flipkart` → FLIPKART · `Meesho` → MEESHO · `Myntra` → MYNTRA · `IAV Website` / `IndianArtVilla.in` → IAV_IN · `Bulk Domestic` / `B2B Domestic` → BULK_DOMESTIC · `Showroom` → SHOWROOM · `IAV.com` / `IndianArtVilla.com` → IAV_COM · `Bulk Export` / `B2B Export` → BULK_EXPORT

---

### `PURCHASE LEDGER`
**Parser:** `salesBusyProcessor.ts → parsePurchaseRows()`

Same row structure as SALES BUSY.

| Column | Description |
|---|---|
| Revised Ledger | Ledger / supplier name |
| Type | Purchase type |
| Debit(Rs.) | Purchase debit amount (= purchases value) |

---

### `STOCK VALUE`
**Parser:** `salesBusyProcessor.ts`

| Column | Description |
|---|---|
| Opening Stock | Value of opening inventory |
| Closing Stock | Value of closing inventory |

---

### `EXP SHEET`
**Parser:** `expenseAllocator.ts → allocateExpenses()`

| Col Index | Description |
|---|---|
| 0 | S.No |
| 1 | Particulars (expense name) |
| 2 | Data Source |
| 3 | Total (Books) — total expense from accounts |
| 4 | Allocation Basis (`DIRECT` / `SALES RATIO` / `70%-30%` / `ONLY INDIANARTVILLA.IN` / `B2B FOR BULK & B2C WEBSITE`) |
| 5 | AMAZON allocated amount |
| 6 | FLIPKART allocated amount |
| 7 | MYNTRA allocated amount |
| 8 | IAV_IN allocated amount |
| 9 | BULK_DOMESTIC allocated amount |
| 10 | IAV_COM allocated amount |
| 11 | BULK_EXPORT allocated amount |

> **Allocation rules:**
> - `DIRECT` — use the pre-filled channel columns (5–11) as-is
> - `SALES RATIO` — split Total(Books) proportionally to each channel's Net Sales
> - `70%-30%` — 70% to AMAZON, 30% to IAV_IN
> - `ONLY INDIANARTVILLA.IN` — 100% to IAV_IN
> - `B2B FOR BULK & B2C WEBSITE` — col 9 → BULK_DOMESTIC, col 8 → IAV_IN

---

### `MONTHWISE AMAZON CONSO P&L`
**Parser:** `plBuilder.ts → parseMonthlySheet()`

| Row / Column | Description |
|---|---|
| Row index 2, cols 1+ | Month labels (e.g. `Jan-26`, `Feb-26`) |
| Row index 4+, col 0 | Row label (matched case-insensitively) |
| `Gross Sales` | Gross sales per month |
| `Cancellation` | Cancellations per month |
| `Courier Return` | Courier returns |
| `Customer Return` | Customer returns |
| `Shipping` | Shipping received |
| `Net Sales` | Net sales |
| `Commission` / `Selling Fee` | Amazon commission fees |
| `Advertisement` / `Ads` | Ad spend |
| `FBA` / `Fulfilment` | FBA/fulfilment fees |
| `Other Fee` | Miscellaneous fees |
| `Total Expense` | Total expenses row |
| `Net Earning` / `Net Profit` | Net earnings per month |

---

### `STATEWISE SALE`
**Parser:** `iavInProcessor.ts → parseStatewiseSaleSheet()`

Fixed column layout (0-indexed):

| Col Index | Description |
|---|---|
| 0 | Amazon State name |
| 1 | Amazon Gross Sales |
| 2 | Amazon Net Sales |
| 4 | Flipkart State name |
| 5 | Flipkart Gross Sales |
| 6 | Flipkart Net Sales |
| 8 | IAV.IN State name |
| 9 | IAV.IN Gross Sales |
| 10 | IAV.IN Net Sales |

---

## Data Flow — End to End

```
User drops .xlsx file
        │
        ▼
FileDropzone.tsx
  XLSX.read() → WorkBook object
  → rawDataStore: { workbook, fileName }
        │
        ▼
upload/page.tsx  (Submit button)
  FormData { file, fileName, month }
  → Server Action: processWorkbook()   [app/upload/actions.ts]
        │
        ▼
plBuilder.ts: buildPL(wb, fileName, month)
  ├── connectDB()
  ├── Upload.create()                  [status: 'processing']
  ├── processAmazon()        → AmazonSummary, AmazonFees, StatewisePL[]
  ├── processFlipkart()      → FlipkartSummary, FlipkartFees
  ├── processIavIn()         → netSales: { IAV_IN, IAV_COM, MYNTRA }
  ├── processSalesBusy()     → netSales: { MEESHO, BULK_DOMESTIC, SHOWROOM, BULK_EXPORT }
  ├── processPurchases()     → purchases value (all channels)
  ├── allocateExpenses()     → ExpenseRow[] per channel
  ├── Assemble PLOutput      (all PLRow fields with totals & percentages)
  ├── PLResult.create()      [stores full PLOutput JSON in MongoDB]
  ├── MonthlyData.create()   [stores monthly Amazon rows]
  ├── StatewiseData.create() [stores statewise rows]
  └── Upload.update()        [status: 'complete']
        │
        ▼
Return { uploadId, pl: PLOutput, errors[] }
        │
        ▼
upload/page.tsx
  outputStore.setUploadResult(uploadId, month, pl, errors)
  router.push('/dashboard')
        │
        ▼
dashboard/* pages
  useOutputStore()  → reads cachedPL (in-memory, instant render)
  if cachedPL null  → GET /api/pl?uploadId=  (re-fetch from MongoDB)
```

---

## Processor Pipeline

### `plBuilder.ts` (Orchestrator)
Calls all processors in sequence and assembles the final `PLOutput`. Each processor is wrapped in a try/catch — if it fails its channel contribution is zeroed and the processor name is added to `processingErrors[]`.

```
buildPL(wb, fileName, month)
  │
  ├─ amazonProcessor    → AMAZON channel: grossSales, cancellations, courierReturns,
  │                        customerReturns, shippingReceived, netSales + fees breakdown
  │
  ├─ flipkartProcessor  → FLIPKART channel: grossSales, cancellations, returns, netSales, fees
  │
  ├─ iavInProcessor     → IAV_IN + IAV_COM + MYNTRA: netSales (from Tally GST report)
  │
  ├─ salesBusyProcessor → MEESHO, BULK_DOMESTIC, SHOWROOM, BULK_EXPORT: netSales
  │                        ALL channels: purchases (from PURCHASE LEDGER)
  │                        Opening stock, Closing stock (from STOCK VALUE)
  │
  └─ expenseAllocator   → EXP SHEET: allocates each expense to channels
                           Produces totalDirectExp and totalAllocatedExp PLRows
```

### `amazonProcessor.ts`
1. Parses B2C + B2B MAIN SHEET (Shipment + Refund rows) via `parseMainRows()`
2. Parses B2C + B2B CANCEL SHEET (value = qty × perPcsRate) via `parseCancelRows()`
3. Parses AMAZON PAYMENT SHEET for fee breakdown via `parsePaymentRows()`
4. Returns `AmazonSummary`, `AmazonFees`, and `StatewisePL[]`

### `flipkartProcessor.ts`
1. Parses Flipkart Sales Report (Sales / Returns / Cancellations / Return Cancellations)
2. Parses Flipkart Cashback Report (Credit/Debit notes)
3. Returns `FlipkartSummary` and fee breakdown

### `iavInProcessor.ts`
1. Parses Tally GST export → classifies by ledger/currency to IAV_IN / IAV_COM / MYNTRA
2. Parses STATEWISE SALE sheet (cols 8–10) for IAV.IN per-state data
3. Returns net sales for IAV_IN, IAV_COM, MYNTRA channels

### `salesBusyProcessor.ts`
1. Parses SALES BUSY → maps ledger names (via `BUSY_ACCOUNT_TO_CHANNEL`) to channels
2. Parses PURCHASE LEDGER → total purchases
3. Parses STOCK VALUE → opening and closing stock

### `expenseAllocator.ts`
1. Reads EXP SHEET row by row
2. Applies allocation rule from column 4 to distribute total expense across channels
3. Returns `ExpenseRow[]` used to build `totalDirectExp` and `totalAllocatedExp`

---

## API Routes

| Route | Method | Input | Output |
|---|---|---|---|
| `/api/pl` | GET | `?uploadId=<id>` | `{ uploadId, month, data: PLOutput, processingErrors }` |
| `/api/uploads` | GET | — | `{ uploads: Upload[] }` (last 20, by date desc) |
| `/api/upload` | POST | `{ uploadId }` | `{ uploadId, status, month }` |
| `/api/monthwise` | GET | `?uploadId=<id>` | `{ uploadId, rows: MonthlyAmazonRow[] }` |
| `/api/statewise` | GET | `?uploadId=<id>` | `{ uploadId, rows: StatewisePL[] }` |

All routes use `connectDB()` and return `503` if MongoDB is unreachable.

---

## Database Models

### `Upload`
```
_id            ObjectId
fileName       string       original Excel filename
uploadedAt     Date         upload timestamp
month          string       reporting month ("Mar 2026")
status         enum         'processing' | 'complete' | 'error'
errorMessage   string?      set if status = 'error'
sheetsDetected string[]     workbook sheet names found
```

### `PLResult`
```
_id              ObjectId
uploadId         ObjectId   → ref: Upload._id
month            string
computedAt       Date
data             Mixed      full PLOutput JSON object
processingErrors string[]   processor names that threw errors
```

### `MonthlyData`
```
_id       ObjectId
uploadId  ObjectId  → ref: Upload._id
rows      MonthlyAmazonRow[]
```

### `StatewiseData`
```
_id       ObjectId
uploadId  ObjectId  → ref: Upload._id
rows      StatewisePL[]
```

---

## Store (State Management)

### `outputStore.ts`
Holds processed output in memory. Populated immediately after upload so dashboard pages render instantly without API round-trips.

| Field | Type | Description |
|---|---|---|
| `uploadId` | `string \| null` | MongoDB `_id` of the active upload |
| `month` | `string \| null` | Reporting month label |
| `cachedPL` | `PLOutput \| null` | Full P&L object in memory |
| `processingErrors` | `string[]` | Channels that failed during processing |
| `isFetching` | `boolean` | True while an API fetch is in flight |

Actions: `setUploadResult(uploadId, month, pl, errors)` · `setFetching(v)` · `clearOutput()`

### `rawDataStore.ts`
Holds the uploaded Excel workbook before processing.

| Field | Type | Description |
|---|---|---|
| `workbook` | `XLSX.WorkBook \| null` | Parsed workbook object |
| `fileName` | `string \| null` | Original file name |
| `uploadedAt` | `Date \| null` | When the file was loaded locally |
| `isProcessing` | `boolean` | True while `buildPL` is running |
| `error` | `string \| null` | Last error message |

---

## Dashboard Pages

| Route | Data Source | Description |
|---|---|---|
| `/dashboard` | `outputStore.cachedPL` | KPI summary cards, donut chart (Net Sales by channel), nav grid, recent uploads panel |
| `/dashboard/pl` | `outputStore` / `GET /api/pl` | Full P&L table — sticky row labels + 9 channel columns; sections: Revenue → COGS → Gross Profit → Expenses → Net Profit |
| `/dashboard/monthwise` | `GET /api/monthwise` | Month-by-month Amazon P&L chart and table |
| `/dashboard/statewise` | `GET /api/statewise` | Amazon state-level: Gross Sales, Net Sales, Expenses, Net Earnings per state |
| `/dashboard/orders` | `outputStore.cachedPL` | Order flow only: Gross Sales → Cancellations → Returns → Shipping Received → Net Sales |
| `/dashboard/expenses` | `outputStore.cachedPL` | All expense rows with Total (Books) and Allocation Basis |
| `/dashboard/comparative` | `outputStore.cachedPL` | Full sectioned P&L (Revenue / COGS / Gross Profit / Expenses / Net Profit) across all channels |
| `/dashboard/kpi` | `outputStore` / `GET /api/pl` | GP%, TotalExp%, NP% per channel — bar charts + summary cards + detail table |

All pages share a **sticky top `DashboardNav`** rendered by `app/dashboard/layout.tsx`.

---

## Environment Variables

Create `.env.local` in the project root:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start development server (Turbopack)
npm run dev

# Build for production
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/upload`.

**Upload flow:**
1. Drop the master `.xlsx` workbook onto the upload page
2. Select the reporting month (auto-fills to current month)
3. Click **Process** — file is sent to the Server Action
4. On success, redirected to `/dashboard`
5. All sub-pages are accessible from the sticky nav bar at the top

- **Charts**: Recharts
- **File Parsing**: XLSX, PapaParse
- **Date Utilities**: date-fns

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
