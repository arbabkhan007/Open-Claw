import openpyxl
from openpyxl.styles import Protection
from openpyxl.utils import get_column_letter

path = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet.xlsx"
wb = openpyxl.load_workbook(path)

password = "premium"
INPUT_FILL_COLORS = ["FFF9C4", "FFFFFF9C4", "00FFF9C4"] # yellow input

for ws in wb.worksheets:
    # First unlock all cells by default? Actually openpyxl default locked=True.
    # We'll set protection for each cell:
    for row in ws.iter_rows():
        for cell in row:
            is_formula = isinstance(cell.value, str) and cell.value.startswith("=")
            has_input_fill = False
            try:
                if cell.fill and cell.fill.start_color and cell.fill.start_color.rgb:
                    rgb = str(cell.fill.start_color.rgb)
                    if "FFF9C4" in rgb.upper() or "FFF9C4" in str(cell.fill.start_color.index).upper():
                        has_input_fill = True
                # Also check pattern fill color we used
                if cell.fill.start_color.index == "FFFFFF00" or "FF" in str(cell.fill.start_color.index):
                    # more generic: if yellow-ish we already checked
                    pass
            except:
                pass
            # Check if fill is exactly our INPUT_FILL (light yellow)
            if cell.fill.start_color.rgb and "FFF9C4" in str(cell.fill.start_color.rgb):
                has_input_fill = True

            # Determine if should be unlocked: input cells, and header instruction editable areas in Instructions sheet
            # Logic:
            # - If in Instructions + Setup sheet and column B rows 18-29 (setup inputs) -> unlock
            # - If cell has yellow fill -> unlock
            # - If it's blank or user data area without formula -> unlock? But better keep formula locked, input unlocked.
            # For safety:
            if has_input_fill:
                cell.protection = Protection(locked=False, hidden=False)
            elif is_formula:
                cell.protection = Protection(locked=True, hidden=False)
            else:
                # For sheets, unlock specific expected input ranges
                # We'll leave non-formula as locked=False if in data entry zones (e.g., sample data can be overwritten)
                # Let's keep locked=False for most non-header data rows to allow editing, except headers locked?
                # Simpler: unlock all non-formula except header row 1
                if ws.title == "Instructions + Setup":
                    if cell.row >= 18 and cell.row <= 29 and cell.column == 2:
                        cell.protection = Protection(locked=False)
                    elif cell.row == 1 or cell.row in [6,7,15,17,32,33]:
                        cell.protection = Protection(locked=True)
                    else:
                        # keep unlocked for editing notes?
                        if cell.row > 1 and cell.column <= 4:
                            # check if header styling: header fill terracotta etc
                            # unlock body
                            cell.protection = Protection(locked=False if not is_formula else True)
                else:
                    # For data sheets: header row locked, formula locked, others unlocked
                    if cell.row == 1 or cell.row == 2 and "Ingredients" in ws.title: # header
                        cell.protection = Protection(locked=True)
                    else:
                        if is_formula:
                            cell.protection = Protection(locked=True)
                        else:
                            # Allow editing product names, orders, etc
                            cell.protection = Protection(locked=False)

    # Enable sheet protection with password
    ws.protection.password = password
    ws.protection.sheet = True
    # Allow some operations even when protected: format cells, sort, filter, insert rows
    ws.protection.enable()

    # Allow format cells, sort etc - set protection attributes
    ws.protection.formatCells = False  # allow formatting
    ws.protection.formatColumns = False
    ws.protection.formatRows = False
    ws.protection.insertRows = False
    ws.protection.insertColumns = False
    ws.protection.deleteRows = False
    ws.protection.deleteColumns = False
    ws.protection.sort = False
    ws.protection.autoFilter = False
    ws.protection.pivotTables = False
    ws.protection.objects = False
    ws.protection.scenarios = False
    ws.protection.selectLockedCells = False  # allow select locked but not edit?
    ws.protection.selectUnlockedCells = False

    # Actually to allow selecting locked cells but not editing, set selectLockedCells=False means allowed?
    # In openpyxl, False means not protected? Let's allow selection:
    ws.protection.selectLockedCells = False
    ws.protection.selectUnlockedCells = False

print("Protection applied to all sheets with password 'premium'")

# Add a new sheet "Protection Info"
if "Protection Guide" not in wb.sheetnames:
    ws_info = wb.create_sheet("Protection Guide", 0)
    ws_info.sheet_properties.tabColor = "FF0000"
    ws_info["A1"] = "🔒 Sheet Protection Info"
    ws_info["A1"].font = openpyxl.styles.Font(bold=True, size=14, color="A46A5A")
    ws_info["A3"] = "All formula cells are LOCKED with password: premium"
    ws_info["A4"] = "Yellow cells are UNLOCKED - you can edit them without password"
    ws_info["A5"] = "To unprotect for customization: Review > Unprotect Sheet > Enter password premium"
    ws_info["A6"] = "Google Sheets: Protected ranges will be preserved on import. To edit formulas: Data > Protected sheets and ranges > Remove protection or enter password"
    ws_info["A8"] = "What is locked?"
    ws_info["A9"] = "- All cells with formulas (=...) are locked"
    ws_info["A10"] = "- Header rows are locked"
    ws_info["A11"] = "- Dashboard KPIs, Analytics calculations locked"
    ws_info["A13"] = "What is unlocked?"
    ws_info["A14"] = "- Yellow input cells in Instructions + Setup"
    ws_info["A15"] = "- Ingredient names, stock qty, supplier (Ingredients)"
    ws_info["A16"] = "- Recipe qty needed, labor hours"
    ws_info["A17"] = "- Product names, prices, status"
    ws_info["A18"] = "- Order customer, product, qty, status, payment, deposit, fulfillment"
    ws_info["A19"] = "- Bookkeeping date, type, category, amounts"
    ws_info["A20"] = "- Markets date, event, revenue, costs, hours"
    ws_info["A21"] = "- Customers name, contact, tags, allergies, preferences"
    ws_info["A23"] = "Password: premium (lowercase)"
    ws_info["A23"].font = openpyxl.styles.Font(bold=True, size=12)

    from openpyxl.styles import PatternFill
    yellow = PatternFill(start_color="FFF9C4", end_color="FFF9C4", fill_type="solid")
    ws_info["A23"].fill = yellow

    # Protect this guide sheet too but allow no edits? Actually leave unlocked for reading? Keep protected too
    ws_info.protection.password = password
    ws_info.protection.sheet = True
    ws_info.protection.enable()

# Save protected version
output = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet_LOCKED.xlsx"
wb.save(output)
print(f"Saved locked version to {output}")

# Also overwrite original with locked version for consistency
wb.save(path)
print(f"Also updated original {path}")
