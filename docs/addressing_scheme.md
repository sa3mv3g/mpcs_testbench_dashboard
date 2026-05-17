When dealing with Modbus device registers in a continuous (or contiguous) format, the goal is usually to optimize communication efficiency. Reading or writing registers in a single, continuous block is significantly faster than sending multiple separate requests.

Here is a breakdown of how continuous register addressing works, data mapping, and a practical example.

---

## 1. The Core Concept of Continuous Addressing

In Modbus, registers are addressed using a 16-bit unsigned integer (0 to 65,535). When registers are arranged **continuously**, it means their logical addresses follow a strict sequential order ($N, N+1, N+2, \dots$) without any gaps.

This allows you to utilize Modbus function codes that accept a **Starting Address** and a **Quantity of Registers** to poll a massive block of data in a single request packet.

### Maximum Packet Limits

Because of the Modbus Protocol Data Unit (PDU) size limit (253 bytes), there is a cap on how many continuous registers you can request at once:

* **Discrete Inputs / Coils (1 bit per point):** Up to 2000 points per request.
* **Input / Holding Registers (16 bits / 2 bytes per register):** Up to 125 registers per request.

---

## 2. Standard Modbus Register Types & Memory Map

Modbus registers are typically divided into four blocks. In a continuous format, they are referenced either by their **Data Model Number** (5-digit or 6-digit addressing) or their raw **Protocol Address** (0-based offset).

| Register Type | Data Model Range (Ref) | Protocol Address (Hex) | Access Type |
| --- | --- | --- | --- |
| **Coils** | `00001 - 09999` | `0x0000 - 0x270E` | Read/Write (Boolean) |
| **Discrete Inputs** | `10001 - 19999` | `0x0000 - 0x270E` | Read Only (Boolean) |
| **Input Registers** | `30001 - 39999` | `0x0000 - 0x270E` | Read Only (16-bit Word) |
| **Holding Registers** | `40001 - 49999` | `0x0000 - 0x270E` | Read/Write (16-bit Word) |

> ⚠️ **The 0-Based vs. 1-Based Trap:**
> Data model addresses (like `40001`) are 1-based. However, when the Modbus request actually goes over the wire, it uses the 0-based **Protocol Address**. Therefore, Holding Register `40001` is requested using address `0x0000`, `40002` is `0x0001`, and so on.

---

## 3. Handling Multi-Register Data Types (32-bit & 64-bit)

While a single Modbus register is always 16 bits, modern devices often store larger data types across a continuous block of multiple registers.

* **32-bit Integers / Floats:** Occupies **2 continuous registers** (e.g., `40001` and `40002`).
* **64-bit Double Floats:** Occupies **4 continuous registers** (e.g., `40003` to `40006`).

### Example Continuous Map for a Power Meter

If a device organizes its data continuously, a block of Holding Registers might look like this:

| Starting Register | Quantity | Data Type | Description | Raw Protocol Address (Hex) |
| --- | --- | --- | --- | --- |
| `40001` | 2 | 32-bit Float | Voltage (Phase A) | `0x0000` & `0x0001` |
| `40003` | 2 | 32-bit Float | Current (Phase A) | `0x0002` & `0x0003` |
| `40005` | 2 | 32-bit Float | Active Power (kW) | `0x0004` & `0x0005` |
| `40007` | 1 | 16-bit Unsigned | Frequency (Hz) | `0x0006` |

To read all of this data at once, your Modbus Master would send a single **Function Code 03 (Read Holding Registers)** request with:

* **Starting Address:** `0x0000` (corresponds to `40001`)
* **Quantity:** `7` (registers total)

The device will respond with a single packet containing all 14 bytes of data, which you then parse on your master side.

---

## 4. Word Order and Byte Endianness

When reading multi-register continuous blocks, you must ensure your master application is configured for the correct **Byte Swapping** or **Word Swapping**. Because Modbus doesn't strictly define the order of 32-bit data, a continuous read of `40001` and `40002` could be interpreted in four different ways:

* **Big-Endian (ABCD):** High word first, high byte first.
* **Little-Endian (DCBA):** Low word first, low byte first.
* **Big-Endian Byte Swap (BADC):** High word first, low byte first.
* **Little-Endian Byte Swap (CDAB):** Low word first, high byte first (Very common for floats).

Are you looking to write a script (like Python/MinimalModbus) to poll a specific continuous range, or are you mapping out a custom register table for an embedded device?