import openpyxl
from openpyxl.styles import Protection

path = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet_FIXED.xlsx"
wb = openpyxl.load_workbook(path)
password = "premium"

for ws in wb.worksheets:
    # Set protection for each cell
    for row in ws.iter_rows(min_row=1, max_row=120, max_col=20):
        for cell in row:
            is_formula = isinstance(cell.value, str) and str(cell.value).startswith("=")
            # Check if yellow input fill
            is_yellow = False
            try:
                rgb = cell.fill.start_color.rgb
                if rgb and "FFF9C4" in str(rgb).upper():
                    is_yellow = True
            except:
                pass
            if is_yellow:
                cell.protection = Protection(locked=False)
            elif is_formula:
                cell.protection = Protection(locked=True)
            else:
                # Keep headers locked, body unlocked for editing
                if cell.row == 1:
                    cell.protection = Protection(locked=True)
                else:
                    # If it's in first 5 tabs body, allow editing except formulas already handled
                    if not is_formula:
                        # For Instructions tab, only B15-B25 inputs unlocked, others?
                        if ws.title == "Instructions + Setup" and cell.column == 2 and 15 <= cell.row <= 25:
                            cell.protection = Protection(locked=False)
                        elif ws.title != "Instructions + Setup" and cell.row > 1:
                            # Allow editing data entry
                            cell.protection = Protection(locked=False)
                        else:
                            if ws.title == "Instructions + Setup":
                                cell.protection = Protection(locked=False) if cell.row > 14 else Protection(locked=True)

    # Set sheet protection minimal to avoid repair errors
    ws.protection.password = password
    ws.protection.sheet = True
    # Do NOT set other flags - keep defaults to avoid XML repair
    # Allow selecting locked and unlocked
    ws.protection.enable()

# Save locked
out_locked = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet_FIXED_LOCKED.xlsx"
wb.save(out_locked)
print(f"Saved locked: {out_locked}")

# Also save as main v3 (overwrite with protected version for final delivery)
out_main = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet_v3_FINAL.xlsx"
wb.save(out_main)
print(f"Saved final: {out_main}")

# Test load again
wb2 = openpyxl.load_workbook(out_locked)
print(f"Load test ok: {wb2.sheetnames}")
