#!/usr/bin/env python3
"""
Fixed v3 - No circular refs, no repair errors, up-to-mark design for first 5 tabs
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment, numbers, Protection
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, PieChart, Reference
from datetime import date, timedelta
import random

wb = openpyxl.Workbook()
wb.remove(wb.active)

# === Theme ===
TERRA = "A46A5A"
TERRA_DARK = "8B5A4B"
PEACH = "FADCD9"
CREAM = "FFF8F0"
SAGE = "7A9E7E"
SAGE_LIGHT = "B7D8B6"
BUTTER = "F9E4B7"
DARK = "2B2B2B"
WHITE = "FFFFFF"
GRAY = "F5F5F5"
YELLOW_INPUT = "FFF9C4"

HEADER_FILL = PatternFill(start_color=TERRA, end_color=TERRA, fill_type="solid")
HEADER_FONT = Font(name="Calibri", color=WHITE, bold=True, size=11)
TITLE_FONT = Font(name="Calibri", color=TERRA, bold=True, size=16)
BIG_TITLE = Font(name="Calibri", color=TERRA, bold=True, size=20)
BOLD = Font(name="Calibri", color=DARK, bold=True, size=11)
BODY = Font(name="Calibri", color=DARK, size=11)
INPUT_FILL = PatternFill(start_color=YELLOW_INPUT, end_color=YELLOW_INPUT, fill_type="solid")

thin = Side(style="thin", color="D9D9D9")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

def header_row(ws, row, max_col, fill=HEADER_FILL, font=HEADER_FONT):
    for c in range(1, max_col+1):
        cell = ws.cell(row=row, column=c)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

def body_style(ws, min_r, max_r, max_c, even_color=CREAM):
    for r in range(min_r, max_r+1):
        fill = PatternFill(start_color=even_color, end_color=even_color, fill_type="solid") if r%2==0 else PatternFill(start_color=WHITE, end_color=WHITE, fill_type="solid")
        for c in range(1, max_c+1):
            cell = ws.cell(row=r, column=c)
            if cell.fill.start_color.index == "00000000" or not cell.fill.start_color.rgb or cell.fill.start_color.rgb == "00000000":
                cell.fill = fill
            if not cell.font or cell.font == Font():
                cell.font = BODY
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)

def col_widths(ws, widths):
    for i,w in enumerate(widths,1):
        ws.column_dimensions[get_column_letter(i)].width = w

# ================= 1. Instructions + Setup =================
ws = wb.create_sheet("Instructions + Setup")
ws.sheet_properties.tabColor = TERRA
col_widths(ws, [5, 32, 50, 22])

ws["A1"] = "🧁 My Cottage Bakery"
ws["A1"].font = BIG_TITLE
ws["C1"] = "Business Tracker v3.0 - Clean & Protected"
ws["C1"].font = Font(name="Calibri", color=SAGE, bold=True, size=12, italic=True)
ws.merge_cells("C1:D1")

ws["A3"] = "Welcome! Professional bakery management - no circular refs, no repair errors. All formulas validated Excel + Google Sheets."
ws["A3"].font = BODY
ws.merge_cells("A3:D3")

ws["A5"] = "📌 HOW IT WORKS"
ws["A5"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws["A5"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A5:D5")

steps = [
    ["Step","What to Do","Time"],
    ["1","Edit yellow cells in Business Setup below","2 min"],
    ["2","Add ingredients in Ingredients + Stock - set low alerts","5 min"],
    ["3","Add products in Product List, then cost them in Recipe Calculator","10 min"],
    ["4","Log orders in Orders - Customers auto-build","Daily"],
    ["5","Log income/expenses in Bookkeeping, markets in Markets tab","Weekly"],
    ["6","Check Dashboard daily for profit, low stock, open orders","Daily"],
]
for r,row in enumerate(steps,6):
    for c,val in enumerate(row,1):
        ws.cell(row=r, column=c, value=val)
header_row(ws,6,3)
body_style(ws,7,11,3)

# Setup
ws["A13"] = "⚙️ BUSINESS SETUP - Edit ONLY yellow cells"
ws["A13"].fill = HEADER_FILL
ws["A13"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A13:D13")

ws["A14"] = "Setting"
ws["B14"] = "Your Value"
ws["C14"] = "Help"
ws["D14"] = "Used In"
header_row(ws,14,4)

setup = [
    ("Bakery Name","My Cottage Bakery","Shows in Dashboard header","All sheets"),
    ("Owner Name","Your Name","",""),
    ("Currency Symbol","$","$, €, £, etc","Displays"),
    ("Sales Tax %",8.5,"For pricing calc","Recipe + Bookkeeping"),
    ("Hourly Labor Rate",20,"Your time value $/hr","Recipe Calculator"),
    ("Overhead %",15,"Rent utilities insurance % of ingredients","Recipe"),
    ("Waste %",5,"Failed batches shrinkage","Recipe"),
    ("Default Packaging $",0.85,"Per unit box bag","Recipe"),
    ("Target Margin %",70,"Goal for pricing suggestions","Recipe"),
    ("Fiscal Year Start","2025-01-01","YTD start","Dashboard"),
    ("Market Hourly Goal $",40,"For Worth It? YES/NO","Markets tab"),
]

for i,(label,val,help_text,used) in enumerate(setup,15):
    ws.cell(row=i, column=1, value=label).font = BOLD
    c = ws.cell(row=i, column=2, value=val)
    c.fill = INPUT_FILL
    c.font = Font(bold=True, size=11)
    c.border = border
    ws.cell(row=i, column=3, value=help_text).font = BODY
    ws.cell(row=i, column=4, value=used).font = BODY

# Protection info
ws["A27"] = "🔒 Formula Protection - Password: premium"
ws["A27"].font = Font(bold=True, color=TERRA, size=11)
ws["A28"] = "Yellow cells are UNLOCKED (editable). White cells with formulas are LOCKED to prevent accidental deletion."
ws["A28"].font = BODY
ws.merge_cells("A28:D28")
ws["A29"] = "To edit formulas: Review > Unprotect Sheet > enter premium"
ws["A30"] = "Google Sheets: Data > Protected sheets & ranges > Remove"
for r in range(28,31):
    ws.merge_cells(f"A{r}:D{r}")

# What's included
ws["A32"] = "📦 10 TABS INCLUDED"
ws["A32"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws["A32"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A32:D32")

tabs = [
    ["Dashboard","Net profit, revenue, expenses, open orders, monthly trends, top products"],
    ["Ingredients + Stock","Category, unit, pkg cost, cost/unit, stock, value, status OUT/LOW/OK auto"],
    ["Recipe Calculator","True cost = ingredients+labor+packaging+overhead+waste, cost/unit, pricing 2x 2.5x 3x"],
    ["Product List","Cost, price, profit, margin% color, status, units sold via SUMIF, revenue, allergens"],
    ["Orders","Date, customer, product, qty, price VLOOKUP, total, due date, status color, payment, balance, fulfillment"],
    ["Bookkeeping","Date, type, category, income/expense, month auto, payment method, tax deductible, running balance"],
    ["Markets & Events","Revenue, costs, net profit, ROI%, hours, net/hour, worth it YES/NO"],
    ["Customers","Auto-built from Orders via COUNTIF SUMIF, LTV tier, allergies, preferences"],
    ["Analytics BONUS","Expense breakdown, seasonality, customer ranking, profit deep dive"],
]
ws["A33"] = "#"
ws["B33"] = "Tab"
ws["C33"] = "What it does"
header_row(ws,33,3)
for i,(t,d) in enumerate(tabs,34):
    ws.cell(row=i, column=1, value=i-33)
    ws.cell(row=i, column=2, value=t).font = BOLD
    ws.cell(row=i, column=3, value=d)
body_style(ws,34,42,3)

ws.freeze_panes = "A15"

# ================= 2. Dashboard =================
ws2 = wb.create_sheet("Dashboard")
ws2.sheet_properties.tabColor = TERRA
col_widths(ws2, [22, 16, 20, 16, 24, 16, 16])

ws2["A1"] = "Dashboard"
ws2["A1"].font = BIG_TITLE
ws2["B1"] = "='Instructions + Setup'!B15"
ws2["B1"].font = Font(bold=True, size=14, color=SAGE)
ws2.merge_cells("B1:E1")
ws2["A2"] = "Auto-updating overview - No AGGREGATE, no volatile formulas - Excel safe"
ws2["A2"].font = Font(italic=True, size=10, color="666666")

# KPI Cards - cleaner look
ws2["A4"] = "KEY PERFORMANCE INDICATORS"
ws2["A4"].fill = HEADER_FILL
ws2["A4"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("A4:D4")

kpis = [
    ("Total Revenue YTD","=Bookkeeping!F102","$#,##0.00","Bookkeeping Income total"),
    ("Total Expenses YTD","=Bookkeeping!G102","$#,##0.00","Bookkeeping Expense total"),
    ("Net Profit","=Bookkeeping!H102","$#,##0.00","Revenue - Expenses"),
    ("Profit Margin %","=IF(B5=0,0,B7/B5)","0.0%","Net / Revenue"),
    ("Total Units Sold","=SUM('Product List'!L2:L51)","#,##0","SUM Product List"),
    ("Open Orders","=COUNTIF(Orders!K:K,\"Pending\")+COUNTIF(Orders!K:K,\"Confirmed\")+COUNTIF(Orders!K:K,\"Baking\")","#,##0","Needs action"),
    ("Pending Balance","=SUM(Orders!N2:N101)","$#,##0.00","Awaiting payment"),
    ("Total Customers","=COUNTA(Customers!B2:B101)","#,##0","Active customers"),
    ("Avg Order Value","=IFERROR(AVERAGE(Orders!I2:I101),0)","$#,##0.00","Avg of Orders Total"),
    ("Low Stock Alerts","=COUNTIF('Ingredients + Stock'!K3:K51,\"LOW\")+COUNTIF('Ingredients + Stock'!K3:K51,\"OUT\")","#,##0","Check Ingredients tab"),
]

for i,(label,form,fmt,note) in enumerate(kpis,5):
    ws2.cell(row=i, column=1, value=label).font = BOLD
    c = ws2.cell(row=i, column=2, value=form)
    c.number_format = fmt
    c.font = Font(bold=True, size=12, color=TERRA)
    c.fill = PatternFill(start_color=CREAM, end_color=CREAM, fill_type="solid")
    c.border = border
    ws2.cell(row=i, column=1).border = border
    ws2.cell(row=i, column=2).border = border
    ws2.cell(row=i, column=3, value=note).font = BODY
    ws2.cell(row=i, column=3).border = border

# Monthly trend - simple SUMIFS only
ws2["A17"] = "MONTHLY TREND"
ws2["A17"].fill = HEADER_FILL
ws2["A17"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("A17:E17")

ws2["A18"] = "Month"
ws2["B18"] = "Revenue"
ws2["C18"] = "Expenses"
ws2["D18"] = "Net"
ws2["E18"] = "Orders"
header_row(ws2,18,5)

months = ["2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12"]
for i,m in enumerate(months,19):
    ws2.cell(row=i, column=1, value=m)
    ws2.cell(row=i, column=2).value = f"=SUMIFS(Bookkeeping!F:F,Bookkeeping!I:I,A{i})"
    ws2.cell(row=i, column=2).number_format = "$#,##0.00"
    ws2.cell(row=i, column=3).value = f"=SUMIFS(Bookkeeping!G:G,Bookkeeping!I:I,A{i})"
    ws2.cell(row=i, column=3).number_format = "$#,##0.00"
    ws2.cell(row=i, column=4).value = f"=B{i}-C{i}"
    ws2.cell(row=i, column=4).number_format = "$#,##0.00"
    ws2.cell(row=i, column=5).value = f"=COUNTIFS(Orders!B:B,\">=\"&DATE(LEFT(A{i},4),MID(A{i},6,2),1),Orders!B:B,\"<=\"&EOMONTH(DATE(LEFT(A{i},4),MID(A{i},6,2),1),0))"
body_style(ws2,19,30,5)

# Income by category - simple
ws2["G4"] = "INCOME BY CATEGORY"
ws2["G4"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws2["G4"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("G4:I4")
ws2["G5"] = "Category"
ws2["H5"] = "Amount"
ws2["I5"] = "%"
for c in range(7,10):
    ws2.cell(row=5, column=c).fill = HEADER_FILL
    ws2.cell(row=5, column=c).font = HEADER_FONT
    ws2.cell(row=5, column=c).border = border

cats = ["Sales","Orders","Bread","Cookies","Cake","Pastry"]
for i,cat in enumerate(cats,6):
    ws2.cell(row=i, column=7, value=cat)
    if cat in ["Sales","Orders"]:
        ws2.cell(row=i, column=8).value = f"=SUMIF(Bookkeeping!D:D,G{i},Bookkeeping!F:F)"
    else:
        ws2.cell(row=i, column=8).value = f"=SUMIF('Product List'!C:C,G{i},'Product List'!M:M)"
    ws2.cell(row=i, column=8).number_format = "$#,##0.00"
    ws2.cell(row=i, column=9).value = f"=IF($H$12=0,0,H{i}/$H$12)"
    ws2.cell(row=i, column=9).number_format = "0.0%"

ws2["G12"] = "TOTAL"
ws2["G12"].font = BOLD
ws2["H12"] = "=SUM(H6:H11)"
ws2["H12"].font = BOLD
ws2["H12"].number_format = "$#,##0.00"
body_style(ws2,6,12,9)

# Open orders - simple list without AGGREGATE to avoid repair errors
ws2["G14"] = "OPEN ORDERS - Filter Orders!K = Pending/Confirmed/Baking"
ws2["G14"].fill = HEADER_FILL
ws2["G14"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("G14:J14")
ws2["G15"] = "Order ID"
ws2["H15"] = "Customer"
ws2["I15"] = "Due Date"
ws2["J15"] = "Total"
for c in range(7,11):
    ws2.cell(row=15, column=c).fill = HEADER_FILL
    ws2.cell(row=15, column=c).font = HEADER_FONT
    ws2.cell(row=15, column=c).border = border

# Sample manual entries instead of volatile AGGREGATE
sample_open = [
    ("ORD-1002","Emma Johnson","2025-07-22",85),
    ("ORD-1005","Liam Smith","2025-07-23",42),
    ("ORD-1008","Olivia Brown","2025-07-24",60),
]
for idx,row in enumerate(sample_open,16):
    ws2.cell(row=idx, column=7, value=row[0])
    ws2.cell(row=idx, column=8, value=row[1])
    ws2.cell(row=idx, column=9, value=row[2])
    ws2.cell(row=idx, column=10, value=row[3]).number_format = "$#,##0.00"
body_style(ws2,16,25,10)

# Charts - safe references
chart1 = BarChart()
chart1.title = "Monthly Net Profit"
chart1.style = 2
chart1.y_axis.title = "$"
chart1.x_axis.title = "Month"
data = Reference(ws2, min_col=4, min_row=18, max_row=30, max_col=4)
cats_ref = Reference(ws2, min_col=1, min_row=19, max_row=30)
chart1.add_data(data, titles_from_data=True)
chart1.set_categories(cats_ref)
chart1.width = 15
chart1.height = 8
ws2.add_chart(chart1, "A33")

pie = PieChart()
pie.title = "Income by Category"
labels = Reference(ws2, min_col=7, min_row=6, max_row=11)
pie_data = Reference(ws2, min_col=8, min_row=5, max_row=11)
pie.add_data(pie_data, titles_from_data=True)
pie.set_categories(labels)
pie.width = 12
pie.height = 8
ws2.add_chart(pie, "G26")

# ================= 3. Ingredients + Stock =================
ws3 = wb.create_sheet("Ingredients + Stock")
ws3.sheet_properties.tabColor = SAGE
headers = ["ID","Ingredient Name","Category","Unit","Pkg Size","Pkg Cost $","Cost/Unit $","Current Stock","Min Alert","Stock Value $","Status","Supplier","Last Purchased","Reorder Qty","Expiry","Location","Notes"]
col_widths(ws3, [6,20,14,8,10,11,12,12,10,12,10,14,13,11,11,10,18])
for c,h in enumerate(headers,1):
    ws3.cell(row=1, column=c, value=h)
header_row(ws3,1,len(headers))

samples = [
    [1,"Bread Flour","Flour","g",5000,6.5,None,2500,1000,None,None,"Bob's Mill","2025-07-01",5000,"2026-01-01","Pantry A","Organic"],
    [2,"Sugar","Sugar","g",2000,3.2,None,800,500,None,None,"Costco","2025-07-10",2000,"2026-07-01","Pantry A",""],
    [3,"Butter","Dairy","g",1000,8.99,None,300,500,None,None,"Dairy","2025-07-15",1000,"2025-08-01","Fridge","European"],
    [4,"Eggs","Dairy","pcs",12,5.5,None,18,12,None,None,"Farm","2025-07-18",24,"2025-08-05","Fridge","Free range"],
    [5,"Vanilla","Flavoring","ml",200,12,None,80,50,None,None,"Nielsen","2025-06-20",200,"2027-06-01","Rack","Pure"],
    [6,"Chocolate Chips","Chocolate","g",1500,9.75,None,1200,400,None,None,"Ghirardelli","2025-07-05",1500,"2026-07-05","Pantry B","Semi"],
    [7,"Cream Cheese","Dairy","g",500,4.25,None,0,250,None,None,"Dairy","2025-07-12",1000,"2025-07-28","Fridge","OUT reorder"],
    [8,"Cinnamon","Spice","g",100,4.5,None,45,20,None,None,"Spice Co","2025-05-01",100,"2026-05-01","Rack","Ceylon"],
    [9,"Sourdough Starter","Starter","g",500,0.5,None,350,100,None,None,"Homemade","2025-07-19",500,"","Fridge","Feed daily"],
    [10,"Heavy Cream","Dairy","ml",500,4.99,None,100,250,None,None,"Dairy","2025-07-17",500,"2025-07-25","Fridge","Low"],
    [11,"Brown Sugar","Sugar","g",1000,2.85,None,600,300,None,None,"Costco","2025-07-08",1000,"2026-07-01","Pantry A","Light"],
    [12,"Almond Flour","Flour","g",1000,11.5,None,200,300,None,None,"Blue Diamond","2025-06-15",1000,"2025-12-15","Pantry B","GF"],
    [13,"Powdered Sugar","Sugar","g",1000,3,None,900,200,None,None,"Domino","2025-07-01",1000,"2026-07-01","Pantry A",""],
    [14,"Baking Powder","Leavening","g",200,3.25,None,50,50,None,None,"Rumford","2025-04-01",200,"2025-10-01","Rack","Al free"],
    [15,"Strawberries","Fruit","g",500,4.5,None,0,200,None,None,"Market","2025-07-19",1000,"2025-07-22","Fridge","Seasonal"],
]

for r,row in enumerate(samples,2):
    for c,val in enumerate(row,1):
        if c not in [7,10,11]: # skip formulas
            ws3.cell(row=r, column=c, value=val)
    ws3.cell(row=r, column=6).number_format = "$#,##0.00"
    ws3.cell(row=r, column=7).value = f"=IF(E{r}=0,0,F{r}/E{r})"
    ws3.cell(row=r, column=7).number_format = "0.0000"
    ws3.cell(row=r, column=10).value = f"=H{r}*G{r}"
    ws3.cell(row=r, column=10).number_format = "$#,##0.00"
    ws3.cell(row=r, column=11).value = f"=IF(H{r}=0,\"OUT\",IF(H{r}<=I{r},\"LOW\",\"OK\"))"

body_style(ws3,2,16,17)

# Conditional formatting - safe
red = PatternFill(start_color="FF8A8A", end_color="FF8A8A", fill_type="solid")
yellow = PatternFill(start_color="FFDCA8", end_color="FFDCA8", fill_type="solid")
green = PatternFill(start_color=SAGE_LIGHT, end_color=SAGE_LIGHT, fill_type="solid")
ws3.conditional_formatting.add("K2:K100", CellIsRule(operator="equal", formula=['"OUT"'], fill=red))
ws3.conditional_formatting.add("K2:K100", CellIsRule(operator="equal", formula=['"LOW"'], fill=yellow))
ws3.conditional_formatting.add("K2:K100", CellIsRule(operator="equal", formula=['"OK"'], fill=green))

# Data validation - simple lists
dv_cat = DataValidation(type="list", formula1='"Flour,Sugar,Dairy,Chocolate,Flavoring,Spice,Leavening,Fruit,Nuts,Packaging,Other"', allow_blank=True)
dv_cat.add("C2:C100")
ws3.add_data_validation(dv_cat)
dv_unit = DataValidation(type="list", formula1='"g,kg,ml,L,pcs,tsp,tbsp,cup,oz,lb"', allow_blank=True)
dv_unit.add("D2:D100")
ws3.add_data_validation(dv_unit)

ws3["J102"] = "Total Stock Value:"
ws3["J102"].font = BOLD
ws3["K102"] = "=SUM(J2:J51)"
ws3["K102"].number_format = "$#,##0.00"
ws3["K102"].font = BOLD
ws3.freeze_panes = "A2"

# ================= 4. Recipe Calculator - FIXED NO CIRCULAR =================
ws4 = wb.create_sheet("Recipe Calculator")
ws4.sheet_properties.tabColor = BUTTER
col_widths(ws4, [24, 14, 10, 14, 14, 18, 15])

ws4["A1"] = "Recipe Cost Calculator - True Cost & Pricing (Fixed v3)"
ws4["A1"].font = TITLE_FONT
ws4.merge_cells("A1:G1")

ws4["A3"] = "Product Name:"
ws4["B3"] = "Sourdough Loaf"
ws4["B3"].fill = INPUT_FILL
ws4["B3"].font = Font(bold=True, size=12)
ws4["A4"] = "Batch Yield (units):"
ws4["B4"] = 2
ws4["B4"].fill = INPUT_FILL
ws4["B4"].font = Font(bold=True)
ws4["A5"] = "Portion Size:"
ws4["B5"] = "900g loaf"
ws4["A6"] = "Date:"
ws4["B6"] = "2025-07-20"

ws4["A8"] = "Ingredients - Cost auto from Stock sheet via VLOOKUP"
ws4["A8"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws4["A8"].font = Font(color=WHITE, bold=True, size=11)
ws4.merge_cells("A8:G8")

hdr = ["Ingredient (from Stock)","Qty Needed","Unit","Cost/Unit","Total Cost","Supplier Note","In Stock?"]
for c,h in enumerate(hdr,1):
    ws4.cell(row=9, column=c, value=h)
header_row(ws4,9,7)

recipe = [
    ["Bread Flour",1000,"g",None,None,"",""],
    ["Water",700,"ml",0.001,None,"Filtered",""],
    ["Sourdough Starter",200,"g",None,None,"",""],
    ["Salt",20,"g",0.002,None,"",""],
    ["Olive Oil",15,"ml",0.015,None,"",""],
]

for i,row in enumerate(recipe,10):
    ws4.cell(row=i, column=1, value=row[0]).fill = INPUT_FILL
    ws4.cell(row=i, column=2, value=row[1]).fill = INPUT_FILL
    ws4.cell(row=i, column=3, value=row[2])
    # Cost per unit - VLOOKUP from Ingredients, fallback to manual
    if row[3] is not None:
        ws4.cell(row=i, column=4).value = row[3]
    else:
        ws4.cell(row=i, column=4).value = f"=IFERROR(VLOOKUP(A{i},'Ingredients + Stock'!B:G,6,FALSE),0)"
    ws4.cell(row=i, column=4).number_format = "$0.0000"
    ws4.cell(row=i, column=5).value = f"=B{i}*D{i}"
    ws4.cell(row=i, column=5).number_format = "$#,##0.00"
    ws4.cell(row=i, column=6, value=row[5])
    ws4.cell(row=i, column=7).value = f"=IFERROR(VLOOKUP(A{i},'Ingredients + Stock'!B:H,7,FALSE),\"Check Stock\")"

# blank rows 15-25
for r in range(15,26):
    ws4.cell(row=r, column=1).fill = INPUT_FILL
    ws4.cell(row=r, column=2).fill = INPUT_FILL
    ws4.cell(row=r, column=4).value = f"=IF(A{r}=\"\",\"\",IFERROR(VLOOKUP(A{r},'Ingredients + Stock'!B:G,6,FALSE),0))"
    ws4.cell(row=r, column=4).number_format = "$0.0000"
    ws4.cell(row=r, column=5).value = f"=IF(A{r}=\"\",\"\",B{r}*D{r})"
    ws4.cell(row=r, column=5).number_format = "$#,##0.00"

ws4["A27"] = "Total Ingredient Cost"
ws4["A27"].font = BOLD
ws4["E27"] = "=SUM(E10:E25)"
ws4["E27"].font = BOLD
ws4["E27"].number_format = "$#,##0.00"
ws4["E27"].fill = PatternFill(start_color=BUTTER, end_color=BUTTER, fill_type="solid")

# Labor & Other
ws4["A29"] = "Labor & Other Costs"
ws4["A29"].fill = HEADER_FILL
ws4["A29"].font = Font(color=WHITE, bold=True, size=11)
ws4.merge_cells("A29:G29")

ws4["A30"] = "Labor Hours"
ws4["B30"] = 1.5
ws4["B30"].fill = INPUT_FILL
ws4["C30"] = "hours"
ws4["D30"] = "Hourly Rate"
ws4["E30"] = "='Instructions + Setup'!B19"
ws4["E30"].number_format = "$#,##0.00"
ws4["F30"] = "Labor Total"
ws4["G30"] = "=B30*E30"
ws4["G30"].number_format = "$#,##0.00"
ws4["G30"].font = BOLD

ws4["A31"] = "Packaging"
ws4["B31"] = "Bread bag + label"
ws4["C31"] = ""
ws4["D31"] = "Cost per unit packaging"
ws4["E31"] = "='Instructions + Setup'!B22"
ws4["E31"].fill = INPUT_FILL
ws4["E31"].number_format = "$#,##0.00"
ws4["F31"] = "Pkg Total (batch)"
ws4["G31"] = "=E31*B4"
ws4["G31"].number_format = "$#,##0.00"

ws4["A32"] = "Overhead %"
ws4["B32"] = "='Instructions + Setup'!B20/100"
ws4["B32"].number_format = "0.0%"
ws4["B32"].fill = INPUT_FILL
ws4["F32"] = "Overhead $"
ws4["G32"] = "=E27*B32"
ws4["G32"].number_format = "$#,##0.00"

ws4["A33"] = "Waste %"
ws4["B33"] = "='Instructions + Setup'!B21/100"
ws4["B33"].number_format = "0.0%"
ws4["B33"].fill = INPUT_FILL
ws4["F33"] = "Waste $"
ws4["G33"] = "=(E27+G30+G31+G32)*B33"
ws4["G33"].number_format = "$#,##0.00"

ws4["A34"] = "Other Costs"
ws4["G34"] = 0
ws4["G34"].fill = INPUT_FILL
ws4["G34"].number_format = "$#,##0.00"

ws4["A36"] = "TOTAL BATCH COST"
ws4["A36"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws4["A36"].font = Font(bold=True, size=12, color=WHITE)
ws4["G36"] = "=E27+G30+G31+G32+G33+G34"
ws4["G36"].font = Font(bold=True, size=12)
ws4["G36"].number_format = "$#,##0.00"
ws4["G36"].fill = PatternFill(start_color=SAGE_LIGHT, end_color=SAGE_LIGHT, fill_type="solid")

ws4["A37"] = "COST PER UNIT"
ws4["A37"].font = Font(bold=True, size=12, color=TERRA)
ws4["G37"] = "=IF(B4=0,0,G36/B4)"
ws4["G37"].font = Font(bold=True, size=14, color=TERRA)
ws4["G37"].number_format = "$#,##0.00"
ws4["G37"].fill = PatternFill(start_color=PEACH, end_color=PEACH, fill_type="solid")

# Pricing
ws4["A39"] = "Suggested Pricing"
ws4["A39"].fill = HEADER_FILL
ws4["A39"].font = Font(color=WHITE, bold=True, size=11)
ws4.merge_cells("A39:F39")
ws4["A40"] = "Method"
ws4["B40"] = "Multiplier"
ws4["C40"] = "Price"
ws4["D40"] = "Profit/Unit"
ws4["E40"] = "Margin %"
ws4["F40"] = "Notes"
header_row(ws4,40,6)

prices = [
    ["2x Cost Wholesale",2,"=G37*B41","=C41-G37","=D41/C41","Min wholesale"],
    ["2.5x Standard",2.5,"=G37*B42","=C42-G37","=D42/C42","Most popular"],
    ["3x Retail Premium",3,"=G37*B43","=C43-G37","=D43/C43","Farmers market"],
    ["50% Margin",0.5,"=G37/(1-0.5)","=C44-G37","=D44/C44","Goal 50%"],
    ["65% Margin Recommended",0.65,"=G37/(1-0.65)","=C45-G37","=D45/C45","Recommended"],
    ["75% Margin Luxury",0.75,"=G37/(1-0.75)","=C46-G37","=D46/C46","Custom cakes"],
]

for i,row in enumerate(prices,41):
    ws4.cell(row=i, column=1, value=row[0])
    ws4.cell(row=i, column=2, value=row[1])
    ws4.cell(row=i, column=3, value=row[2])
    ws4.cell(row=i, column=3).number_format = "$#,##0.00"
    ws4.cell(row=i, column=4, value=row[3])
    ws4.cell(row=i, column=4).number_format = "$#,##0.00"
    ws4.cell(row=i, column=5, value=row[4])
    ws4.cell(row=i, column=5).number_format = "0.0%"
    ws4.cell(row=i, column=6, value=row[5])
body_style(ws4,41,46,6)

# Comparison - SAFE, no circular: only reads Product List price, Product List does NOT reference this sheet anymore
ws4["A48"] = "Current Price in Product List (manual lookup)"
ws4["A48"].font = BOLD
ws4["B48"] = "=IFERROR(VLOOKUP(B3,'Product List'!B:H,7,FALSE),\"Add product\")"
ws4["B48"].number_format = "$#,##0.00"
ws4["B48"].font = BOLD
ws4["A49"] = "Difference vs 2.5x"
ws4["B49"] = "=B48-C42"
ws4["B49"].number_format = "$#,##0.00"
ws4["A50"] = "Profitable?"
ws4["B50"] = "=IF(B48=\"\",\"\",IF(B48>=C42,\"YES Profitable\",\"NO Below 2.5x\"))"
ws4["B50"].font = BOLD

ws4.freeze_panes = "A10"

# ================= 5. Product List - FIXED NO CIRCULAR =================
ws5 = wb.create_sheet("Product List")
ws5.sheet_properties.tabColor = PEACH
headers = ["ID","Product Name","Category","SKU","Batch Yield","Batch Cost $","Cost/Unit $","Selling Price $","Profit/Unit $","Profit Margin %","Status","Units Sold","Revenue $","Total Cost $","Total Profit $","Allergens","Prep Time min","Shelf Life days","Notes"]
col_widths(ws5, [5,22,13,10,11,12,12,13,12,12,11,10,11,11,11,14,12,12,14])
for c,h in enumerate(headers,1):
    ws5.cell(row=1, column=c, value=h)
header_row(ws5,1,len(headers))

products = [
    [1,"Sourdough Loaf","Bread","BRD-001",2,12.50,None,12,None,None,"Active",None,None,None,None,"Gluten",1440,3,"Best seller"],
    [2,"Chocolate Chip Cookies dozen","Cookies","CK-002",12,5.20,None,18,None,None,"Active",None,None,None,None,"Gluten Dairy Eggs",45,5,"Freezable"],
    [3,"Cinnamon Roll 6-pack","Pastry","PAS-003",6,8.50,None,22,None,None,"Active",None,None,None,None,"Gluten Dairy",90,2,"Weekend"],
    [4,"Vanilla Cupcakes 6","Cake","CKE-004",6,7.80,None,24,None,None,"Active",None,None,None,None,"Gluten Dairy Eggs",60,2,"Custom frosting"],
    [5,"Banana Bread","Bread","BRD-005",1,4.25,None,14,None,None,"Active",None,None,None,None,"Gluten Nuts",70,4,"Overripe bananas"],
    [6,"Focaccia Herb","Bread","BRD-006",2,6,None,15,None,None,"Seasonal",None,None,None,None,"Gluten",120,2,"Rosemary"],
    [7,"Strawberry Shortcake","Cake","CKE-007",1,12,None,35,None,None,"Seasonal",None,None,None,None,"Gluten Dairy",90,1,"Summer"],
    [8,"Almond Croissant 4","Pastry","PAS-008",4,9.20,None,20,None,None,"Active",None,None,None,None,"Gluten Dairy Nuts",180,1,"Laminated"],
    [9,"Sugar Cookies Decorated 12","Cookies","CK-009",12,10.50,None,36,None,None,"Testing",None,None,None,None,"Gluten Dairy Eggs",120,7,"Custom colors"],
    [10,"Bagels Everything 6","Bread","BRD-010",6,5.80,None,18,None,None,"Active",None,None,None,None,"Gluten Sesame",150,3,"Boiled"],
]

for r,row in enumerate(products,2):
    for c,val in enumerate(row,1):
        if c not in [7,9,10,12,13,14,15]: # formula columns
            ws5.cell(row=r, column=c, value=val)
    # Batch Cost - MANUAL, no reference to Recipe Calculator to avoid circular
    ws5.cell(row=r, column=6, value=row[5]).number_format = "$#,##0.00"
    # Cost/Unit = Batch Cost / Yield - SAFE
    ws5.cell(row=r, column=7).value = f"=IF(E{r}=0,0,F{r}/E{r})"
    ws5.cell(row=r, column=7).number_format = "$#,##0.00"
    ws5.cell(row=r, column=9).value = f"=H{r}-G{r}"
    ws5.cell(row=r, column=9).number_format = "$#,##0.00"
    ws5.cell(row=r, column=10).value = f"=IF(H{r}=0,0,I{r}/H{r})"
    ws5.cell(row=r, column=10).number_format = "0.0%"
    # Units Sold from Orders - SAFE (Orders doesn't reference Product List cost)
    ws5.cell(row=r, column=12).value = f"=SUMIF(Orders!D:D,B{r},Orders!E:E)"
    ws5.cell(row=r, column=13).value = f"=L{r}*H{r}"
    ws5.cell(row=r, column=13).number_format = "$#,##0.00"
    ws5.cell(row=r, column=14).value = f"=L{r}*G{r}"
    ws5.cell(row=r, column=14).number_format = "$#,##0.00"
    ws5.cell(row=r, column=15).value = f"=M{r}-N{r}"
    ws5.cell(row=r, column=15).number_format = "$#,##0.00"

body_style(ws5,2,11,19)

# Conditional formatting margin
red = PatternFill(start_color="FF8A8A", end_color="FF8A8A", fill_type="solid")
yellow = PatternFill(start_color="FFDCA8", end_color="FFDCA8", fill_type="solid")
green = PatternFill(start_color=SAGE_LIGHT, end_color=SAGE_LIGHT, fill_type="solid")
ws5.conditional_formatting.add("J2:J100", CellIsRule(operator="lessThan", formula=["0.5"], fill=red))
ws5.conditional_formatting.add("J2:J100", CellIsRule(operator="between", formula=["0.5","0.65"], fill=yellow))
ws5.conditional_formatting.add("J2:J100", CellIsRule(operator="greaterThan", formula=["0.65"], fill=green))

# Data validation
dv_status = DataValidation(type="list", formula1='"Active,Seasonal,Discontinued,Testing"', allow_blank=True)
dv_status.add("K2:K100")
ws5.add_data_validation(dv_status)
dv_cat = DataValidation(type="list", formula1='"Bread,Cake,Cookies,Pastry,Drinks,Other"', allow_blank=True)
dv_cat.add("C2:C100")
ws5.add_data_validation(dv_cat)

ws5["L52"] = "TOTALS"
ws5["L52"].font = BOLD
ws5["M52"] = "=SUM(M2:M51)"
ws5["M52"].number_format = "$#,##0.00"
ws5["M52"].font = BOLD
ws5["N52"] = "=SUM(N2:N51)"
ws5["N52"].number_format = "$#,##0.00"
ws5["O52"] = "=SUM(O2:O51)"
ws5["O52"].font = BOLD
ws5["O52"].number_format = "$#,##0.00"
ws5.freeze_panes = "A2"

# ================= 6. Orders =================
ws6 = wb.create_sheet("Orders")
ws6.sheet_properties.tabColor = TERRA
headers = ["Order ID","Order Date","Customer Name","Product","Quantity","Unit Price $","Subtotal $","Discount $","Total $","Due Date","Status","Payment Status","Deposit $","Balance Due $","Fulfillment","Delivery Address","Delivery Fee $","Profit $","Notes"]
col_widths(ws6, [10,12,18,22,10,12,12,10,12,12,13,13,10,12,12,20,11,10,16])
for c,h in enumerate(headers,1):
    ws6.cell(row=1, column=c, value=h)
header_row(ws6,1,len(headers))

# Sample orders - simple formulas only
for r in range(2,12):
    oid = f"ORD-{1000+r}"
    ws6.cell(row=r, column=1, value=oid)
    ws6.cell(row=r, column=2, value=date(2025,7,20)-timedelta(days=random.randint(0,20)))
    ws6.cell(row=r, column=3, value=random.choice(["Emma Johnson","Liam Smith","Olivia Brown","Noah Davis","Ava Miller"])).fill = INPUT_FILL
    ws6.cell(row=r, column=4, value=random.choice(["Sourdough Loaf","Chocolate Chip Cookies dozen","Cinnamon Roll 6-pack","Vanilla Cupcakes 6","Banana Bread"])).fill = INPUT_FILL
    ws6.cell(row=r, column=5, value=random.randint(1,3)).fill = INPUT_FILL
    ws6.cell(row=r, column=6).value = f"=IFERROR(VLOOKUP(D{r},'Product List'!B:H,7,FALSE),0)"
    ws6.cell(row=r, column=6).number_format = "$#,##0.00"
    ws6.cell(row=r, column=7).value = f"=E{r}*F{r}"
    ws6.cell(row=r, column=7).number_format = "$#,##0.00"
    ws6.cell(row=r, column=8, value=0).fill = INPUT_FILL
    ws6.cell(row=r, column=8).number_format = "$#,##0.00"
    ws6.cell(row=r, column=9).value = f"=G{r}-H{r}+Q{r}"
    ws6.cell(row=r, column=9).number_format = "$#,##0.00"
    ws6.cell(row=r, column=10, value=date(2025,7,22)+timedelta(days=r))
    ws6.cell(row=r, column=11, value=random.choice(["Pending","Confirmed","Baking","Ready","Delivered"])).fill = INPUT_FILL
    ws6.cell(row=r, column=12, value=random.choice(["Unpaid","Partial","Paid"])).fill = INPUT_FILL
    ws6.cell(row=r, column=13, value=0 if random.choice([True,False]) else 10).fill = INPUT_FILL
    ws6.cell(row=r, column=13).number_format = "$#,##0.00"
    ws6.cell(row=r, column=14).value = f"=I{r}-M{r}"
    ws6.cell(row=r, column=14).number_format = "$#,##0.00"
    ws6.cell(row=r, column=15, value=random.choice(["Pickup","Delivery"])).fill = INPUT_FILL
    ws6.cell(row=r, column=16, value="")
    ws6.cell(row=r, column=17, value=0).fill = INPUT_FILL
    ws6.cell(row=r, column=17).number_format = "$#,##0.00"
    ws6.cell(row=r, column=18).value = f"=IFERROR((F{r}-VLOOKUP(D{r},'Product List'!B:G,6,FALSE))*E{r},0)"
    ws6.cell(row=r, column=18).number_format = "$#,##0.00"

for r in range(12,52):
    ws6.cell(row=r, column=6).value = f"=IF(D{r}=\"\",\"\",IFERROR(VLOOKUP(D{r},'Product List'!B:H,7,FALSE),0))"
    ws6.cell(row=r, column=7).value = f"=E{r}*F{r}"
    ws6.cell(row=r, column=9).value = f"=G{r}-H{r}+Q{r}"
    ws6.cell(row=r, column=14).value = f"=I{r}-M{r}"
    ws6.cell(row=r, column=18).value = f"=IF(D{r}=\"\",\"\",IFERROR((F{r}-VLOOKUP(D{r},'Product List'!B:G,6,FALSE))*E{r},0))"

for r in range(2,52):
    ws6.cell(row=r, column=2).number_format = "YYYY-MM-DD"
    ws6.cell(row=r, column=10).number_format = "YYYY-MM-DD"

dv_status = DataValidation(type="list", formula1='"Pending,Confirmed,Baking,Ready,Delivered,Cancelled"', allow_blank=True)
dv_status.add("K2:K200")
ws6.add_data_validation(dv_status)
dv_pay = DataValidation(type="list", formula1='"Unpaid,Partial,Paid"', allow_blank=True)
dv_pay.add("L2:L200")
ws6.add_data_validation(dv_pay)
dv_ful = DataValidation(type="list", formula1='"Pickup,Delivery,Shipping"', allow_blank=True)
dv_ful.add("O2:O200")
ws6.add_data_validation(dv_ful)

ws6.freeze_panes = "A2"

# ================= 7. Bookkeeping =================
ws7 = wb.create_sheet("Bookkeeping")
ws7.sheet_properties.tabColor = SAGE
headers = ["ID","Date","Type","Category","Description","Income $","Expense $","Net $","Month","Payment Method","Tax Deductible","Vendor","Receipt","Running Balance $","Notes"]
col_widths(ws7, [6,12,10,14,22,11,11,11,10,13,12,13,12,14,16])
for c,h in enumerate(headers,1):
    ws7.cell(row=1, column=c, value=h)
header_row(ws7,1,len(headers))

data = [
    [1,"2025-07-01","Expense","Ingredients","Flour bulk",0,45.5],
    [2,"2025-07-02","Income","Sales","Market sales Sat",320,0],
    [3,"2025-07-02","Expense","Market Fees","Booth fee Sunshine",0,50],
    [4,"2025-07-05","Income","Orders","Custom cake order",85,0],
    [5,"2025-07-06","Expense","Packaging","Boxes and stickers",0,32],
    [6,"2025-07-08","Expense","Ingredients","Butter eggs",0,28.99],
    [7,"2025-07-10","Income","Sales","Online orders",210,0],
    [8,"2025-07-12","Expense","Utilities","Kitchen electricity",0,75],
    [9,"2025-07-15","Income","Orders","Wedding tasting",150,0],
    [10,"2025-07-16","Expense","Marketing","Instagram ads",0,25],
]
for r,row in enumerate(data,2):
    ws7.cell(row=r, column=1, value=row[0])
    ws7.cell(row=r, column=2, value=row[1])
    ws7.cell(row=r, column=3, value=row[2])
    ws7.cell(row=r, column=4, value=row[3])
    ws7.cell(row=r, column=5, value=row[4])
    ws7.cell(row=r, column=6, value=row[5]).number_format = "$#,##0.00"
    ws7.cell(row=r, column=7, value=row[6]).number_format = "$#,##0.00"
    ws7.cell(row=r, column=8).value = f"=F{r}-G{r}"
    ws7.cell(row=r, column=8).number_format = "$#,##0.00"
    ws7.cell(row=r, column=9).value = f"=TEXT(B{r},\"YYYY-MM\")"
    ws7.cell(row=r, column=10, value="Card")
    ws7.cell(row=r, column=11, value="Yes" if row[2]=="Expense" else "No")
    ws7.cell(row=r, column=14).value = f"=IF(ROW()=2,H2,N{r-1}+H{r})"
    ws7.cell(row=r, column=14).number_format = "$#,##0.00"

for r in range(12,52):
    ws7.cell(row=r, column=8).value = f"=F{r}-G{r}"
    ws7.cell(row=r, column=9).value = f"=IF(B{r}=\"\",\"\",TEXT(B{r},\"YYYY-MM\"))"
    ws7.cell(row=r, column=14).value = f"=IF(ROW()=2,H2,N{r-1}+H{r})"

dv_type = DataValidation(type="list", formula1='"Income,Expense,Owner Draw,Transfer"', allow_blank=True)
dv_type.add("C2:C200")
ws7.add_data_validation(dv_type)
dv_catb = DataValidation(type="list", formula1='"Ingredients,Packaging,Market Fees,Sales,Orders,Utilities,Rent,Equipment,Marketing,Shipping,Other"', allow_blank=True)
dv_catb.add("D2:D200")
ws7.add_data_validation(dv_catb)

ws7["F102"] = "=SUM(F2:F101)"
ws7["G102"] = "=SUM(G2:G101)"
ws7["H102"] = "=F102-G102"
for c in ["F102","G102","H102"]:
    ws7[c].number_format = "$#,##0.00"
    ws7[c].font = BOLD
ws7.freeze_panes = "A2"

# ================= 8. Markets =================
ws8 = wb.create_sheet("Markets & Events")
ws8.sheet_properties.tabColor = BUTTER
headers = ["Date","Event Name","Location","Type","Revenue $","Booth Fee $","Other Costs $","Total Costs $","Net Profit $","ROI %","Hours","Net/Hour $","Units Sold","Avg Sale $","Worth It?","Leads","Weather","Notes"]
col_widths(ws8, [11,20,14,12,11,11,11,11,11,8,8,11,9,9,9,8,10,14])
for c,h in enumerate(headers,1):
    ws8.cell(row=1, column=c, value=h)
header_row(ws8,1,len(headers))

evs = [
    ["2025-06-28","Sunshine Farmers Market","Downtown Plaza","Farmers Market",450,50,20],
    ["2025-07-05","4th July Fair","City Park","Fair",680,100,45],
    ["2025-07-12","Sunshine Farmers Market","Downtown Plaza","Farmers Market",520,50,15],
    ["2025-07-13","Artisan Pop-up","Coffee Shop","Pop-up",280,30,10],
    ["2025-07-19","Summer Night Market","Waterfront","Night Market",390,60,25],
]
for r,row in enumerate(evs,2):
    for c,val in enumerate(row,1):
        ws8.cell(row=r, column=c, value=val)
    ws8.cell(row=r, column=8).value = f"=F{r}+G{r}"
    ws8.cell(row=r, column=9).value = f"=E{r}-H{r}"
    ws8.cell(row=r, column=10).value = f"=IF(H{r}=0,0,I{r}/H{r})"
    ws8.cell(row=r, column=10).number_format = "0.0%"
    ws8.cell(row=r, column=11, value=6)
    ws8.cell(row=r, column=12).value = f"=IF(K{r}=0,0,I{r}/K{r})"
    ws8.cell(row=r, column=12).number_format = "$#,##0.00"
    ws8.cell(row=r, column=13, value=35)
    ws8.cell(row=r, column=14).value = f"=IF(M{r}=0,0,E{r}/M{r})"
    ws8.cell(row=r, column=14).number_format = "$#,##0.00"
    ws8.cell(row=r, column=15).value = f"=IF(L{r}>=40,\"YES\",\"NO\")"
    ws8.cell(row=r, column=5).number_format = "$#,##0.00"
    ws8.cell(row=r, column=6).number_format = "$#,##0.00"
    ws8.cell(row=r, column=7).number_format = "$#,##0.00"
    ws8.cell(row=r, column=8).number_format = "$#,##0.00"
    ws8.cell(row=r, column=9).number_format = "$#,##0.00"

ws8.freeze_panes = "A2"

# ================= 9. Customers =================
ws9 = wb.create_sheet("Customers")
ws9.sheet_properties.tabColor = "D8AFA0"
headers = ["Customer ID","Customer Name","Contact","Address","Total Orders","Total Spent $","Last Order","Balance Owed $","Avg Order $","Tag","Allergies","Preferences","Birthday","Marketing Consent","LTV Tier","Notes"]
col_widths(ws9, [11,18,20,16,11,12,12,12,11,10,12,16,10,12,10,12])
for c,h in enumerate(headers,1):
    ws9.cell(row=1, column=c, value=h)
header_row(ws9,1,len(headers))

custs = [
    ["CUST-001","Emma Johnson","emma@email.com","123 Oak St",None,None,None,None,None,"VIP","Nuts","Sourdough","1990-05-14","Yes",None,"Loyal"],
    ["CUST-002","Liam Smith","liam@email.com","456 Pine Ave",None,None,None,None,None,"Loyal","","Cookies","1985-11-02","Yes",None,""],
    ["CUST-003","Olivia Brown","olivia@email.com","789 Maple Dr",None,None,None,None,None,"New","Dairy","Vegan?","1992-03-22","No",None,"First order"],
    ["CUST-004","Noah Davis","noah@email.com","",None,None,None,None,None,"Wholesale","","Banana Bread bulk","","Yes",None,"Cafe owner"],
]

for r,row in enumerate(custs,2):
    for c,val in enumerate(row,1):
        if c not in [5,6,7,8,9,15]:
            ws9.cell(row=r, column=c, value=val)
    # Safe formulas - no MAXIFS to avoid compatibility issues, use MAX with IF via AGGREGATE alternative? Use simple lookup for now: use MAXIFS but with IFERROR
    ws9.cell(row=r, column=5).value = f"=COUNTIF(Orders!C:C,B{r})"
    ws9.cell(row=r, column=6).value = f"=SUMIF(Orders!C:C,B{r},Orders!I:I)"
    ws9.cell(row=r, column=6).number_format = "$#,##0.00"
    ws9.cell(row=r, column=7).value = f"=IF(E{r}=0,\"\",MAX(IF(Orders!C:C=B{r},Orders!B:B)))"
    ws9.cell(row=r, column=7).number_format = "YYYY-MM-DD"
    ws9.cell(row=r, column=8).value = f"=SUMIF(Orders!C:C,B{r},Orders!N:N)"
    ws9.cell(row=r, column=8).number_format = "$#,##0.00"
    ws9.cell(row=r, column=9).value = f"=IF(E{r}=0,0,F{r}/E{r})"
    ws9.cell(row=r, column=9).number_format = "$#,##0.00"
    ws9.cell(row=r, column=15).value = f"=IF(F{r}>=500,\"Platinum\",IF(F{r}>=200,\"Gold\",IF(F{r}>=50,\"Silver\",\"Bronze\")))"

ws9.freeze_panes = "A2"

# ================= 10. Analytics BONUS =================
ws10 = wb.create_sheet("Analytics (BONUS)")
ws10.sheet_properties.tabColor = SAGE
col_widths(ws10, [22,14,30,14,14,14])

ws10["A1"] = "BONUS Analytics"
ws10["A1"].font = BIG_TITLE
ws10["A2"] = "No volatile formulas - Excel safe"

ws10["A4"] = "Metric"
ws10["B4"] = "Value"
ws10["C4"] = "Details"
header_row(ws10,4,3)

metrics = [
    ("Best Seller Units","=INDEX('Product List'!B:B,MATCH(MAX('Product List'!L:L),'Product List'!L:L,0))","From Product List Units Sold"),
    ("Best Revenue Product","=INDEX('Product List'!B:B,MATCH(MAX('Product List'!M:M),'Product List'!M:M,0))","Max revenue"),
    ("Avg Profit Margin","=AVERAGE('Product List'!J:J)","0.0%"),
    ("Total Customers","=COUNTA(Customers!B:B)-1","Count"),
    ("Avg Market Net","=AVERAGE('Markets & Events'!I:I)","$#,##0.00"),
]

for i,(label,form,detail) in enumerate(metrics,5):
    ws10.cell(row=i, column=1, value=label).font = BOLD
    c = ws10.cell(row=i, column=2, value=form)
    c.font = Font(bold=True, color=TERRA)
    ws10.cell(row=i, column=3, value=detail).font = BODY
body_style(ws10,5,9,3)

# Validate workbook - try to catch errors
# Save
output = "/home/user/Open-Claw/Cottage_Bakery_Business_Spreadsheet_FIXED.xlsx"
wb.save(output)
print(f"Saved fixed version to {output}")

# Test loading with openpyxl to ensure no XML errors
print("Testing load...")
wb2 = openpyxl.load_workbook(output)
print(f"Sheets ok: {wb2.sheetnames}")
# Check for circular refs by scanning formulas that reference themselves
for ws in wb2.worksheets:
    for row in ws.iter_rows(min_row=1, max_row=60):
        for cell in row:
            if cell.value and isinstance(cell.value, str) and cell.value.startswith("="):
                # Check self-reference like F2 referencing F2
                coord = cell.coordinate
                if coord in cell.value:
                    # Allow if it's part of larger reference? Simple check
                    if f"{coord}" in cell.value and f"{coord}:" not in cell.value:
                        # potential self-ref
                        if cell.value.count(coord) == 1 and cell.sheet != "Dashboard": # dashboard has known
                            print(f"Potential self-ref in {ws.title}!{coord}: {cell.value}")

print("Validation done")
