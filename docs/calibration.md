# Calibration  

It should also have an ability to calibrate different parameters in any of the hardware device. 

there are many DAQ devices and each of them have different registers that will hold the calibration params.

Suppose there are n params, then for them there would be 3n calibration params. Here each params will have the following calibration params:
1. scaling factor 
2. offset term 
3. dead zone

these calibration params will be stored in holding registers.

Note:
holding registers are u16 data type. However, calibration params are f32. Hence, each calibration param will be written to 2 holding registers. However, each calibration param needs to be converted to an array of u16 and high and low part of f32 will be stored in different holding registers as per the DAQ device/instrument.

there are 4 ways to convert f32, 
1. Big-Endian (ABCD): High word first, high byte first.
2. Little-Endian (DCBA): Low word first, low byte first.
3. Big-Endian Byte Swap (BADC): High word first, low byte first.
4. Little-Endian Byte Swap (CDAB): Low word first, high byte first.

But the issue is that, each f32 may be split using different encoding. So for each calibration param we need to save:
1. conversion method 
2. address of high and low u16 (this has to be holding registers).

These details will be tracked directly in the **Signal Mapping Dictionary** rather than a separate database.

# Calibration dashboard 

This dashboard will have the following features:
1. Calibration parameters list panel: this has the capability to update, add or delete signals and their calibration mappings in the **Signal Mapping Dictionary**.
2. Calibration panel: This is the place where calibration of the parameter will be done using "calibration process".
3. Calibration History Panel: for a parameter, it would show previous calibrations value in a list. Clicking on an item of that list would fill the calibration params textbox. 

# Calibration process

1. Select a param from the calibration dashboard.
2. Zeroing: Set the scaling factor to 1.0f, offset term to 0.0f, and deadzone to 0.0f in the device.
3. Take data points from the user (there must be at least 2 data points).
4. Take a single manual `deadzone` value from the user.
5. Using linear curve fitting, calculate the line which best fits the data points to find the scaling factor (`m`) and offset (`c`).
6. Display the calculated `m` and `c` values in editable textboxes, allowing the user to manually override them if necessary.
7. Write the finalized scaling factor (`m`), offset term (`c`), and `deadzone` into the device.
8. Handshake: Write the key1 value and then write the key2 value to their respective device addresses to burn these calibration values into the device EEPROM.
9. Audit Logging: Upon successful handshake, save a record to the **Calibration Audit Log** in SQLite containing the timestamp, signal name, data points used, and the final `m`, `c`, and `deadzone` values.

