# ADR 0002: Manual Dashboard Local Data Export & Test Provenance (Dedicated Read-Only Excel .xlsx Export)

## Status

Accepted (Dedicated Read-Only Excel `.xlsx` export; PDF and Text exports deprecated and removed)

## Context

The Manual Dashboard v2 provides live monitoring and manual control across 8 testbench controllers. Operators need to capture and export the complete operational state of the testbench front panel to local files for quality assurance, physical test certification, offline engineering analysis, and maintenance records.

A single dedicated export format is standardized:
1. **Read-Only Excel Workbook (.xlsx)**: A structured, protected Excel workbook with a consolidated single-worksheet layout named `"data"`, auto-filters, frozen panes, and 3-state cell styling suitable for inspection, plotting, filtering, and direct printing or conversion to PDF via spreadsheet tools.

Additionally, test reports require complete traceability. Every export records:
- **MPCS Serial Number**: The serial number of the unit under test.
- **Locomotive Number**: The locomotive number to which the MPCS belongs.
- **Tested By**: The technician performing the test.
- **Tester ID**: The technician's unique identification badge/number.

We evaluated report document formats for Manual Dashboard telemetry and provenance:
- **Option A: Static PDF Export (`webContents.printToPDF`)**:
  - *Trade-offs*: Generates static documents, but raw tabular telemetry data cannot be sorted, filtered, analyzed with formulas, or plotted in analytical software. Deprecated and removed in favor of Excel.
- **Option B: Plain Text / ASCII Matrix (.txt) Export**:
  - *Trade-offs*: Terminal-friendly, but limited formatting, lacks multi-sheet organization, lacks formulas and data filtering. Deprecated and removed to unify export workflows.
- **Option C: Structured Read-Only Excel (.xlsx) via `exceljs` (Chosen)**:
  - *Trade-offs*: Pure JavaScript library with zero native binary compilation overhead, provides a consolidated single-sheet workbook (`data`) uniting Test Provenance identification (Rows 1–9) and Telemetry Matrix (Row 11 onwards), frozen header/time panes (`xSplit: 1, ySplit: 11`), auto-filtering, 3-state digital color formatting, and sheet protection (`worksheet.protect('aics_readonly')`) to ensure data integrity while allowing operators to inspect, filter, chart, or print/export to PDF from Excel.

We evaluated persistence options for test metadata:
- **Option A: Transient Modal Inputs (no persistence)**:
  - *Trade-offs*: Forces operators to re-type all four fields on every export, slowing down repetitive tests across a shift.
- **Option B: Client-side `localStorage`**:
  - *Trade-offs*: Isolated to renderer, cleared on cache wipe, and unavailable to backend automated workflows.
- **Option C: SQLite Persistence in `manual_test_metadata` table (Chosen)**:
  - *Trade-offs*: Retains provenance data across application restarts in the central database, pre-populates modal forms, and maintains single-source-of-truth consistency.

## Decision

1. **ExcelJS Read-Only Workbook Generation (`.xlsx`)**:
   - Telemetry and snapshot data are compiled into an ExcelJS `Workbook` structured into a single worksheet named `"data"`:
     - **Top Section (Rows 1–9): 2-Column Test Provenance & Identification**:
       - Row 1: Merged title banner spanning strictly till Column S (19 columns / `A1:S1`): `MPCS TESTBENCH - MANUAL DASHBOARD V2 TELEMETRY REPORT` with dark navy fill (`#0B2545`), bold white text, centered alignment, and light borders across all merged banner cells (Columns T onwards remain unmerged and default).
       - Rows 2–9: Strict 2-column key-value identification layout occupying Columns A & B exclusively:
         - Row 2: Col A: `MPCS Serial Number` | Col B: `<serial>`
         - Row 3: Col A: `LOCO Number` | Col B: `<loco>`
         - Row 4: Col A: `Tested By` | Col B: `<name>`
         - Row 5: Col A: `Tester ID` | Col B: `<id>`
         - Row 6: Col A: `Date & Time` | Col B: `<date>`
         - Row 7: Col A: `Test Duration` | Col B: `<duration>`
         - Row 8: Col A: `Report Type` | Col B: `<Snapshot / Recording>`
         - Row 9: Col A: `System Status` | Col B: `<status>` (`NORMAL / PASS` or `FAULT DETECTED`)
       - Col A is styled with subtle gray fill (`#F8FAFC`), bold text, and light borders; Col B is styled with clean white fill, regular text, and status badge color accents. Columns C onwards remain entirely blank in Rows 2–10.
       - Row 10: Blank row separator (height: `15` pt).
     - **Bottom Section (Row 11 onwards): Telemetry Matrix Table**:
       - Multi-channel sample matrix with frozen header row (Row 11) and elapsed time column (`views = [{ state: 'frozen', xSplit: 1, ySplit: 11 }]`).
       - Auto-filter enabled across all channels on Row 11 (`{ from: { row: 11, column: 1 }, to: { row: 11, column: matrixColumns.length } }`).
       - Column width optimizations: Column A (`Time (Elapsed)`) set to width `22`, Column B (`Local Time`) set to width `26`, `4` for DI/DO channels, `4.5` for Enable control channels, and `8` for Analog channels.
       - Header row height is set to `100` pt with `textRotation: 90` vertical top-aligned orientation (`alignment: { textRotation: 90, vertical: 'top', horizontal: 'center', wrapText: false }`) for digital, enable, and analog signal headers to maximize vertical legibility, alongside center/middle-aligned time column headers (`alignment: { vertical: 'middle', horizontal: 'center', wrapText: true }`).
       - Data rows populated starting at Row 12 with 3-state cell styling (`H`: soft green `#ECFDF5` / `#059669`, `L`: light gray `#FAFBFC` / `#9CA3AF`, `' '`: blank for offline) and numeric format for analog channels.
       - Initial Sample 0 baseline captured immediately at t = `00:00:00` from live polling cache so initial states are fully populated.
   - The worksheet is locked with read-only sheet protection (`worksheet.protect('aics_readonly', { selectLockedCells: true, selectUnlockedCells: true })`) preventing accidental cell modification while preserving full cell selection, filter inspection, and chart plotting capabilities.

2. **3-State Digital Signal Representation**:
   - `'H'` = High / Active (`1` / ON)
   - `'L'` = Low / Inactive (`0` / OFF)
   - `' '` = Disconnected / Unknown / Offline / Standby (blank)

3. **Native Save Dialogs**:
   - `dialog.showSaveDialog` in the Main Process manages file destination selection with default filenames prefilled with test metadata and timestamps: `MPCS_<serial>_LOCO_<loco>_YYYYMMDD_HHMMSS.xlsx`.

4. **In-App Provenance Modal & 1 Hz SQLite Recording Engine**:
   - An in-app modal captures MPCS Serial Number, LOCO Number, Tested By, and Tester ID before initiating a test recording session.
   - Metadata is saved to SQLite (`manual_test_metadata`) table on submission, pre-filling future exports.
   - During active recording sessions (`Start Recording` / `Stop Recording`), the system captures a 1 Hz snapshot of all 205 indicators and commits 1 row per second to `manual_recording_samples` with a parent `manual_recording_sessions` record.
   - Crash resilient: If power or process terminates mid-test, samples are preserved on disk.

5. **UI & IPC Export Integration**:
   - The toolbar header provides a dedicated action button: **[ 📊 Save Snapshot as Excel ]**.
   - The post-recording completion modal provides: **[ 📊 Export as Excel (.xlsx) ]**.
   - `preload.js` exposes `window.electronAPI.exportExcel(payload)` and `window.api.saveDashboardDataAsExcel(params)`.
   - `main.js` handles `dashboard:saveExcel` and `export-excel` IPC events, opens native save dialog with `.xlsx` filters, and streams out the binary Excel buffer.

## Consequences

- Dedicated export to protected Excel workbooks allows railway engineers to perform detailed post-test analytical filtering, data plotting, and formula evaluation.
- Sheet protection ensures test integrity and prevents accidental tampering with verified field test results.
- Clean and focused codebase with removal of obsolete PDF and ASCII text export generators and IPC channels.
- Zero reliance on external headless browser dependencies or Chromium PDF rendering timing quirks.
- Seamless traceability and formal sign-off workflow across all exported manual test files.
- Resilient error and cancellation handling via asynchronous IPC.

