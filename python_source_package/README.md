# Python Source Code - Bakery, Church, Catering Business Planners

This package contains all Python source code used to generate the Etsy clone spreadsheets with advanced features, no circular refs, no repair errors, protected formulas password: premium

## Files

### Core Generators
- **generate_bakery_sheet.py** - Original Cottage Bakery Business Spreadsheet (Etsy 4518308882) - 9 tabs + bonus analytics - 56KB - With dashboard, ingredients, recipe calculator, product list, orders, bookkeeping, markets, customers
- **generate_fixed_v3.py** - Fixed v3 - No circular refs, no repair errors, improved first 5 tabs - 34KB clean - Fixes self-ref in Product List Batch Cost =IF(F2="",Recipe!G35,F2) which caused circular, removes AGGREGATE
- **generate_cottage_v4.py** - Enhanced v4 per customer review - 14 tabs - Multi-recipe (Recipe Library 50 recipes + 300 ingredients DB), Unit Conversion g/kg/oz/lb/ml/L/tsp/tbsp/cup, Overhead Monthly Expenses tab, Startup Costs with break-even graphic + 2 charts, 3 recipes at once in calculator - Addresses review: missing formulas, room for more than 1 recipe, grams/lbs/ml/oz/tsp/tbsp, overhead, startup graphic
- **generate_church.py** - Church Membership Tracker (Etsy 4547801754) - 7 tabs + bonus - Instructions, Dashboard KPI active/total/visitors/attendance/giving/needs attention/birthdays + charts, Member Directory 1000 rows age/membership years/days since/engagement Engaged/Cooling/Drifting/Inactive auto, Visitors & Follow-Up due+2 days overdue flag, Attendance Log one row per service, Giving Log weekly totals by fund private YTD, Ministry Teams VLOOKUP phone/email from directory
- **generate_catering.py** - Catering Business Planner (Etsy 4534900855) - 8 tabs + bonus - Instructions editable dropdowns, Dashboard booked revenue/cash collected/outstanding/net profit/upcoming/overdue/monthly revenue/profit + bar/pie, Events client/date/type/service style/venue/guests/price/deposit/balance/status badges, Clients CRM lifetime value VIP tags, Recipe Calculator cost per serving, Menu & Pricing food-cost % verdict Healthy/Watch/Underpriced, Quote Calculator menu items total food service fee delivery gratuity tax total quote deposit balance margin analysis, Income & Expenses monthly summary

### Image Generators (PIL fallback after 10 AI limit)
- **generate_remaining_images.py** - Creates 10 remaining bakery listing images via PIL after AI limit 10 reached - 1500x1000 PNG cottage colors
- **generate_church_images.py** - 20 church tracker listing images via PIL - navy/gold/cream theme - hero, whats included, dashboard, member directory, visitors, attendance, giving, ministry teams, analytics, mobile, how it works, features, needs attention, visitor pipeline, privacy giving, birthdays, dropdowns, two files, dashboard sunday, thank you
- **generate_catering_images.py** - 20 catering planner listing images via PIL - sage/terracotta/cream theme - hero, whats included, dashboard, events, clients, recipe calculator, menu pricing, quote calculator, income expenses, why love, how it works, google sheets, food cost, never miss, clients remembered, beginner friendly, made for caterers, what you get, dashboard closeup, thank you

### Utility
- **lock_formulas.py** - Locks formula cells (white) with password premium, unlocks yellow input cells - Applies to v1 bakery
- **lock_fixed_v3.py** - Fixed locking for v3 - minimal protection flags to avoid XML repair errors
- **test_cottage_v4.py** - Real-life price validation test - places Water/Salt missing, checks unit conversion g/kg/oz/lb/ml/L/tsp/tbsp/cup, multi-recipe capacity, overhead $665 hourly $8.31, startup $2700 break-even 5.4 months @ $500 profit - Verdict spreadsheet FINE and WORKING

## How to Use

### Install dependencies
```
pip install openpyxl --break-system-packages -q
pip install Pillow --break-system-packages -q
# or
pip install -r requirements.txt --break-system-packages
```

### Generate Bakery v1 (original 9 tabs)
```
python generate_bakery_sheet.py
# Output: Cottage_Bakery_Business_Spreadsheet.xlsx + README_Bakery_Spreadsheet.md
```

### Generate Bakery v3 Fixed (no repair errors)
```
python generate_fixed_v3.py
# Output: Cottage_Bakery_Business_Spreadsheet_FIXED.xlsx
# Fixes circular ref Product List F2 self-reference
```

### Generate Bakery v4 Enhanced (per customer review - recommended)
```
python generate_cottage_v4.py
# Output: Cottage_Bakery_v4_ENHANCED.xlsx (85KB) + LOCKED (245KB)
# Includes: Unit Conversion tab, Recipe Library 50 recipes, 3-recipe calculator with g/lb/ml/oz/tsp/tbsp conversion, Overhead Expenses tab, Startup Costs with break-even chart
```

### Generate Church Tracker
```
python generate_church.py
# Output: Church_Membership_Tracker.xlsx (118KB), BLANK, LOCKED, BLANK_LOCKED
# 7 tabs + bonus, 1000 member rows, engagement auto
```

### Generate Church Images (20)
```
python generate_church_images.py
# Output: church_listing_kit/images/01-20.png
```

### Generate Catering Planner
```
python generate_catering.py
# Output: Catering_Business_Planner.xlsx (40KB), BLANK, LOCKED, BLANK_LOCKED
# 8 tabs + bonus, Events, Clients VIP, Recipe per serving, Menu food-cost verdict, Quote margin, Income monthly
```

### Generate Catering Images (20)
```
python generate_catering_images.py
# Output: catering_listing_kit/images/01-20.png
```

### Lock formulas with password premium
```
python lock_formulas.py
# Reads Cottage_Bakery_Business_Spreadsheet.xlsx, locks white cells, unlocks yellow, password premium
```

### Test with real prices
```
python test_cottage_v4.py
# Validates no circular refs, unit conversion tsp/tbsp, multi-recipe, overhead, startup break-even
```

## Password
All locked files use password: **premium** (lowercase)
- Excel: Review > Unprotect Sheet > premium
- Google Sheets: Data > Protected sheets and ranges > Remove

## No Repair Errors Guarantee
- No self-referencing formulas (e.g., =IF(F2="",...,F2) fixed)
- No AGGREGATE volatile formulas that cause /xl/worksheets/sheet3.xml repair
- No array MAX(IF(...)) - replaced with MAXIFS or simple
- Sheet names without special chars + causing #NAME? - renamed Instructions + Setup to Instructions
- All formulas use IFERROR to avoid #VALUE! when ingredient missing
- Added Water + Salt missing ingredients that caused #VALUE! in recipe calculator

## Listing Kit Generation
Each generator creates sample data realistic for Etsy listing screenshots. For Etsy listing kit:
- 20 images: First 10 via AI generate_image tool (limit 10 per session), remaining 10 via PIL programmatically
- Title, description, tags/keywords in listing_kit/ folder
- ZIP pack: Cottage_Bakery_Listing_Kit.zip, SMALL (JPG compressed 1.8MB), Sheets Only (131KB)

## Future Updates
To add new tab:
1. Create sheet: ws = wb.create_sheet("New Tab")
2. Define headers, set widths, header_row, body_rows
3. Add sample data + formulas (use IFERROR, avoid self-ref)
4. Add data validation dropdowns
5. Add conditional formatting if needed
6. Set freeze_panes = "A2"
7. Add to Instructions tab list
8. Save and lock

To fix #VALUE!:
- Check for division by empty text: =IF(G="",B*F,B*F/G) not =B*F/G
- Add Water/Salt missing ingredients to Ingredients + Stock
- Use IFERROR(...,0) for Line Cost

To fix #NAME?:
- Avoid sheet names with + & etc - use Instructions not Instructions + Setup
- Replace all references old sheet name

## Author
Generated by Arena AI Agent on branch arena/019fc0fa-open-claw
Based on Etsy listings:
- 4518308882 Cottage Bakery Business Spreadsheet (ProsperaLab)
- 4547801754 Church Membership Tracker (ProsperaLab)
- 4534900855 Catering Business Planner (ProsperaLab)

Enhanced v4 per customer review:
- Room for more than 1 recipe -> Recipe Library 50 + 3 calculators
- grams/lbs/ml/oz/tsp/tbsp -> Unit Conversion table + Converted Qty formula
- Overhead monthly tab -> Overhead Expenses with hourly rate + pie chart
- Startup costs with graphic -> Startup Costs with break-even line + pie + months calc

All source code open for future use.
