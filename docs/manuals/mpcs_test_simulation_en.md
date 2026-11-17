# MPCS Test Simulation Manual (English Translation & Specification)

> **Source Document:** [`docs/manuals/MPCS TEST SIMULETION.xlsx`](docs/manuals/MPCS%20TEST%20SIMULETION.xlsx)  
> **Locomotive Target:** Indian Railways WAG-5 Electric Locomotive (Arno Rotary Converter + Vertical DBR Mode)  
> **MPCS Target Hardware:** Medha / Stesalit / Autometers Microprocessor Control System (conforming to RDSO MBFDS Specification `ELRS/SPEC/MPC-FDS/001`)  
> **Status:** Authoritative Reference Document for Action Sequence Engine & Automated Test Cases

---

## 1. Executive Summary & Document Overview

This document provides an English translation, technical specification, and implementation guide for the simulation routines detailed in [`docs/manuals/MPCS TEST SIMULETION.xlsx`](docs/manuals/MPCS%20TEST%20SIMULETION.xlsx).

The original spreadsheet documents the operational sequence and hardware interlocking required to simulate an Indian Railways electric locomotive on an automated testbench without tripping the microprocessor or sounding false alarms. It is structured into two primary sheets:

1. **Sheet 1 ("Sheet1")**:
   - **Critical Interlocking Gaps:** Identifies the three essential feedback conditions (`I-30`/`I-31` synchronization, `I-18` compressor feedback, and staggered blower airflow delays) needed to prevent nuisance tripping and fault hooters.
   - **Pre-Cab Activation Static Inputs:** Defines 21 digital input baseline presets (healthy safety relays, normal isolation switches, normal air pressure, tap changer at neutral notch 0).
   - **Step-by-Step Timed Simulation Sequence (Steps 1 to 10):** Covers Cab Activation, Pantograph Raising, Arno Starting, DJ Closing, Staggered Blower Acceleration, Traction Mode Arming, Notch-1 Load Progression, Vigilance Control Device (VCD) testing with penalty brake evaluation, and REMELOT/LDMS wireless fault telemetry transmission.
   - **Comprehensive Hardware Wiring Specification:** Documents exact Card, Pin, and Ferrule terminal allocations conforming to RDSO Chapter 11 / Annexure-I.

2. **Sheet 2 ("Sheet2")**:
   - **Alternate Hardware Harness Mapping:** Provides secondary card/pin/ferrule allocations representing alternate backplanes or MPCS equipment revisions (e.g., Medha V3 vs. Stesalit/Autometers V2).
   - **Combined Digital + Analog Simulation Sequence:** Explicitly defines analog potentiometer setpoints synchronized with the digital actions, including Control Battery Voltage (110 V DC), 25 kV Catenary OHE, 380 V AC Auxiliary Transformer Winding, 380 V AC Arno Generation Bus, and Traction Motor Armature Voltage (100 V DC to 750 V DC).

---

## 2. Critical Interlocks & Systemic Gaps (The Three Hidden Links)

*(Source: Sheet 1, Rows 5–9 | Original Hindi: "🔍 वे 3 छिपी हुई कड़ियाँ (Gaps) जो इस बार जोड़ी गई हैं:")*

Manual testbench operations frequently encounter unexpected circuit breaker tripping or audible fault warnings due to missing dynamic feedback. The source spreadsheet highlights three essential synchronization links:

### 2.1 Gap 1: Master Controller & Reverser / CTF Synchronization (`I-30` & `I-31`)
- **Signal Identifiers:** `I-30` (`MP_RUN`) and `I-31` (`CTF_RUN`)
- **Technical Context:** When progressing from Notch 0 to Notch 1 in Traction Mode, the MPCS firmware verifies that the Master Controller handle has engaged the "Run" position and that the pneumatic Reverser and Traction/Braking Changeover drum (`CTF`) have physically rotated and locked into the "Traction" position.
- **Interlock Rule:** Before pulsing Notch Up (`I-26`), both `I-30` and `I-31` must be driven **High (+110V DC)**. If these inputs remain Low or floating, the MPCS inhibits line contactors (`L1`–`L6`) and rejects the notch command.
- **Original Hindi Reference:**
  > *"1. I-30 [MP_RUN] और I-31 [CTF_RUN] का तालमेल: जब गाड़ी को 1 नॉच पर बढ़ाया जाता है (ट्रेक्शन मोड), तो MPCS को यह बताना जरूरी है कि मास्टर कंट्रोलर का हैंडल 'Run' पर है और रिवर्सर/CTF ड्रम 'Traction' पोजीशन पर लॉक हो चुके हैं। इसके लिए I-30 और I-31 को नॉच लेने से पहले हाई करना पड़ता है।"*

### 2.2 Gap 2: Main Compressor Operating Feedback (`I-18`)
- **Signal Identifier:** `I-18` (`C101_3 FB` / Compressor Contactor Feedback)
- **Technical Context:** Immediately upon main circuit breaker (DJ) closure, the locomotive auxiliary circuit initiates the main air compressor contactors (`C101`, `C102`, `C103`) to charge the Main Reservoir (MR) air system.
- **Interlock Rule:** The testbench must assert `I-18` **High (+110V DC)** within the 4-second DJ closing window. If compressor feedback is omitted, the MPCS display registers an immediate **"MCP Fail"** fault condition and sounds an alarm hooter.
- **Original Hindi Reference:**
  > *"2. I-18 [C101_3 FB - कम्प्रेसर फीडबैक]: जैसे ही डीजे क्लोज होता है, लोको का मुख्य कम्प्रेसर चालू होता है। MPCS को इसके चालू होने का फीडबैक I-18 पर चाहिए होता है, नहीं तो स्क्रीन पर MCP Fail का हूटर बजने लगेगा।"*

### 2.3 Gap 3: Staggered Multi-Step Blower Feedback Timing (`Q118` Safety Timer)
- **Signal Identifiers:** `I-4` (`QVRH`), `I-2` (`QVMT1`), `I-3` (`QVMT2`)
- **Technical Context:** Auxiliary blower motors are started sequentially in stages to prevent excessive current surges on the rotary Arno converter / auxiliary transformer winding:
  1. Oil Cooler Blower Contactor (`C107`) starts first.
  2. Traction Motor Blower 1 Contactor (`C105`) starts after a 5-second delay.
  3. Traction Motor Blower 2 Contactor (`C106`) starts after an additional 5-second delay.
- **Interlock Rule:** Feedback from the air flow differential relays must be supplied in a staggered time sequence: `I-4` at +2 seconds, `I-2` at +5 seconds, and `I-3` at +8 seconds after DJ closure. If airflow confirmation is delayed beyond the **5.6-second `Q118` safety relay timer**, the MPCS trips the DJ breaker.
- **Original Hindi Reference:**
  > *"3. ब्लोअर फीडबैक की सही टाइमिंग (2-स्टेप ब्लोअर स्टार्टिंग): लोको में ब्लोअर एक साथ चालू नहीं होते। पहले तेल का ब्लोअर (C107) चालू होता है, उसके 5 सेकंड बाद ब्लोअर-1 (C105) और उसके 5 सेकंड बाद ब्लोअर-2 (C106) चालू होता है। टेस्ट बेंच पर हमें इसी 5-5 सेकंड के अंतर (Time Lag) से फीडबैक स्विच ऑन करने होंगे।"*

---

## 3. Sheet 1: Master Simulation Specification

### 3.1 Part 1: Pre-Boot Static Presets (Initial Testbench Conditions)
*(Source: Sheet 1, Rows 11–17 & Rows 78–105)*

Before applying +110V DC control power or activating Cab 1, the following toggle switches on the testbench front panel must be preset to **High (+110V DC)** or **Low (0V / Open)**. This satisfies initial boot diagnostics and avoids spurious trip codes.

| Signal Tag | Functional Name | Preset State | Hardware Card & Pin | Ferrule No. | Subsystem Function & Technical Purpose | Original Hindi Text |
| :--- | :--- | :---: | :--- | :---: | :--- | :--- |
| **I-80** | Loco Selection 1 | **High (110V)** | Card 4, Pin J | 256 | Selects **WAG-5 locomotive class** mode in MPCS firmware. | *लोको सिलेक्शन: I-80 = High (WAG-5 मोड)* |
| **I-81** | Loco Selection 2 | **Low (0V)** | Card 4, Pin L | - | Class selection bit 2. Must remain Low for WAG-5. | *बाकी [I-81 = Low]* |
| **I-82** | Loco Selection 3 | **Low (0V)** | Card 4, Pin M | - | Dedicated to Arno Converter logic when Low. | *I-82 = Low -> Arno कनवर्टर लॉजिक के लिए* |
| **I-83** | Loco Selection 4 | **Low (0V)** | Card 4, Pin N | - | Dedicated to Vertical DBR logic when Low. | *I-83 = Low -> Vertical DBR लॉजिक के लिए* |
| **I-17** | RGCP (Air Governor) | **High (110V)** | Card 1, Pin T | 074 | Simulates normal Main Reservoir (MR) pressure (8.5 to 10.0 kg/cm²). Prevents compressor cutout. | *I-17 (RGCP): MR प्रेशर सामान्य (8.5 to 10 kg/cm²) दिखाने के लिए* |
| **I-65** | QPDJ FB (DJ Governor) | **High (110V)** | Card 3, Pin T | 052 | Confirms adequate air pressure for DJ circuit breaker closing reservoir (>4.5 kg/cm²). | *I-65 (QPDJ FB): DJ गवर्नर प्रेशर पर्याप्त दिखाने के लिए* |
| **I-45** | RGEB (Emergency Brake Governor) | **High (110V)** | Card 2, Pin Y | 155 | Confirms Brake Pipe (BP) charged to 5.0 kg/cm²; prevents emergency brake interlock trip. | *I-45 (RGEB): BP प्रेशर चार्ज्ड (5 kg/cm²) दिखाने के लिए* |
| **I-19** | GR-0 (Tap Changer Notch 0) | **High (110V)** | Card 1, Pin W | 076 | Confirms graduator (tap changer) is at physical Notch '0' (neutral interlock for DJ closing). | *I-19 (GR-0): टैप चेंजर '0' नॉच पर है* |
| **I-20** | GR-0_31 (Graduator Lock) | **High (110V)** | Card 1, Pin X | 077 | Confirms graduator mechanism is physically locked on notch (not stuck between notches). | *I-20 (GR-0_31): ग्रैजुएटर सही स्थिति में लॉक है* |
| **I-49** | QOA / QSIT (Aux Earth Fault) | **High (110V)** | Card 3, Pin B | 045 | Normally closed contact; High indicates healthy auxiliary insulation (no earth fault). | *I-49 (QOA/QSIT): ऑक्सिलरी अर्थ फॉल्ट नहीं है* |
| **I-50** | QOP1 (Power Circuit 1 Earth Fault) | **High (110V)** | Card 3, Pin C | 046 | Power circuit 1 earth fault relay healthy interlock. | *I-50 (QOP1): पावर सर्किट 1 सामान्य है* |
| **I-51** | QOP2 (Power Circuit 2 Earth Fault) | **High (110V)** | Card 3, Pin D | 047 | Power circuit 2 earth fault relay healthy interlock. | *I-51 (QOP2): पावर सर्किट 2 सामान्य है* |
| **I-54** | QLM (HV Overcurrent Relay) | **High (110V)** | Card 3, Pin G | 050 | Transformer high-voltage primary overcurrent protection healthy interlock. | *I-54 (QLM): हाई वोल्टेज ओवर-करंट नहीं है* |
| **I-64** | QLA FB (Aux Overcurrent Relay) | **High (110V)** | Card 3, Pin S | 019 | Auxiliary winding circuit overcurrent protection healthy interlock. | *I-64 (QLA FB): ऑक्सिलरी सर्किट सामान्य है* |
| **I-60** | HMCS 1,2 (TM Cutout Switch) | **High (110V)** | Card 3, Pin N | 058 | Traction motor isolating cutout switch in normal operational position ('1'). | *I-60 (HMCS 1,2): TM कटर स्विच नॉर्मल पोजीशन '1' पर* |
| **I-62** | HMCS & QD (Wheel Slip Circuit) | **High (110V)** | Card 3, Pin R | 153 | Differential current (QD) / HMCS circuit healthy. | *I-62 (HMCS & QD): QD/HMCS सर्किट स्वस्थ है* |
| **I-7** | HVMT1_1 (TM Blower 1 Cutout) | **High (110V)** | Card 1, Pin H | 036 | Traction Motor Blower 1 isolating switch in normal position. | *I-7 (HVMT1_1): TM ब्लोअर 1 स्विच नॉर्मल* |
| **I-9** | HVMT2_1 (TM Blower 2 Cutout) | **High (110V)** | Card 1, Pin K | 038 | Traction Motor Blower 2 isolating switch in normal position. | *I-9 (HVMT2_1): TM ब्लोअर 2 स्विच नॉर्मल* |
| **I-11** | HVRH_1 (Rheostat Blower Cutout) | **High (110V)** | Card 1, Pin M | 040 | Dynamic braking resistance blower switch in normal position. | *I-11 (HVRH_1): रेसिस्टेंस ब्लोअर स्विच नॉर्मल* |
| **I-13** | QVSI1 / HVSI1 (Rectifier Blower 1) | **High (110V)** | Card 1, Pin P | 042 | Silicon Rectifier 1 air flow relay / switch normal. | *I-13 (QVSI1/HVSI1): रेक्टिफायर ब्लोअर 1 नॉर्मल* |
| **I-14** | QVSI2 / HVSI2 (Rectifier Blower 2) | **High (110V)** | Card 1, Pin R | 043 | Silicon Rectifier 2 air flow relay / switch normal. | *I-14 (QVSI2/HVSI2): रेक्टिफायर ब्लोअर 2 नॉर्मल* |

---

### 3.2 Part 2: Step-by-Step Live Timed Simulation Sequence

*(Source: Sheet 1, Rows 19–62 & Rows 107–162)*

```
[00:00] Step 1: Cab Activation (BL Key + BL1)
   │
   ▼
[00:05] Step 2: Pantograph Raise (ZPT) ──> O-2 / O-3 ON ──[Within 1s]──> Feedback I-63 High
   │
   ▼
[00:10] Step 3: BLDJ Switch ON ──> O-1 (C118 Starting Contactor) ON
   │
   ▼
[00:12] Step 4: Press BP1DJ (Hold 2s) ──> O-0 / O-4 (DJ Coil) ON
   │
   ▼
[00:14] Step 5: Critical 4-Second Window ──> Feedback: I-35 High + I-18 High
   │            (MPCS turns OFF O-1, extinguishes red LSDJ lamp, operator releases BP1DJ)
   ▼
[00:16-00:22] Step 6: Staggered Blower Feedbacks (Q118 Timer Protection)
   │            ├── +2s (00:16): I-4 (QVRH) High
   │            ├── +5s (00:19): I-2 (QVMT1) High
   │            └── +8s (00:22): I-3 (QVMT2) High (DJ fully sustained)
   ▼
[00:30] Step 7: Traction Mode Setup ──> I-27 (Reverser FOR), I-15 (BLVMT), I-30 (MP_RUN), I-31 (CTF_RUN)
   │
   ▼
[00:40] Step 8: Notch-1 Command (MP+) ──> O-14, O-26, O-27 ON ──[Within 1s]──> I-19 LOW, I-61 HIGH
   │            (Digital Notch Indicator displays '1')
   ▼
[01:40] Step 9: VCD Safety Cycle ──[60s elapsed]──> O-79 Warning + O-78 Buzzer ON
   │            └── Within 8s: Pulse I-126 (VCD Reset) [Else Penalty Emergency Brake at 68s]
   ▼
[Fault] Step 10: Fault Injection & REMELOT/LDMS Data Transmission
                Drop I-54 (QLM) ──> Instant DJ Trip ──> Remote telemetry buffer transmission
```

#### Detailed Step-by-Step Table (Sheet 1)

| Step # | Time / Offset | Step Description | Operator Input Action | Card, Pin & Ferrule | Expected MPCS Output / Relay Status | Dynamic Feedback / Interlock Required | Timing Constraints | Original Hindi Reference |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **1** | **00:00** | **Cab-1 Activation** | Set **`I-48`** (`BL Key`) = **High (110V)** and **`I-72`** (`BL1`) = **High (110V)** simultaneously. | Card 3, Pin A (F-142)<br>Card 4, Pin A (F-149) | MPCS boots up; Cab-1 becomes active; display backlight turns ON. Red `LSDJ` lamp (`O-28`) is illuminated. Display message: `WAG-5 "Ready / DJ Open"`. | Static inputs from Part 1 verified healthy. | Boot settle: ~2 s | *स्टेप 1: मुख्य बूट-अप और कैब सक्रिय करना (I-48 व I-72 High)* |
| **2** | **00:05** | **Pantograph Raising** | Set **`I-5`** (`ZPT1_2`) = **High (110V)** or **`I-6`** (`ZPT2_1`) = **High (110V)**. | Card 1, Pin F (F-030)<br>Card 1, Pin G (F-029) | MPCS immediately energizes Pantograph Electro-Valve output **`O-2`** (`VEPT1`) or **`O-3`** (`VEPT2`) LED (**High**). | **Immediate Feedback (< 1s):** As soon as `O-2`/`O-3` illuminates, drive **`I-63`** (`C118 N/C / QCON`) = **High (110V)** (Card 3, Pin T, Ferrule 018). | Window: **1.0 s** | *स्टेप 2: पेंटोग्राफ रेज़ (पेंटो उठाना - I-5 High) -> O-2 ON -> I-63 High* |
| **3** | **00:10** | **BLDJ Switch ON (Converter Starting)** | Set **`I-0`** (`BLDJ` / `BP1DJ`) = **High (110V)**. | Card 1, Pin A (F-021) | MPCS immediately energizes Starting Contactor output **`O-1`** (`C118 / BLSI`) LED (**High**) to engage the Arno split-phase starting resistance. | System awaits driver's DJ close command. | - | *स्टेप 3: BLDJ ऑन करना (कनवर्टर स्टार्टिंग फेज - I-0 High) -> O-1 ON* |
| **4** | **00:12** | **BP1DJ Closing Command** | Set **`I-1`** (`BP1DJ / BLRDJ`) = **High (110V)** and **hold for 2.0 seconds** (pushbutton action). | Card 1, Pin B (F-024) | MPCS immediately energizes main DJ closing and holding coils: outputs **`O-0`** and **`O-4`** (`DJ / VCB Coil`) turn **High**. | Initiates the critical 4-second closing window timer. | Pulse duration: **2.0 s** | *स्टेप 4: BP1DJ क्लोजिंग कमांड (डीजे लगाना - I-1 High 2 सेकंड तक)* |
| **5** | **00:14** *(+2s from BP1DJ)* | **Critical DJ Feedback Window** | Maintain testbench outputs while providing dynamic closing confirmations. | - | MPCS automatically de-energizes starting contactor **`O-1` (OFF)**; extinguishes red `LSDJ` lamp **`O-28` (OFF)**. Display updates to: **`"DJ CLOSED"`**. | **Triple Synchronous Feedback (< 4s of O-0):**<br>1. Set **`I-35`** (`DJ FB`) = **High (110V)** (Card 2, Pin M, F-105).<br>2. Maintain **`I-13`** & **`I-14`** = **High**.<br>3. Set **`I-18`** (`C101_3 FB`) = **High** (Card 1, Pin V, F-075).<br>*Operator now releases `I-1` (`BP1DJ`) back to Low.* | **Critical: < 4.0 s** after `O-0` ON | *स्टेप 5: ⚠️ सबसे महत्वपूर्ण टाइमिंग - DJ & कनवर्टर फीडबैक विंडो (I-35 High, I-18 High -> O-1 OFF, LSDJ OFF)* |
| **6a** | **00:16** *(DJ + 2s)* | **Blower Sequencing (Stage 1: Oil Cooler)** | Set **`I-4`** (`QVRH` - Transformer Oil Cooler Airflow Feedback) = **High (110V)**. | Card 1, Pin E (F-027) | MPCS verifies transformer oil cooler blower running. | Simulates contactor `C107` closed and oil pump/radiator fan established. | Delay: **+2.0 s** from DJ close | *डीजे क्लोज होने के ठीक 2 सेकंड बाद: I-4 (QVRH) High* |
| **6b** | **00:19** *(DJ + 5s)* | **Blower Sequencing (Stage 2: TM Blower 1)** | Set **`I-2`** (`QVMT1` - Traction Motor Blower 1 Airflow Feedback) = **High (110V)**. | Card 1, Pin C (F-025) | MPCS verifies MVMT1 blower running. | Simulates contactor `C105` closed and TM1-3 blower operating. | Delay: **+3.0 s** (total 5s) | *उसके ठीक 3 सेकंड बाद: I-2 (QVMT1) High* |
| **6c** | **00:22** *(DJ + 8s)* | **Blower Sequencing (Stage 3: TM Blower 2)** | Set **`I-3`** (`QVMT2` - Traction Motor Blower 2 Airflow Feedback) = **High (110V)**. | Card 1, Pin D (F-026) | DJ circuit breaker remains fully sustained (sustained hold). Display steady. | All auxiliary air flow relays verified. Satisfies internal **`Q118` 5.6-second safety timer**. | Delay: **+3.0 s** (total 8s) | *उसके ठीक 3 सेकंड बाद: I-3 (QVMT2) High -> डीजे पूरी तरह से स्थिर (Sustain)* |
| **7** | **00:30** | **Traction Mode & Reverser Setup** | 1. Set **`I-27`** (`MPJ FOR`) = **High (110V)**.<br>2. Set **`I-15`** (`BLVMT`) = **High (110V)**.<br>3. Set **`I-30`** (`MP_RUN`) and **`I-31`** (`CTF_RUN`) = **High (110V)**. | Card 1, Pin D (F-091)<br>Card 1, Pin S (F-070)<br>Card 1, Pin G (F-097)<br>Card 1, Pin H (F-100) | Output **`O-10`** (`J_FOR` / Reverser Forward) LED turns **High**. | Signals to MPCS that master controller is in 'RUN', blowers are engaged, and CTF changeover drums are locked in traction position. | Settle: ~1–2 s | *स्टेप 7: ट्रेक्शन मोड और दिशा (Reverser) सेट करना (I-27, I-15, I-30, I-31 High)* |
| **8** | **00:40** | **Notch-1 Progression & Load Feedback** | Pulse **`I-26`** (`MP+` Notch Up) **High for 1.0 second**, then release. | Card 1, Pin C (F-093) | Output **`O-14`** (`VE UP` coil) turns **High**.<br>Line contactor outputs **`O-26`** (`L1, L2, L3`) and **`O-27`** (`L4, L5, L6`) LEDs turn **High**. | **Mandatory Feedback (< 1s of contactors):**<br>1. Set **`I-19`** (`GR-0`) = **Low (0V)**.<br>2. Set **`I-61`** (`L1 to L6_FB`) = **High (110V)** (Card 3, Pin P, F-028).<br>*(Note: `I-20` remains High).* | **Critical: < 1.0 s** after `O-26`/`O-27` | *स्टेप 8: ⚠️ प्रथम नॉच (Notch-1) एवं लोड फीडबैक (I-26 पल्स -> I-19 Low, I-61 High)*<br>Display Notch Indicator shows **'1'**. If `I-61` delayed >1s, MPCS auto-regresses with *"Contactor Not Closed"* fault. |
| **9** | **00:40 to 01:48** | **Vigilance Control Device (VCD) Test** | **00:40 to 01:40 (60s):** Keep testbench completely idle (no button presses).<br>**01:40 to 01:48 (8s window):** Pulse **`I-126`** (`VCD RESET`) or **`I-123`** (`HORN`) High, then release. | Front Panel Pushbuttons | **At T = 60s (01:40):** Output **`O-79`** (`WARNING` LED) flashes and Output **`O-78`** (`BUZZER` hooter) sounds.<br>**Upon Reset Pulse:** `O-79` and `O-78` instantly turn **OFF**; VCD timer resets for another 60s. | **Penalty Brake Check:** If no reset occurs within 8s (at T = 68s), Output **`O-77`** (`EM VALVE`) energizes, initiating emergency penalty brake application and tripping the DJ (**`O-0` OFF**). | VCD Cycle: **60.0 s**<br>Reset Window: **8.0 s**<br>Penalty at: **68.0 s** | *स्टेप 9: VCD सर्किट टेस्ट (60 सेकंड बाद O-79 / O-78 ऑन -> 8 सेकंड में I-126 रीसेट, अन्यथा O-77 पेनल्टी ब्रेक)* |
| **10** | **On Demand** | **REMELOT / LDMS Fault Data Transfer** | Simulate a primary protective trip by switching any safety relay Low, e.g., set **`I-54`** (`QLM`) = **Low (0V)**. | Card 3, Pin G (F-050) | DJ trips instantaneously (**`O-0` de-energized**). Display shows: `FAULT: QLM Primary Overcurrent`. | MPCS internal data logger (REMELOT / LDMS) captures a fault telemetry buffer: **5.0 seconds pre-fault** and **3.0 seconds post-fault** analog/digital traces, attaching GPS coordinates, and transmits the data packet to central servers (LTMS). | Instantaneous trip | *स्टेप 10: REMELOT / LDMS डेटा ट्रांसफर टेस्ट (QLM Low -> डीजे ट्रिप -> 5s पूर्व / 3s पश्चात डेटा पैकेट सर्वर को सेंड)* |

---

## 4. Sheet 2: Combined Digital + Analog Potentiometer Simulation

*(Source: Sheet 2, Rows 6–70)*

Sheet 2 defines an enhanced multi-domain simulation routine where digital contactor operations are accompanied by continuous analog adjustments. This enables realistic evaluation of voltage-sensing relays, catenary undervoltage/overvoltage thresholds, auxiliary generation, and traction motor back-EMF.

### 4.1 DAQ Hardware Mapping Variations (Sheet 1 vs Sheet 2)

A comparison between Sheet 1 and Sheet 2 reveals hardware allocation differences reflecting different DAQ backplane layouts or MPCS manufacturer revisions (e.g., Medha V3 vs. Stesalit/Autometers V2):

| Signal Identifier | Functional Label | Ferrule No. | Sheet 1 Hardware Assignment | Sheet 2 Hardware Assignment | Subsystem Function |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **I-80** | Loco Selection 1 (WAG-5) | 256 | Card 4, Pin J | Card 4, Pin J | Locomotive class selection bit 1 |
| **I-17** | RGCP (Air Governor) | 074 | Card 1, Pin T | Card 2, Pin B | Main reservoir pressure healthy |
| **I-65** | QPDJ FB (DJ Governor) | 052 | Card 3, Pin T | Card 5, Pin B | DJ air reservoir pressure healthy |
| **I-45** | RGEB (BP Pressure) | 155 | Card 2, Pin Y | Card 3, Pin P | Brake pipe pressure healthy (5.0 kg/cm²) |
| **I-19** | GR-0 (Notch 0 Contact) | 076 | Card 1, Pin W | Card 2, Pin D | Tap changer notch 0 contact |
| **I-20** | GR-0_31 (GR Notch Lock) | 077 | Card 1, Pin X | Card 2, Pin E | Tap changer intermediate contact lock |
| **I-49** | QOA (Aux Earth Fault) | 045 | Card 3, Pin B | Card 4, Pin B | Auxiliary circuit insulation monitor |
| **I-50** | QOP1 (Power Circuit 1 Earth) | 046 | Card 3, Pin C | Card 4, Pin C | Power circuit 1 insulation monitor |
| **I-51** | QOP2 (Power Circuit 2 Earth) | 047 | Card 3, Pin D | Card 4, Pin D | Power circuit 2 insulation monitor |
| **I-54** | QLM (HV Primary Overcurrent) | 050 | Card 3, Pin G | Card 4, Pin G | Primary overcurrent relay contact |
| **I-64** | QLA FB (Aux Overcurrent) | 019 | Card 3, Pin S | Card 5, Pin A | Auxiliary overcurrent relay contact |
| **I-60** | HMCS 1,2 (TM Cutout) | 058 | Card 3, Pin N | Card 4, Pin N | Traction motor cut-out switch 1 & 2 |
| **I-62** | HMCS & QD | 153 | Card 3, Pin R | Card 4, Pin R | Wheel slip differential / cut-out |
| **I-48** | BL Key | 142 | Card 3, Pin A | Card 4, Pin A | Master cab activation lock |
| **I-72** | BL1 | 149 | Card 4, Pin A | Card 5, Pin J | Cab 1 activation switch |
| **I-63** | C118 N/C / QCON | 018 | Card 3, Pin T | Card 4, Pin S | Arno converter initial no-volt interlock |
| **I-35** | DJ FB (DJ Aux Contact) | 105 | Card 2, Pin M | Card 3, Pin D | Main circuit breaker auxiliary contact |
| **I-18** | C101_3 FB (Compressor) | 075 | Card 1, Pin V | Card 2, Pin C | Compressor contactor feedback |
| **I-30** | MP_RUN | 097 | Card 1, Pin G | Card 2, Pin R | Master controller run position |
| **I-31** | CTF_RUN | 100 | Card 1, Pin H | Card 2, Pin S | CTF drum in traction position |
| **I-27** | MPJ FOR | 091 | Card 1, Pin D | Card 2, Pin M | Reverser forward direction |
| **I-26** | MP+ | 093 | Card 1, Pin C | Card 2, Pin L | Notch progression push button |
| **I-61** | L1 to L6_FB | 028 | Card 3, Pin P | Card 4, Pin P | Line contactors auxiliary feedback |

---

### 4.2 Combined Digital + Analog Step-by-Step Sequence

*(Source: Sheet 2, Rows 29–64)*

```
[00:00] Step 1: Cab Activation ──> [00:01] Analog Action: Battery Voltage Pot = 110 V DC
   │
   ▼
[00:02-00:03] Step 2: Pantograph Raise (ZPT) ──> Output O-2 VEPT1 ON
   │            ├── Immediate Digital Feedback (< 1s): I-63 (C118 N/C) High
   │            └── [00:04] Analog Action: Catenary OHE Pot = 25 kV AC, Aux Winding Pot = 380 V AC
   ▼
[00:05] Step 3: BLDJ ON ──> Output O-1 (C118 Starting Contactor) ON
   │
   ▼
[00:07] Step 4: BP1DJ Press (Hold 2s) ──> Output O-0 / O-4 (DJ Coil) ON
   │
   ▼
[00:09] Step 5: Critical 4-Second DJ & Arno Window
   │            ├── Digital Feedback: I-35 High + I-18 High
   │            └── Analog Action: Arno Converter Voltage Pot = 380 V AC
   │            (MPCS turns OFF O-1, extinguishes red LSDJ lamp, confirms "DJ CLOSED")
   ▼
[Step 6] Blower Airflow Staggered Feedback (+2s, +5s, +8s) ──> Prevents Q118 Trip
   │
   ▼
[Step 7] Traction Mode & Direction ──> I-30 & I-31 High, I-27 High, I-15 High
   │
   ▼
[Step 8] Notch-1 Progression (MP+) ──> Line Contactors O-26 & O-27 ON
                ├── Digital Feedback (< 1s): I-19 LOW, I-61 HIGH
                └── Analog Action: Traction Motor Voltage Pot = 100 V DC (Ramp to 750 V DC)
```

#### Detailed Combined Sequence Table (Sheet 2)

| Step # | Time / Offset | Digital Action / Signal | Analog Potentiometer Adjustment | Physical Locomotive Parameter | Expected System Response | Critical Constraints & Notes | Original Hindi Reference |
| :---: | :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **00:00**<br>*(Analog at 00:01)* | Set **`I-48`** (`BL Key`) and **`I-72`** (`BL1`) = **High (110V)**. | Adjust **Battery Voltage Pot** to **110 V DC**. | Control Battery Bus (110V DC) | MPCS initializes; Cab-1 active; display reports: `WAG-5 "Ready / DJ Open"`. | Setting battery voltage to 110V DC immediately on boot prevents the battery undervoltage alarm (<90V DC). | *लोको ऑन होते ही सबसे पहले Battery Voltage Pot (नॉब) को घुमाकर 110 V DC पर सेट करें।* |
| **2** | **00:02 to 00:03**<br>*(Analog at 00:04)* | Set **`I-5`** (`ZPT1_2`) = **High (110V)**. | Adjust **OHE Catenary Voltage Pot** to **25 kV AC**.<br>Adjust **Auxiliary Winding Voltage Pot** to **380 V AC**. | Overhead Catenary (25 kV) & Main Transformer Aux Winding | Output **`O-2`** (`VEPT1`) lights up. MPCS detects catenary voltage present (>17.5 kV). | **Immediate Feedback (< 1s):** Drive **`I-63`** (`C118 N/C / QCON`) = **High (110V)** within 1s of `O-2`. Satisfies no-volt relay interlock. | *OHE Catenary Voltage Pot को 25 KV और Auxiliary Winding Voltage Pot को 380 V AC पर सेट कर दें।* |
| **3** | **00:05** | Set **`I-0`** (`BLDJ`) = **High (110V)**. | Maintain steady analog rails. | Auxiliary power bus | Output **`O-1`** (`C118 Starting Contactor`) turns **High**. | Arno starting resistance contactor engaged. | *MPCS तुरंत आउटपुट O-1 (C118 Starting Contactor) की LED ऑन कर देगा।* |
| **4** | **00:07** | Set **`I-1`** (`BP1DJ / BLRDJ`) = **High (110V)** and hold for 2.0 seconds. | Maintain steady analog rails. | DJ closing coil circuit | Outputs **`O-0`** and **`O-4`** (`DJ / VCB Coil`) turn **High**. | Starts 4-second closing window timer. | *I-1 वाले स्विच को High करें और 2 सेकंड तक लगातार दबाकर रखें।* |
| **5** | **00:09** *(within 4s)* | 1. Set **`I-35`** (`DJ FB`) = **High (110V)**.<br>2. Set **`I-18`** (`C101_3 FB`) = **High (110V)**. | Adjust **Arno Converter Voltage Pot** to **380 V AC**. | 3-Phase Rotary Arno Auxiliary Bus | Starting contactor **`O-1` (C118) turns OFF**.<br>Red `LSDJ` lamp turns OFF.<br>Screen displays: **`"DJ CLOSED"`**.<br>Release `I-1` (`BP1DJ`) to Low. | Setting Arno voltage to 380V AC simulates full acceleration. If Arno voltage or `I-35` is absent after 4s, DJ trips immediately. | *ठीक इसी समय Arno Converter Voltage Pot वाले नॉब को घुमाकर 380 V AC पर सेट कर दें।* |
| **6** | **DJ + 2s to +8s** | 1. +2s: Set **`I-4`** (`QVRH`) = **High**.<br>2. +5s: Set **`I-2`** (`QVMT1`) = **High**.<br>3. +8s: Set **`I-3`** (`QVMT2`) = **High**. | Maintain steady auxiliary voltages. | Airflow differential sensors across cooling radiators | DJ maintains closed state (sustains); display remains normal. | Prevents `Q118` safety relay trip (5.6s timeout). All blowers must confirm airflow in staggered sequence. | *ब्लोअर फीडबैक का टाइम-लैग: DJ क्लोज होने के 2s बाद I-4, 5s बाद I-2, 8s बाद I-3।* |
| **7** | **As Required** *(T = 00:30)* | 1. Set **`I-30`** (`MP_RUN`) and **`I-31`** (`CTF_RUN`) = **High**.<br>2. Set **`I-27`** (`MPJ FOR`) = **High**.<br>3. Set **`I-15`** (`BLVMT`) = **High**. | Maintain auxiliary levels. | Reverser drum & traction changeover switches | Output **`O-10`** (`J_FOR`) LED turns **High**. | Arms MPCS for notch progression. | *रनिंग मोड एक्टिवेशन: I-30 व I-31 High, रिवर्सर I-27 High, ब्लोअर I-15 High।* |
| **8** | **As Required** *(T = 00:40)* | 1. Pulse **`I-26`** (`MP+`) High for 1.0s.<br>2. Immediate Feedback (< 1s): Set **`I-19`** (`GR-0`) = **Low** and **`I-61`** (`L1 to L6_FB`) = **High**. | Adjust **Traction Motor Voltage Pot** to **100 V DC**. | Traction Motor Armature Voltage | Outputs **`O-14`** (`VE UP`), **`O-26`** (`L1-3`), and **`O-27`** (`L4-6`) turn **High**.<br>Digital Notch Indicator displays **'1'**. | Setting TM voltage pot to 100V DC simulates back-EMF / motor armature voltage at Notch 1. Can be ramped up to **750 V DC** on higher notches. | *जैसे ही गाड़ी 1 नॉच पर स्थिर हो, तुरंत Traction Motor Voltage Pot वाले नॉब को धीरे से घुमाकर 100 V DC पर सेट कर दें।* |

---

## 5. Domain Glossary & Locomotive Equipment Reference

This glossary maps the technical locomotive identifiers from the spreadsheet to their standard Indian Railways / RDSO equipment definitions:

| Acronym / Tag | French / Railway Nomenclature | Full Functional Name & Operational Role |
| :--- | :--- | :--- |
| **BL Key** | Boîte de Levier | Key-operated master switch activating driver's desk controls in Cab 1 or Cab 2. |
| **BLDJ** | Interrupteur de Commande DJ | Driver's desk toggle switch for commanding DJ (circuit breaker) closing. |
| **BP1DJ / BP2DJ** | Bouton Poussoir DJ | Spring-loaded push buttons on driver desk for closing (`BP1DJ`) and tripping (`BP2DJ`) the DJ. |
| **DJ / VCB** | Disjoncteur / Vacuum Circuit Breaker | Main high-voltage (25 kV) circuit breaker protecting locomotive primary transformer. |
| **LSDJ** | Lampe de Signalisation DJ | Red signal lamp on desk. Lit when DJ is OPEN; extinguished when DJ is CLOSED. |
| **ZPT / VEPT** | Commutateur / Electrovalve Pantographe | `ZPT`: Cab selector switch for raising front/rear pantograph.<br>`VEPT`: Solenoid valve admitting air to raise pantograph. |
| **Arno Converter** | Rotary Phase Converter | Rotary electromechanical machine converting single-phase 380V AC into 3-phase 380V AC to power auxiliary induction motors (compressors and blowers). |
| **C118** | Contacteur de Démarrage Arno | Arno starting contactor. Connects auxiliary starting split-phase resistance during Arno acceleration; drops out once up to speed. |
| **QCON** | Relais de Contrôle Arno | Arno voltage sensing relay. Confirms Arno generation before permitting auxiliary motor closing. |
| **RGCP** | Relais Governor Compressor Principal | Pressure governor switch monitoring Main Reservoir (MR) pressure. Cuts in at 8.5 kg/cm²; cuts out at 10.0 kg/cm². |
| **QPDJ** | Relais de Pression DJ | Pneumatic interlock switch ensuring minimum 4.5 kg/cm² control air pressure before permitting DJ closing. |
| **RGEB** | Relais Governor Emergency Brake | Pressure sensor on Brake Pipe (BP) line. Confirms pressure at 5.0 kg/cm²; detects emergency brake application. |
| **GR / Tap Changer** | Graduateur | Motor-driven 32-notch autotransformer selector switch controlling traction motor voltage: `GR-0` indicates physical notch 0. |
| **QOA** | Relais de Terre Auxiliaire | Earth fault relay protecting auxiliary 380V AC / 110V DC circuits. |
| **QOP1 / QOP2** | Relais de Terre Circuit Principal | Earth fault relays protecting traction motor power circuits 1 and 2. |
| **QLM** | Relais de Surcharge Haute Tension | Primary transformer high-voltage overcurrent protection relay. |
| **QLA** | Relais de Surcharge Auxiliaire | Auxiliary winding circuit overcurrent protection relay. |
| **HMCS 1, 2** | Commutateur Moteurs de Traction | Manual isolating switches allowing individual traction motor cut-out during faults. |
| **QD** | Relais Différentiel | Wheel slip detection relay comparing armature currents between motor pairs. |
| **QVRH** | Relais de Débit d'Air Résistance | Air flow sensing paddle switch for transformer oil cooler radiator blower. |
| **QVMT1 / QVMT2** | Relais de Débit d'Air Moteurs | Air flow sensing paddle switches for Traction Motor Blower 1 (`MVMT1`) and Blower 2 (`MVMT2`). |
| **QVSI1 / QVSI2** | Relais de Débit d'Air Redresseur | Air flow sensing paddle switches for Silicon Rectifier bridge cooling fans. |
| **C101, C102, C103** | Contacteurs Compresseur | Power contactors energizing the three main air compressor motors. |
| **C105, C106, C107** | Contacteurs Moteurs Auxiliaires | Auxiliary motor contactors for MVMT1 (`C105`), MVMT2 (`C106`), and Oil Cooler Blower (`C107`). |
| **Q118** | Relais Temporisé Auxiliaire | 5.6-second safety timer relay. Trips DJ if auxiliary airflow relays don't pick up within 5.6s after DJ close. |
| **MP / Master Controller** | Manipulateur Principal | Driver's throttle controller: `MP+` (notch up), `MP-` (notch down), `MP_RUN` (run position). |
| **MPJ** | Manipulateur de Marche (Reverser) | Direction selector handle: Forward (`FOR`), Reverse (`REV`), Neutral (`0`). |
| **CTF** | Commutateur Traction / Freinage | High-current motorized switch configuring motor circuits for Traction (`RUN`) or Rheostatic Braking (`BRK`). |
| **L1 to L6** | Contacteurs de Ligne | Electropneumatic line contactors connecting DC power from rectifiers to Traction Motors 1 through 6. |
| **VE UP / VE DN** | Electrovalves Graduateur | Solenoid valves controlling air cylinders that drive the graduator up or down by one notch. |
| **VCD** | Vigilance Control Device | Mandatory microprocessor safety system enforcing 60s driver alertness checks, 8s audiovisual warnings, and 68s penalty brake trips. |
| **REMELOT / LDMS** | Remote Monitoring & Data Management | Cellular/satellite wireless telemetry module recording pre-fault (5s) and post-fault (3s) crash buffer diagnostics to central servers. |

---

## 6. Engineering Implementation Rules for Automated Action Sequences

When implementing these routines into the testbench Sequence Engine (as documented in [`docs/CONTEXT.md`](docs/CONTEXT.md:10)), the following design rules must be enforced:

1. **Phase 0 Baseline Assertions (Pre-Test Sanity):**
   - The engine must write all 21 static preset digital inputs before commanding Cab Activation.
   - Any safety relay contact (`QOA`, `QOP1`, `QOP2`, `QLM`, `QLA`) remaining Low must abort the sequence immediately with a descriptive assertion failure before closing the DJ.

2. **Strict Watchdog Windows & Failure Thresholds:**
   - **DJ Feedback Watchdog:** `I-35` (`DJ FB`) and `I-18` (`C101_3 FB`) must be asserted within **4.0 seconds** of `O-0` going High. If this window lapses, the MPCS will drop `O-0` and the test step must be marked failed.
   - **Blower Staggered Timing:** The step engine must enforce staggered delays: `QVRH` (+2.0s), `QVMT1` (+5.0s), and `QVMT2` (+8.0s). The time delta between DJ closing and any individual blower feedback must not exceed the **5.6-second `Q118` safety timer threshold**.
   - **Line Contactor Feedback Delay:** Following the 1.0-second pulse on `I-26` (`MP+`), the engine must transition `I-19` to Low and `I-61` to High within **1.0 second** of `O-26`/`O-27` going active. If feedback is delayed beyond 1.0s, the MPCS initiates auto-regression and throws a *"Contactor Not Closed"* fault.

3. **Analog Channel Dynamic Orchestration:**
   - Analog channels must step in sync with digital state transitions:
     - Battery Voltage: Set to 110 V DC at `T = 00:01`.
     - Catenary OHE & Aux Winding: Set to 25 kV AC and 380 V AC at `T = 00:04`.
     - Arno Converter Voltage: Set to 380 V AC at `T = 00:09`.
     - Traction Motor Voltage: Set to 100 V DC upon Notch-1 engagement, ramping up to 750 V DC as notches advance.

4. **VCD Automated Verification & Fault Scenarios:**
   - **Nominal Pass Scenario:** Maintain 60 seconds of idle monitoring without control actuation. When `O-79` (Warning LED) and `O-78` (Buzzer) energize at 60s, assert a 1.0-second pulse on `I-126` (`VCD RESET`) within the 8.0-second warning window. Verify that `O-79` and `O-78` extinguish and DJ remains closed.
   - **Penalty Trip Scenario:** In a separate test case, allow the 8.0-second warning window to lapse without asserting `I-126`. Confirm that at `T = 68.0s`, `O-77` (`EM VALVE`) energizes, the emergency penalty brake applies, and the DJ breaker trips (`O-0` de-energizes).

5. **Fault Injection & REMELOT/LDMS Event Capture:**
   - Inject primary fault conditions by de-asserting `I-54` (`QLM`), `I-49` (`QOA`), or `I-50` (`QOP1`).
   - Validate that the DJ trips instantaneously and that the MPCS logs the fault event with a pre-fault buffer (5s) and post-fault buffer (3s).
