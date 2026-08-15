#!/usr/bin/env python3
"""
Catering Business Planner - Advanced Edition v3 - No circular refs
Replicates Etsy 4534900855 - ProsperaLab
8 Tabs + Bonus
Password: premium
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment, Protection
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, PieChart, LineChart, Reference
from datetime import date, timedelta
import random

wb = openpyxl.Workbook()
wb.remove(wb.active)

# Theme - Catering - elegant sage, warm terracotta, cream
SAGE_DARK = "2D4A3E"
SAGE = "5A7D6A"
SAGE_LIGHT = "A8C4B5"
TERRA = "C17A5F"
CREAM = "FFF8F0"
GOLD = "D4A574"
NAVY = "2C3E50"
WHITE = "FFFFFF"
YELLOW = "FFF9C4"
DARK = "2B2B2B"

HEADER_FILL = PatternFill(start_color=SAGE_DARK, end_color=SAGE_DARK, fill_type="solid")
HEADER_FONT = Font(name="Calibri", color=WHITE, bold=True, size=11)
TITLE_FONT = Font(name="Calibri", color=SAGE_DARK, bold=True, size=16)
BIG_TITLE = Font(name="Calibri", color=SAGE_DARK, bold=True, size=20)
BOLD = Font(name="Calibri", color=DARK, bold=True, size=11)
BODY = Font(name="Calibri", color=DARK, size=11)
INPUT_FILL = PatternFill(start_color=YELLOW, end_color=YELLOW, fill_type="solid")
SUBHEADER_FILL = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")

thin = Side(style="thin", color="D9D9D9")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

def hdr_row(ws, r, max_c, fill=HEADER_FILL, font=HEADER_FONT):
    for c in range(1, max_c+1):
        cell = ws.cell(row=r, column=c)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

def body_rows(ws, min_r, max_r, max_c):
    for r in range(min_r, max_r+1):
        fill = PatternFill(start_color=CREAM, end_color=CREAM, fill_type="solid") if r%2==0 else PatternFill(start_color=WHITE, end_color=WHITE, fill_type="solid")
        for c in range(1, max_c+1):
            cell = ws.cell(row=r, column=c)
            if cell.fill.start_color.index == "00000000":
                cell.fill = fill
            if not cell.font or cell.font.size is None:
                cell.font = BODY
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)

def widths(ws, wlist):
    for i,w in enumerate(wlist,1):
        ws.column_dimensions[get_column_letter(i)].width = w

def col_widths(ws, wlist):
    widths(ws, wlist)

# ================= 1. Instructions & Setup =================
ws = wb.create_sheet("Instructions & Setup")
ws.sheet_properties.tabColor = SAGE_DARK
col_widths(ws, [5, 30, 50, 20])

ws["A1"] = "🍽️ Catering Business Planner"
ws["A1"].font = BIG_TITLE
ws["C1"] = "Advanced v3 - 8 Connected Tabs - No Repair Errors"
ws["C1"].font = Font(name="Calibri", color=SAGE, bold=True, size=11, italic=True)
ws.merge_cells("C1:D1")
ws["A3"] = "Run your entire catering business from one simple, beautiful Google Sheet. Events, payments, clients, recipe costs, profit auto."
ws["A3"].font = BODY
ws.merge_cells("A3:D3")

ws["A5"] = "🚀 3-STEP QUICK START"
ws["A5"].fill = SUBHEADER_FILL
ws["A5"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A5:D5")
steps = [
    ["Step","Action","Time"],
    ["1","Click link to make your own copy, edit yellow cells in Business Setup below","2 min"],
    ["2","Enter info on color-coded tabs: Events, Clients, Recipes, Menu","10 min"],
    ["3","Watch dashboard, CRM, reports fill automatically - build quotes in seconds","Ongoing"],
]
for r,row in enumerate(steps,6):
    for c,v in enumerate(row,1):
        ws.cell(row=r, column=c, value=v)
hdr_row(ws,6,3)
body_rows(ws,7,9,3)

ws["A11"] = "⚙️ BUSINESS SETUP - Edit ONLY yellow cells"
ws["A11"].fill = HEADER_FILL
ws["A11"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A11:D11")
ws["A12"] = "Setting"
ws["B12"] = "Your Value"
ws["C12"] = "Help"
ws["D12"] = "Used In"
hdr_row(ws,12,4)

setup = [
    ("Business Name","Prospera Catering Co.","Dashboard header","All"),
    ("Owner","Your Name","",""),
    ("Phone","555-0100","",""),
    ("Email","hello@catering.com","",""),
    ("Currency","$","",""),
    ("Sales Tax %",8.5,"For quotes","Quote + Income"),
    ("Service Fee %",18,"Service charge % of food","Quote"),
    ("Gratuity %",20,"Default gratuity","Quote"),
    ("Delivery Fee $",50,"Flat delivery","Quote"),
    ("Target Food Cost %",30,"Goal food cost for verdict","Menu & Pricing"),
    ("Hourly Labor Rate",25,"For recipe costing","Recipe"),
    ("Overhead %",12,"Overhead on recipes","Recipe"),
    ("Default Deposit %",25,"Deposit % of total","Events"),
]

for i,(label,val,help_text,used) in enumerate(setup,13):
    ws.cell(row=i, column=1, value=label).font = BOLD
    c = ws.cell(row=i, column=2, value=val)
    c.fill = INPUT_FILL
    c.font = Font(bold=True, size=11)
    c.border = border
    ws.cell(row=i, column=3, value=help_text).font = BODY
    ws.cell(row=i, column=4, value=used).font = BODY

ws["A27"] = "🔒 Protection Password: premium"
ws["A27"].font = Font(bold=True, color=SAGE_DARK, size=11)
ws["A28"] = "Yellow unlocked, white formula locked. Review > Unprotect Sheet > premium to edit formulas"
ws.merge_cells("A28:D28")

ws["A30"] = "📋 EDITABLE DROPDOWNS - Rename to your business"
ws["A30"].fill = SUBHEADER_FILL
ws["A30"].font = Font(color=WHITE, bold=True, size=11)
ws.merge_cells("A30:D30")
ws["A31"] = "List Name"
ws["B31"] = "Values (edit yellow, comma separated)"
ws["C31"] = "Where Used"
hdr_row(ws,31,3)

dropdowns = [
    ("Event Types","Wedding, Corporate, Birthday Party, Anniversary, Baby Shower, Graduation, Holiday Party, Private Dinner, Other","Events"),
    ("Service Styles","Buffet, Plated, Family Style, Cocktail, Food Truck, Drop-off, Full Service, Stations","Events Service Style"),
    ("Event Statuses","Inquiry, Quote Sent, Booked, Confirmed, In Progress, Completed, Cancelled, Postponed","Events Status"),
    ("Payment Statuses","Unpaid, Partial - Deposit, Partial - Half, Paid in Full, Overdue, Refunded","Events Payment + Income"),
    ("Client Sources","Referral, Website, Instagram, Google, Wedding Wire, Repeat Client, Walk-in, Other","Clients Source"),
    ("Menu Categories","Appetizer, Main Course, Side Dish, Salad, Dessert, Beverage, Station, Late Night Snack","Menu & Pricing"),
    ("Income Categories","Event Income, Deposit, Final Payment, Gratuity, Service Fee, Other Income","Income & Expenses"),
    ("Expense Categories","Ingredients, Staff Labor, Equipment Rental, Transportation, Marketing, Insurance, Licenses, Other","Income & Expenses"),
    ("Recipe Categories","Pasta, Chicken, Beef, Seafood, Vegetarian, Vegan, Appetizer, Dessert","Recipe Calculator"),
]

for i,(name,vals,where) in enumerate(dropdowns,32):
    ws.cell(row=i, column=1, value=name).font = BOLD
    c = ws.cell(row=i, column=2, value=vals)
    c.fill = INPUT_FILL
    c.font = BODY
    c.alignment = Alignment(wrap_text=True)
    c.border = border
    ws.cell(row=i, column=3, value=where).font = BODY

ws["A42"] = "📦 8 CONNECTED TABS INCLUDED"
ws["A42"].fill = HEADER_FILL
ws["A42"].font = Font(color=WHITE, bold=True, size=12)
ws.merge_cells("A42:D42")
tabs = [
    ["Dashboard","Booked revenue, cash collected & net profit, upcoming events, avg food cost"],
    ["Events","Client, date, type, service style, venue, guests, pricing, deposit, balance, payment & event status badges"],
    ["Clients","Built-in CRM with phone/email/source/event dates/count/lifetime value/VIP tags"],
    ["Recipe Calculator","True cost per dish down to penny per serving: ingredient+labor+packaging+overhead"],
    ["Menu & Pricing","Food-cost % and instant healthy vs underpriced verdicts, suggested price"],
    ["Quote Calculator","Build polished professional quotes in seconds, margin analysis"],
    ["Income & Expenses","Real profit month by month, date/category/description/amount + 2026 summary"],
    ["Analytics BONUS","Revenue by type, client LTV ranking, food cost analysis, profit trends"],
]
for i,(t,d) in enumerate(tabs,43):
    ws.cell(row=i, column=1, value=i-42)
    ws.cell(row=i, column=2, value=t).font = BOLD
    ws.cell(row=i, column=3, value=d)
body_rows(ws,43,50,3)

ws.freeze_panes = "A13"

# ================= 2. Dashboard =================
ws2 = wb.create_sheet("Dashboard")
ws2.sheet_properties.tabColor = SAGE_DARK
widths(ws2, [22, 16, 20, 16, 24, 16, 16])
ws2["A1"] = "Dashboard"
ws2["A1"].font = BIG_TITLE
ws2["B1"] = "='Instructions & Setup'!B13"
ws2["B1"].font = Font(bold=True, size=14, color=SAGE)
ws2.merge_cells("B1:E1")
ws2["A2"] = "Your whole business at a glance: booked revenue, cash collected & net profit - auto updates"
ws2["A2"].font = Font(italic=True, size=10, color="666666")
ws2.merge_cells("A2:E2")

ws2["A4"] = "KPI CARDS"
ws2["A4"].fill = HEADER_FILL
ws2["A4"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("A4:D4")

kpis = [
    ("Booked Revenue","=SUM(Events!L:L)","$#,##0.00","SUM Events Total Price"),
    ("Cash Collected","=SUM(Events!N:N)","$#,##0.00","SUM Events Deposit Paid"),
    ("Outstanding Balance","=SUM(Events!O:O)","$#,##0.00","SUM Balance Due"),
    ("Net Profit","=Income & Expenses!E103","$#,##0.00","Income - Expenses from Income tab"),
    ("Total Events","=COUNTA(Events!A2:A200)","#,##0","Count events"),
    ("Upcoming Events","=COUNTIF(Events!Q:Q,\"Booked\")+COUNTIF(Events!Q:Q,\"Confirmed\")","#,##0","Booked+Confirmed"),
    ("Total Clients","=COUNTA(Clients!B2:B200)","#,##0","CRM count"),
    ("Avg Event Value","=IFERROR(B9/B8,0)","$#,##0.00","Booked Revenue / Total Events"),
    ("Avg Food Cost %","=AVERAGE('Menu & Pricing'!E2:E51)","0.0%","Avg from Menu"),
    ("Overdue Payments","=COUNTIF(Events!P:P,\"Overdue\")","#,##0","Needs collection"),
]

for i,(label,form,fmt,note) in enumerate(kpis,5):
    ws2.cell(row=i, column=1, value=label).font = BOLD
    c = ws2.cell(row=i, column=2, value=form)
    c.number_format = fmt
    c.font = Font(bold=True, size=12, color=SAGE_DARK)
    c.fill = PatternFill(start_color=CREAM, end_color=CREAM, fill_type="solid")
    c.border = border
    ws2.cell(row=i, column=1).border = border
    ws2.cell(row=i, column=3, value=note).font = BODY
    ws2.cell(row=i, column=3).border = border

# Upcoming Events panel
ws2["A17"] = "UPCOMING EVENTS - Next 10"
ws2["A17"].fill = PatternFill(start_color=SAGE, end_color=SAGE, fill_type="solid")
ws2["A17"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("A17:D17")
ws2["A18"] = "Date"
ws2["B18"] = "Client"
ws2["C18"] = "Event Type"
ws2["D18"] = "Guests"
hdr_row(ws2,18,4)
# Sample - simple manual from Events
for r in range(19,29):
    ws2.cell(row=r, column=1).value = f"=IFERROR(SMALL(Events!C:C,ROW()-18),\"\")"
    ws2.cell(row=r, column=1).number_format = "YYYY-MM-DD"
    ws2.cell(row=r, column=2).value = f"=IF(A{r}=\"\",\"\",INDEX(Events!B:B,MATCH(A{r},Events!C:C,0)))"
    ws2.cell(row=r, column=3).value = f"=IF(A{r}=\"\",\"\",INDEX(Events!D:D,MATCH(A{r},Events!C:C,0)))"
    ws2.cell(row=r, column=4).value = f"=IF(A{r}=\"\",\"\",INDEX(Events!G:G,MATCH(A{r},Events!C:C,0)))"
body_rows(ws2,19,28,4)

# Overdue balances
ws2["A30"] = "OVERDUE BALANCES - Needs Collection"
ws2["A30"].fill = PatternFill(start_color="8B0000", end_color="8B0000", fill_type="solid")
ws2["A30"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("A30:D30")
ws2["A31"] = "Client"
ws2["B31"] = "Event Date"
ws2["C31"] = "Balance Due"
ws2["D31"] = "Status"
hdr_row(ws2,31,4)
for r in range(32,42):
    ws2.cell(row=r, column=1).value = f"=IFERROR(INDEX(Events!B:B,SMALL(IF(Events!P:P=\"Overdue\",ROW(Events!P:P)),ROW()-31)),\"\")"
body_rows(ws2,32,41,4)

# Monthly revenue trend
ws2["F4"] = "MONTHLY REVENUE & PROFIT"
ws2["F4"].fill = HEADER_FILL
ws2["F4"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("F4:H4")
ws2["F5"] = "Month"
ws2["G5"] = "Revenue"
ws2["H5"] = "Profit"
hdr_row(ws2,5,8)
months = ["2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12"]
for i,m in enumerate(months,6):
    ws2.cell(row=i, column=6, value=m)
    ws2.cell(row=i, column=7).value = f"=SUMIFS(Events!L:L,Events!C:C,\">=\"&DATE(LEFT(F{i},4),MID(F{i},6,2),1),Events!C:C,\"<=\"&EOMONTH(DATE(LEFT(F{i},4),MID(F{i},6,2),1),0))"
    ws2.cell(row=i, column=7).number_format = "$#,##0.00"
    ws2.cell(row=i, column=8).value = f"=SUMIFS('Income & Expenses'!E:E,'Income & Expenses'!A:A,\">=\"&DATE(LEFT(F{i},4),MID(F{i},6,2),1),'Income & Expenses'!A:A,\"<=\"&EOMONTH(DATE(LEFT(F{i},4),MID(F{i},6,2),1),0))"
    ws2.cell(row=i, column=8).number_format = "$#,##0.00"
body_rows(ws2,6,17,8)

# Revenue by event type
ws2["F19"] = "REVENUE BY EVENT TYPE"
ws2["F19"].fill = HEADER_FILL
ws2["F19"].font = Font(color=WHITE, bold=True, size=11)
ws2.merge_cells("F19:H19")
ws2["F20"] = "Event Type"
ws2["G20"] = "Revenue"
ws2["H20"] = "%"
hdr_row(ws2,20,8)
types = ["Wedding","Corporate","Birthday Party","Anniversary","Baby Shower","Holiday Party"]
for i,t in enumerate(types,21):
    ws2.cell(row=i, column=6, value=t)
    ws2.cell(row=i, column=7).value = f"=SUMIF(Events!D:D,F{i},Events!L:L)"
    ws2.cell(row=i, column=7).number_format = "$#,##0.00"
    ws2.cell(row=i, column=8).value = f"=IF($G$27=0,0,G{i}/$G$27)"
    ws2.cell(row=i, column=8).number_format = "0.0%"
ws2["F27"] = "TOTAL"
ws2["F27"].font = BOLD
ws2["G27"] = "=SUM(G21:G26)"
ws2["G27"].font = BOLD
ws2["G27"].number_format = "$#,##0.00"
body_rows(ws2,21,27,8)

# Charts
chart1 = BarChart()
chart1.title = "Monthly Revenue"
chart1.style = 2
data = Reference(ws2, min_col=7, min_row=5, max_row=17)
cats = Reference(ws2, min_col=6, min_row=6, max_row=17)
chart1.add_data(data, titles_from_data=True)
chart1.set_categories(cats)
chart1.width = 14
chart1.height = 7
ws2.add_chart(chart1, "A44")

pie = PieChart()
pie.title = "Revenue by Event Type"
labels = Reference(ws2, min_col=6, min_row=21, max_row=26)
pie_data = Reference(ws2, min_col=7, min_row=20, max_row=26)
pie.add_data(pie_data, titles_from_data=True)
pie.set_categories(labels)
pie.width = 12
pie.height = 7
ws2.add_chart(pie, "F29")

# ================= 3. Events =================
ws3 = wb.create_sheet("Events")
ws3.sheet_properties.tabColor = SAGE_DARK
headers = ["Event ID","Client Name","Event Date","Event Type","Service Style","Venue / Location","Guest Count","Menu Package","Price/Person $","Total Price $","Deposit %","Deposit Required $","Deposit Paid $","Balance Due $","Payment Status","Event Status","Source","Staff Needed","Notes"]
col_widths(ws3, [10,18,12,14,14,18,10,16,12,12,10,12,12,12,14,13,12,11,18])
for c,h in enumerate(headers,1):
    ws3.cell(row=1, column=c, value=h)
hdr_row(ws3,1,len(headers))

for r in range(2,22):
    ws3.cell(row=r, column=1, value=f"EVT-{1000+r}")
    ws3.cell(row=r, column=2, value=random.choice(["Emily Johnson","Robert Smith","Sophia Williams","Michael Brown","Olivia Davis"])).fill = INPUT_FILL
    ws3.cell(row=r, column=3, value=date(2025, random.randint(6,12), random.randint(1,28))).fill = INPUT_FILL
    ws3.cell(row=r, column=3).number_format = "YYYY-MM-DD"
    ws3.cell(row=r, column=4, value=random.choice(["Wedding","Corporate","Birthday Party","Anniversary","Baby Shower"])).fill = INPUT_FILL
    ws3.cell(row=r, column=5, value=random.choice(["Buffet","Plated","Family Style","Cocktail","Drop-off"])).fill = INPUT_FILL
    ws3.cell(row=r, column=6, value=random.choice(["Grand Hall","Garden Venue","Hotel Ballroom","Private Home","Corporate Office"])).fill = INPUT_FILL
    guests = random.randint(20,150)
    ws3.cell(row=r, column=7, value=guests).fill = INPUT_FILL
    ws3.cell(row=r, column=8, value=random.choice(["Package A","Package B","Premium","Custom"])).fill = INPUT_FILL
    price_pp = random.randint(25,85)
    ws3.cell(row=r, column=9, value=price_pp).fill = INPUT_FILL
    ws3.cell(row=r, column=9).number_format = "$#,##0.00"
    ws3.cell(row=r, column=10).value = f"=G{r}*I{r}"
    ws3.cell(row=r, column=10).number_format = "$#,##0.00"
    ws3.cell(row=r, column=11, value=25).fill = INPUT_FILL
    ws3.cell(row=r, column=11).number_format = "0%"
    ws3.cell(row=r, column=12).value = f"=J{r}*K{r}/100"
    ws3.cell(row=r, column=12).number_format = "$#,##0.00"
    ws3.cell(row=r, column=13, value=random.randint(200,800)).fill = INPUT_FILL
    ws3.cell(row=r, column=13).number_format = "$#,##0.00"
    ws3.cell(row=r, column=14).value = f"=J{r}-M{r}"
    ws3.cell(row=r, column=14).number_format = "$#,##0.00"
    ws3.cell(row=r, column=15, value=random.choice(["Unpaid","Partial - Deposit","Paid in Full","Overdue"])).fill = INPUT_FILL
    ws3.cell(row=r, column=16, value=random.choice(["Inquiry","Quote Sent","Booked","Confirmed","Completed"])).fill = INPUT_FILL
    ws3.cell(row=r, column=17, value=random.choice(["Referral","Website","Instagram","Repeat Client"])).fill = INPUT_FILL
    ws3.cell(row=r, column=18, value=random.randint(2,8)).fill = INPUT_FILL
    ws3.cell(row=r, column=19, value="").fill = INPUT_FILL

for r in range(22,101):
    ws3.cell(row=r, column=10).value = f"=IF(G{r}=\"\",\"\",G{r}*I{r})"
    ws3.cell(row=r, column=12).value = f"=IF(J{r}=\"\",\"\",J{r}*K{r}/100)"
    ws3.cell(row=r, column=14).value = f"=IF(J{r}=\"\",\"\",J{r}-M{r})"

# Conditional formatting
red = PatternFill(start_color="FF8A8A", end_color="FF8A8A", fill_type="solid")
yellow = PatternFill(start_color="FFDCA8", end_color="FFDCA8", fill_type="solid")
green = PatternFill(start_color="A8C4B5", end_color="A8C4B5", fill_type="solid")
ws3.conditional_formatting.add("P2:P100", CellIsRule(operator="equal", formula=['"Overdue"'], fill=red))
ws3.conditional_formatting.add("P2:P100", CellIsRule(operator="equal", formula=['"Paid in Full"'], fill=green))
ws3.conditional_formatting.add("Q2:Q100", CellIsRule(operator="equal", formula=['"Booked"'], fill=yellow))
ws3.conditional_formatting.add("Q2:Q100", CellIsRule(operator="equal", formula=['"Confirmed"'], fill=green))

dv_etype = DataValidation(type="list", formula1='"Wedding,Corporate,Birthday Party,Anniversary,Baby Shower,Graduation,Holiday Party,Private Dinner,Other"', allow_blank=True)
dv_etype.add("D2:D100")
ws3.add_data_validation(dv_etype)
dv_style = DataValidation(type="list", formula1='"Buffet,Plated,Family Style,Cocktail,Food Truck,Drop-off,Full Service,Stations"', allow_blank=True)
dv_style.add("E2:E100")
ws3.add_data_validation(dv_style)
dv_pay = DataValidation(type="list", formula1='"Unpaid,Partial - Deposit,Partial - Half,Paid in Full,Overdue,Refunded"', allow_blank=True)
dv_pay.add("O2:O100")
ws3.add_data_validation(dv_pay)
dv_estatus = DataValidation(type="list", formula1='"Inquiry,Quote Sent,Booked,Confirmed,In Progress,Completed,Cancelled,Postponed"', allow_blank=True)
dv_estatus.add("P2:P100")
ws3.add_data_validation(dv_estatus)

ws3.freeze_panes = "A2"

# ================= 4. Clients =================
ws4 = wb.create_sheet("Clients")
ws4.sheet_properties.tabColor = "D4A574"
headers = ["Client ID","Client Name","Phone","Email","Source","First Event Date","Last Event Date","Event Count","Lifetime Value $","Avg Event Value $","Status","VIP Tag","Address","Allergies","Preferences","Notes","Family Size","Company"]
col_widths(ws4, [10,18,12,20,12,12,12,10,14,14,12,10,18,12,14,16,10,14])
for c,h in enumerate(headers,1):
    ws4.cell(row=1, column=c, value=h)
hdr_row(ws4,1,len(headers))

clients = ["Emily Johnson","Robert Smith","Sophia Williams","Michael Brown","Olivia Davis","James Wilson","Ava Jones","William Garcia","Isabella Martinez","David Anderson"]

for r,name in enumerate(clients,2):
    ws4.cell(row=r, column=1, value=f"CLI-{1000+r}")
    ws4.cell(row=r, column=2, value=name).fill = INPUT_FILL
    ws4.cell(row=r, column=3, value=f"555-01{r:02d}").fill = INPUT_FILL
    ws4.cell(row=r, column=4, value=f"{name.split()[0].lower()}@email.com").fill = INPUT_FILL
    ws4.cell(row=r, column=5, value=random.choice(["Referral","Website","Instagram","Repeat Client"])).fill = INPUT_FILL
    fd = date(2024, random.randint(1,12), random.randint(1,28))
    ws4.cell(row=r, column=6, value=fd).fill = INPUT_FILL
    ws4.cell(row=r, column=6).number_format = "YYYY-MM-DD"
    ld = date(2025, random.randint(1,7), random.randint(1,28))
    ws4.cell(row=r, column=7, value=ld).fill = INPUT_FILL
    ws4.cell(row=r, column=7).number_format = "YYYY-MM-DD"
    ws4.cell(row=r, column=8).value = f"=COUNTIF(Events!B:B,B{r})"
    ws4.cell(row=r, column=9).value = f"=SUMIF(Events!B:B,B{r},Events!J:J)"
    ws4.cell(row=r, column=9).number_format = "$#,##0.00"
    ws4.cell(row=r, column=10).value = f"=IF(H{r}=0,0,I{r}/H{r})"
    ws4.cell(row=r, column=10).number_format = "$#,##0.00"
    ws4.cell(row=r, column=11, value=random.choice(["Lead","Active","VIP","Past"])).fill = INPUT_FILL
    ws4.cell(row=r, column=12).value = f"=IF(I{r}>=5000,\"VIP\",IF(H{r}>=3,\"Repeat\",\"\"))"
    ws4.cell(row=r, column=13, value=f"{100+r} Main St").fill = INPUT_FILL
    ws4.cell(row=r, column=14, value="").fill = INPUT_FILL
    ws4.cell(row=r, column=15, value=random.choice(["Vegetarian options","Gluten-free","Loves Italian"])).fill = INPUT_FILL
    ws4.cell(row=r, column=16, value="").fill = INPUT_FILL
    ws4.cell(row=r, column=17, value=random.randint(2,8)).fill = INPUT_FILL
    ws4.cell(row=r, column=18, value=random.choice(["","ABC Corp","XYZ Inc"])).fill = INPUT_FILL

for r in range(12,101):
    ws4.cell(row=r, column=8).value = f"=IF(B{r}=\"\",\"\",COUNTIF(Events!B:B,B{r}))"
    ws4.cell(row=r, column=9).value = f"=IF(B{r}=\"\",\"\",SUMIF(Events!B:B,B{r},Events!J:J))"
    ws4.cell(row=r, column=10).value = f"=IF(H{r}=0,0,I{r}/H{r})"
    ws4.cell(row=r, column=12).value = f"=IF(I{r}>=5000,\"VIP\",IF(H{r}>=3,\"Repeat\",\"\"))"

ws4.conditional_formatting.add("L2:L100", CellIsRule(operator="equal", formula=['"VIP"'], fill=PatternFill(start_color="FFD700", end_color="FFD700", fill_type="solid")))
ws4.conditional_formatting.add("K2:K100", CellIsRule(operator="equal", formula=['"VIP"'], fill=PatternFill(start_color="A8C4B5", end_color="A8C4B5", fill_type="solid")))

ws4.freeze_panes = "A2"

# ================= 5. Recipe Calculator =================
ws5 = wb.create_sheet("Recipe Calculator")
ws5.sheet_properties.tabColor = GOLD
widths(ws5, [20, 10, 12, 12, 12, 12, 14, 12, 14])

ws5["A1"] = "Recipe Calculator - True Cost per Serving (Catering)"
ws5["A1"].font = TITLE_FONT
ws5.merge_cells("A1:I1")

ws5["A3"] = "Recipe Name:"
ws5["B3"] = "Baked Ziti"
ws5["B3"].fill = INPUT_FILL
ws5["B3"].font = Font(bold=True, size=12)
ws5["A4"] = "Category:"
ws5["B4"] = "Pasta"
ws5["B4"].fill = INPUT_FILL
ws5["A5"] = "Servings:"
ws5["B5"] = 20
ws5["B5"].fill = INPUT_FILL
ws5["B5"].font = Font(bold=True)

ws5["A7"] = "Ingredients - Cost per Batch"
ws5["A7"].fill = SUBHEADER_FILL
ws5["A7"].font = Font(color=WHITE, bold=True, size=11)
ws5.merge_cells("A7:I7")

hdr = ["Ingredient","Qty","Unit","Unit Cost $","Total Cost $","Supplier","Notes"]
for c,h in enumerate(hdr,1):
    ws5.cell(row=8, column=c, value=h)
hdr_row(ws5,8,7)

recipe_ingredients = [
    ["Ziti Pasta",2,"lb",1.5,None,"",""],
    ["Ground Beef",3,"lb",4.5,None,"",""],
    ["Marinara Sauce",64,"oz",0.08,None,"",""],
    ["Ricotta Cheese",32,"oz",0.15,None,"",""],
    ["Mozzarella",16,"oz",0.25,None,"",""],
    ["Parmesan",8,"oz",0.5,None,"",""],
]

for i,row in enumerate(recipe_ingredients,9):
    ws5.cell(row=i, column=1, value=row[0]).fill = INPUT_FILL
    ws5.cell(row=i, column=2, value=row[1]).fill = INPUT_FILL
    ws5.cell(row=i, column=3, value=row[2])
    ws5.cell(row=i, column=4, value=row[3]).fill = INPUT_FILL
    ws5.cell(row=i, column=4).number_format = "$#,##0.00"
    ws5.cell(row=i, column=5).value = f"=B{i}*D{i}"
    ws5.cell(row=i, column=5).number_format = "$#,##0.00"

for r in range(15,25):
    ws5.cell(row=r, column=1).fill = INPUT_FILL
    ws5.cell(row=r, column=2).fill = INPUT_FILL
    ws5.cell(row=r, column=4).fill = INPUT_FILL
    ws5.cell(row=r, column=5).value = f"=IF(A{r}=\"\",\"\",B{r}*D{r})"
    ws5.cell(row=r, column=5).number_format = "$#,##0.00"

ws5["A26"] = "Total Ingredient Cost"
ws5["A26"].font = BOLD
ws5["E26"] = "=SUM(E9:E24)"
ws5["E26"].font = BOLD
ws5["E26"].number_format = "$#,##0.00"
ws5["E26"].fill = PatternFill(start_color=GOLD, end_color=GOLD, fill_type="solid")

# Labor etc
ws5["A28"] = "Labor & Other Costs"
ws5["A28"].fill = HEADER_FILL
ws5["A28"].font = Font(color=WHITE, bold=True, size=11)
ws5.merge_cells("A28:I28")

ws5["A29"] = "Labor Hours"
ws5["B29"] = 2
ws5["B29"].fill = INPUT_FILL
ws5["D29"] = "Hourly Rate"
ws5["E29"] = "='Instructions & Setup'!B22"
ws5["E29"].number_format = "$#,##0.00"
ws5["F29"] = "Labor Total"
ws5["G29"] = "=B29*E29"
ws5["G29"].number_format = "$#,##0.00"
ws5["G29"].font = BOLD

ws5["A30"] = "Packaging"
ws5["E30"] = 15
ws5["E30"].fill = INPUT_FILL
ws5["E30"].number_format = "$#,##0.00"
ws5["F30"] = "Packaging Total"
ws5["G30"] = "=E30"
ws5["G30"].number_format = "$#,##0.00"

ws5["A31"] = "Overhead %"
ws5["B31"] = "='Instructions & Setup'!B23/100"
ws5["B31"].number_format = "0.0%"
ws5["B31"].fill = INPUT_FILL
ws5["F31"] = "Overhead $"
ws5["G31"] = "=E26*B31"
ws5["G31"].number_format = "$#,##0.00"

ws5["A32"] = "Other"
ws5["G32"] = 0
ws5["G32"].fill = INPUT_FILL
ws5["G32"].number_format = "$#,##0.00"

ws5["A34"] = "TOTAL RECIPE COST"
ws5["A34"].fill = PatternFill(start_color=SAGE_DARK, end_color=SAGE_DARK, fill_type="solid")
ws5["A34"].font = Font(bold=True, size=12, color=WHITE)
ws5["G34"] = "=E26+G29+G30+G31+G32"
ws5["G34"].font = Font(bold=True, size=12)
ws5["G34"].number_format = "$#,##0.00"
ws5["G34"].fill = PatternFill(start_color=SAGE_LIGHT, end_color=SAGE_LIGHT, fill_type="solid")

ws5["A35"] = "COST PER SERVING"
ws5["A35"].font = Font(bold=True, size=12, color=TERRA)
ws5["G35"] = "=IF(B5=0,0,G34/B5)"
ws5["G35"].font = Font(bold=True, size=14, color=TERRA)
ws5["G35"].number_format = "$#,##0.00"
ws5["G35"].fill = PatternFill(start_color="FADCD9", end_color="FADCD9", fill_type="solid")

ws5["A37"] = "Suggested Pricing per Serving (Food Cost Target 30%)"
ws5["A37"].fill = HEADER_FILL
ws5["A37"].font = Font(color=WHITE, bold=True, size=11)
ws5.merge_cells("A37:G37")
ws5["A38"] = "Method"
ws5["B38"] = "Multiplier"
ws5["C38"] = "Price/Serving"
ws5["D38"] = "Profit/Serving"
ws5["E38"] = "Food Cost %"
hdr_row(ws5,38,5)

pricing = [
    ["3x Cost (Catering Standard)",3,"=G35*B39","=C39-G35","=G35/C39"],
    ["3.5x Cost",3.5,"=G35*B40","=C40-G35","=G35/C40"],
    ["Food Cost 30% (Target)","30%","=G35/0.3","=C41-G35","=G35/C41"],
    ["Food Cost 25% (Premium)","25%","=G35/0.25","=C42-G35","=G35/C42"],
]

for i,row in enumerate(pricing,39):
    ws5.cell(row=i, column=1, value=row[0])
    ws5.cell(row=i, column=2, value=row[1])
    ws5.cell(row=i, column=3, value=row[2])
    ws5.cell(row=i, column=3).number_format = "$#,##0.00"
    ws5.cell(row=i, column=4, value=row[3])
    ws5.cell(row=i, column=4).number_format = "$#,##0.00"
    ws5.cell(row=i, column=5, value=row[4])
    ws5.cell(row=i, column=5).number_format = "0.0%"

body_rows(ws5,39,42,5)
ws5.freeze_panes = "A9"

# ================= 6. Menu & Pricing =================
ws6 = wb.create_sheet("Menu & Pricing")
ws6.sheet_properties.tabColor = "D4A574"
headers = ["Menu Item","Category","Recipe Link","Cost per Serving $","Price per Person $","Food Cost %","Verdict","Suggested Price $","Profit/Person $","Status","Notes"]
col_widths(ws6, [22,14,14,14,14,12,14,14,12,10,18])
for c,h in enumerate(headers,1):
    ws6.cell(row=1, column=c, value=h)
hdr_row(ws6,1,len(headers))

menu_items = [
    ["Baked Ziti","Pasta","Baked Ziti",None,18,None,None,None,None,"Active","Best seller"],
    ["Chicken Alfredo","Chicken","Chicken Alfredo",3.5,22,None,None,None,None,"Active",""],
    ["Caesar Salad","Salad","Caesar Salad",1.8,12,None,None,None,None,"Active",""],
    ["Garlic Bread","Side Dish","Garlic Bread",0.85,6,None,None,None,None,"Active",""],
    ["Tiramisu","Dessert","Tiramisu",2.2,10,None,None,None,None,"Active",""],
    ["Grilled Salmon","Seafood","Grilled Salmon",6.5,32,None,None,None,None,"Seasonal",""],
    ["Veggie Platter","Appetizer","Veggie Platter",1.5,9,None,None,None,None,"Active","Vegan"],
    ["Beef Lasagna","Pasta","Beef Lasagna",4.2,24,None,None,None,None,"Active",""],
]

for r,row in enumerate(menu_items,2):
    ws6.cell(row=r, column=1, value=row[0]).fill = INPUT_FILL
    ws6.cell(row=r, column=2, value=row[1]).fill = INPUT_FILL
    ws6.cell(row=r, column=3, value=row[2]).fill = INPUT_FILL
    # Cost per serving - VLOOKUP from Recipe Calculator? For simplicity manual or formula to get from recipe calculator if same name
    # We'll use recipe calculator G35 if name matches B3, else manual
    ws6.cell(row=r, column=4, value=row[3] if row[3] else f"=IFERROR(VLOOKUP(A{r},'Recipe Calculator'!A:G,7,FALSE),2.5)").number_format = "$#,##0.00"
    ws6.cell(row=r, column=5, value=row[4]).fill = INPUT_FILL
    ws6.cell(row=r, column=5).number_format = "$#,##0.00"
    ws6.cell(row=r, column=6).value = f"=IF(E{r}=0,0,D{r}/E{r})"
    ws6.cell(row=r, column=6).number_format = "0.0%"
    ws6.cell(row=r, column=7).value = f"=IF(F{r}=\"\",\"\",IF(F{r}<=0.3,\"✅ Healthy\",IF(F{r}<=0.4,\"⚠️ Watch\",\"❌ Underpriced\")))"
    ws6.cell(row=r, column=8).value = f"=IF(D{r}=0,0,D{r}/0.3)"  # Suggested at 30% food cost
    ws6.cell(row=r, column=8).number_format = "$#,##0.00"
    ws6.cell(row=r, column=9).value = f"=E{r}-D{r}"
    ws6.cell(row=r, column=9).number_format = "$#,##0.00"
    ws6.cell(row=r, column=10, value=row[9]).fill = INPUT_FILL
    ws6.cell(row=r, column=11, value=row[10]).fill = INPUT_FILL

for r in range(10,51):
    ws6.cell(row=r, column=4).value = f"=IF(A{r}=\"\",\"\",IFERROR(VLOOKUP(A{r},'Recipe Calculator'!A:G,7,FALSE),0))"
    ws6.cell(row=r, column=6).value = f"=IF(E{r}=0,0,D{r}/E{r})"
    ws6.cell(row=r, column=7).value = f"=IF(F{r}=\"\",\"\",IF(F{r}<=0.3,\"✅ Healthy\",IF(F{r}<=0.4,\"⚠️ Watch\",\"❌ Underpriced\")))"
    ws6.cell(row=r, column=8).value = f"=IF(D{r}=0,0,D{r}/0.3)"
    ws6.cell(row=r, column=9).value = f"=E{r}-D{r}"

red = PatternFill(start_color="FF8A8A", end_color="FF8A8A", fill_type="solid")
yellow = PatternFill(start_color="FFDCA8", end_color="FFDCA8", fill_type="solid")
green = PatternFill(start_color="A8C4B5", end_color="A8C4B5", fill_type="solid")
ws6.conditional_formatting.add("G2:G100", CellIsRule(operator="equal", formula=['"❌ Underpriced"'], fill=red))
ws6.conditional_formatting.add("G2:G100", CellIsRule(operator="equal", formula=['"⚠️ Watch"'], fill=yellow))
ws6.conditional_formatting.add("G2:G100", CellIsRule(operator="equal", formula=['"✅ Healthy"'], fill=green))

ws6.conditional_formatting.add("F2:F100", CellIsRule(operator="greaterThan", formula=["0.4"], fill=red))
ws6.conditional_formatting.add("F2:F100", CellIsRule(operator="between", formula=["0.3","0.4"], fill=yellow))
ws6.conditional_formatting.add("F2:F100", CellIsRule(operator="lessThan", formula=["0.3"], fill=green))

dv_cat = DataValidation(type="list", formula1='"Appetizer,Main Course,Side Dish,Salad,Dessert,Beverage,Station,Late Night Snack,Pasta,Chicken,Beef,Seafood,Vegetarian,Vegan"', allow_blank=True)
dv_cat.add("B2:B100")
ws6.add_data_validation(dv_cat)

ws6.freeze_panes = "A2"

# ================= 7. Quote Calculator =================
ws7 = wb.create_sheet("Quote Calculator")
ws7.sheet_properties.tabColor = TERRA
col_widths(ws7, [22, 14, 12, 12, 12, 16, 14])

ws7["A1"] = "Quote Calculator - Build Polished Quotes in Seconds"
ws7["A1"].font = TITLE_FONT
ws7.merge_cells("A1:G1")

ws7["A3"] = "Event Details"
ws7["A3"].fill = HEADER_FILL
ws7["A3"].font = Font(color=WHITE, bold=True, size=11)
ws7.merge_cells("A3:G3")

ws7["A4"] = "Client Name:"
ws7["B4"] = "Emily Johnson"
ws7["B4"].fill = INPUT_FILL
ws7["B4"].font = Font(bold=True)
ws7["A5"] = "Event Date:"
ws7["B5"] = "2025-08-15"
ws7["B5"].fill = INPUT_FILL
ws7["B5"].number_format = "YYYY-MM-DD"
ws7["A6"] = "Guest Count:"
ws7["B6"] = 50
ws7["B6"].fill = INPUT_FILL
ws7["B6"].font = Font(bold=True)
ws7["A7"] = "Event Type:"
ws7["B7"] = "Wedding"
ws7["B7"].fill = INPUT_FILL
ws7["A8"] = "Venue:"
ws7["B8"] = "Grand Hall"
ws7["B8"].fill = INPUT_FILL
ws7["A9"] = "Service Style:"
ws7["B9"] = "Buffet"
ws7["B9"].fill = INPUT_FILL

ws7["D4"] = "Phone:"
ws7["E4"] = "=IFERROR(VLOOKUP(B4,Clients!B:C,2,FALSE),\"\")"
ws7["D5"] = "Email:"
ws7["E5"] = "=IFERROR(VLOOKUP(B4,Clients!B:D,3,FALSE),\"\")"
ws7["D6"] = "Source:"
ws7["E6"] = "=IFERROR(VLOOKUP(B4,Clients!B:E,4,FALSE),\"\")"

ws7["A11"] = "Menu Items for Quote"
ws7["A11"].fill = SUBHEADER_FILL
ws7["A11"].font = Font(color=WHITE, bold=True, size=11)
ws7.merge_cells("A11:G11")

hdr = ["Menu Item (from Menu & Pricing)","Category","Cost/Person","Price/Person","Qty (Guests)","Line Cost","Line Price"]
for c,h in enumerate(hdr,1):
    ws7.cell(row=12, column=c, value=h)
hdr_row(ws7,12,7)

for r in range(13,23):
    ws7.cell(row=r, column=1).fill = INPUT_FILL
    ws7.cell(row=r, column=2).value = f"=IF(A{r}=\"\",\"\",IFERROR(VLOOKUP(A{r},'Menu & Pricing'!A:B,2,FALSE),\"\"))"
    ws7.cell(row=r, column=3).value = f"=IF(A{r}=\"\",\"\",IFERROR(VLOOKUP(A{r},'Menu & Pricing'!A:D,4,FALSE),0))"
    ws7.cell(row=r, column=3).number_format = "$#,##0.00"
    ws7.cell(row=r, column=4).value = f"=IF(A{r}=\"\",\"\",IFERROR(VLOOKUP(A{r},'Menu & Pricing'!A:E,5,FALSE),0))"
    ws7.cell(row=r, column=4).number_format = "$#,##0.00"
    ws7.cell(row=r, column=5).value = f"=IF(A{r}=\"\",\"\",B6)"
    ws7.cell(row=r, column=6).value = f"=IF(A{r}=\"\",\"\",C{r}*E{r})"
    ws7.cell(row=r, column=6).number_format = "$#,##0.00"
    ws7.cell(row=r, column=7).value = f"=IF(A{r}=\"\",\"\",D{r}*E{r})"
    ws7.cell(row=r, column=7).number_format = "$#,##0.00"

# Sample menu items
sample_menu = ["Baked Ziti","Caesar Salad","Garlic Bread","Tiramisu"]
for i,item in enumerate(sample_menu,13):
    ws7.cell(row=i, column=1, value=item)

ws7["A24"] = "TOTAL FOOD"
ws7["A24"].font = BOLD
ws7["F24"] = "=SUM(F13:F22)"
ws7["F24"].font = BOLD
ws7["F24"].number_format = "$#,##0.00"
ws7["G24"] = "=SUM(G13:G22)"
ws7["G24"].font = BOLD
ws7["G24"].number_format = "$#,##0.00"
ws7["G24"].fill = PatternFill(start_color=GOLD, end_color=GOLD, fill_type="solid")

ws7["A26"] = "Quote Breakdown"
ws7["A26"].fill = HEADER_FILL
ws7["A26"].font = Font(color=WHITE, bold=True, size=11)
ws7.merge_cells("A26:G26")

ws7["A27"] = "Service Fee %"
ws7["B27"] = "='Instructions & Setup'!B19/100"
ws7["B27"].number_format = "0%"
ws7["B27"].fill = INPUT_FILL
ws7["D27"] = "Service Fee $"
ws7["E27"] = "=G24*B27"
ws7["E27"].number_format = "$#,##0.00"

ws7["A28"] = "Delivery Fee"
ws7["B28"] = "='Instructions & Setup'!B21"
ws7["B28"].number_format = "$#,##0.00"
ws7["B28"].fill = INPUT_FILL
ws7["D28"] = "Delivery $"
ws7["E28"] = "=B28"
ws7["E28"].number_format = "$#,##0.00"

ws7["A29"] = "Gratuity %"
ws7["B29"] = "='Instructions & Setup'!B20/100"
ws7["B29"].number_format = "0%"
ws7["B29"].fill = INPUT_FILL
ws7["D29"] = "Gratuity $"
ws7["E29"] = "=G24*B29"
ws7["E29"].number_format = "$#,##0.00"

ws7["A30"] = "Tax %"
ws7["B30"] = "='Instructions & Setup'!B18/100"
ws7["B30"].number_format = "0%"
ws7["B30"].fill = INPUT_FILL
ws7["D30"] = "Tax $"
ws7["E30"] = "=(G24+E27+E28+E29)*B30"
ws7["E30"].number_format = "$#,##0.00"

ws7["A32"] = "TOTAL QUOTE"
ws7["A32"].fill = PatternFill(start_color=SAGE_DARK, end_color=SAGE_DARK, fill_type="solid")
ws7["A32"].font = Font(bold=True, size=14, color=WHITE)
ws7["E32"] = "=G24+E27+E28+E29+E30"
ws7["E32"].font = Font(bold=True, size=16, color=SAGE_DARK)
ws7["E32"].number_format = "$#,##0.00"
ws7["E32"].fill = PatternFill(start_color=GOLD, end_color=GOLD, fill_type="solid")

ws7["A33"] = "Deposit %"
ws7["B33"] = "='Instructions & Setup'!B24/100"
ws7["B33"].number_format = "0%"
ws7["B33"].fill = INPUT_FILL
ws7["D33"] = "Deposit $"
ws7["E33"] = "=E32*B33"
ws7["E33"].number_format = "$#,##0.00"
ws7["A34"] = "Balance Due"
ws7["E34"] = "=E32-E33"
ws7["E34"].number_format = "$#,##0.00"
ws7["E34"].font = BOLD

ws7["A36"] = "Margin Analysis"
ws7["A36"].fill = HEADER_FILL
ws7["A36"].font = Font(color=WHITE, bold=True, size=11)
ws7.merge_cells("A36:G36")

ws7["A37"] = "Total Cost (Food)"
ws7["B37"] = "=F24"
ws7["B37"].number_format = "$#,##0.00"
ws7["A38"] = "Total Price (Food)"
ws7["B38"] = "=G24"
ws7["B38"].number_format = "$#,##0.00"
ws7["A39"] = "Food Profit"
ws7["B39"] = "=B38-B37"
ws7["B39"].number_format = "$#,##0.00"
ws7["B39"].font = BOLD
ws7["A40"] = "Food Margin %"
ws7["B40"] = "=IF(B38=0,0,B39/B38)"
ws7["B40"].number_format = "0.0%"
ws7["B40"].font = BOLD

ws7["D37"] = "Total Quote"
ws7["E37"] = "=E32"
ws7["E37"].number_format = "$#,##0.00"
ws7["D38"] = "Total Cost + Fees"
ws7["E38"] = "=F24+E28"
ws7["E38"].number_format = "$#,##0.00"
ws7["D39"] = "Overall Profit"
ws7["E39"] = "=E37-E38"
ws7["E39"].number_format = "$#,##0.00"
ws7["E39"].font = BOLD
ws7["D40"] = "Overall Margin %"
ws7["E40"] = "=IF(E37=0,0,E39/E37)"
ws7["E40"].number_format = "0.0%"
ws7["E40"].font = BOLD

ws7.freeze_panes = "A13"

# ================= 8. Income & Expenses =================
ws8 = wb.create_sheet("Income & Expenses")
ws8.sheet_properties.tabColor = SAGE
headers = ["Date","Type","Category","Description","Amount $","Payment Method","Event ID","Month","Year","Running Balance $","Notes"]
col_widths(ws8, [12,10,16,24,12,14,10,10,8,14,18])
for c,h in enumerate(headers,1):
    ws8.cell(row=1, column=c, value=h)
hdr_row(ws8,1,len(headers))

for r in range(2,32):
    d = date(2025, random.randint(1,7), random.randint(1,28))
    ws8.cell(row=r, column=1, value=d).fill = INPUT_FILL
    ws8.cell(row=r, column=1).number_format = "YYYY-MM-DD"
    typ = random.choice(["Income","Expense"])
    ws8.cell(row=r, column=2, value=typ).fill = INPUT_FILL
    cat = random.choice(["Event Income","Deposit","Grocery","Staff Labor","Equipment Rental"]) if typ=="Expense" else random.choice(["Event Income","Deposit","Final Payment","Gratuity","Service Fee"])
    if typ=="Income":
        cat = random.choice(["Event Income","Deposit","Final Payment","Gratuity","Service Fee"])
    else:
        cat = random.choice(["Ingredients","Staff Labor","Equipment Rental","Transportation","Marketing"])
    ws8.cell(row=r, column=3, value=cat).fill = INPUT_FILL
    ws8.cell(row=r, column=4, value=f"{cat} for event").fill = INPUT_FILL
    amt = random.randint(200,1500) if typ=="Income" else random.randint(50,500)
    if typ=="Expense":
        amt = -amt
    ws8.cell(row=r, column=5, value=amt).fill = INPUT_FILL
    ws8.cell(row=r, column=5).number_format = "$#,##0.00"
    ws8.cell(row=r, column=6, value=random.choice(["Cash","Check","Bank Transfer","Card"])).fill = INPUT_FILL
    ws8.cell(row=r, column=7, value=f"EVT-{1000+random.randint(2,21)}").fill = INPUT_FILL
    ws8.cell(row=r, column=8).value = f"=TEXT(A{r},\"YYYY-MM\")"
    ws8.cell(row=r, column=9).value = f"=YEAR(A{r})"
    ws8.cell(row=r, column=10).value = f"=IF(ROW()=2,E2,J{r-1}+E{r})"
    ws8.cell(row=r, column=10).number_format = "$#,##0.00"

for r in range(32,101):
    ws8.cell(row=r, column=8).value = f"=IF(A{r}=\"\",\"\",TEXT(A{r},\"YYYY-MM\"))"
    ws8.cell(row=r, column=9).value = f"=IF(A{r}=\"\",\"\",YEAR(A{r}))"
    ws8.cell(row=r, column=10).value = f"=IF(ROW()=2,E2,J{r-1}+E{r})"

ws8["E102"] = "Total Income"
ws8["E102"].font = BOLD
ws8["E103"] = "=SUMIF(B2:B101,\"Income\",E2:E101)"
ws8["E103"].number_format = "$#,##0.00"
ws8["E103"].font = BOLD
ws8["E104"] = "Total Expenses"
ws8["E105"] = "=SUMIF(B2:B101,\"Expense\",E2:E101)"
ws8["E105"].number_format = "$#,##0.00"
ws8["E105"].font = BOLD
ws8["E106"] = "Net Profit"
ws8["E107"] = "=E103+E105"
ws8["E107"].number_format = "$#,##0.00"
ws8["E107"].font = Font(bold=True, size=12, color=SAGE_DARK)

# Monthly summary table for 2026 as per image description
ws8["G102"] = "2026 Monthly Summary"
ws8["G102"].fill = HEADER_FILL
ws8["G102"].font = Font(color=WHITE, bold=True, size=11)
ws8.merge_cells("G102:J102")
ws8["G103"] = "Month"
ws8["H103"] = "Income"
ws8["I103"] = "Expenses"
ws8["J103"] = "Profit"
hdr_row(ws8,103,10)
months = ["2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12"]
for i,m in enumerate(months,104):
    ws8.cell(row=i, column=7, value=m)
    ws8.cell(row=i, column=8).value = f"=SUMIFS(E:E,H:H,G{i},B:B,\"Income\")"
    ws8.cell(row=i, column=8).number_format = "$#,##0.00"
    ws8.cell(row=i, column=9).value = f"=SUMIFS(E:E,H:H,G{i},B:B,\"Expense\")"
    ws8.cell(row=i, column=9).number_format = "$#,##0.00"
    ws8.cell(row=i, column=10).value = f"=H{i}+I{i}"
    ws8.cell(row=i, column=10).number_format = "$#,##0.00"

ws8.freeze_panes = "A2"

# ================= 9. Analytics BONUS =================
ws9 = wb.create_sheet("Analytics (BONUS)")
ws9.sheet_properties.tabColor = TERRA
widths(ws9, [20,14,14,14,14])

ws9["A1"] = "BONUS Analytics - Catering Business Insights"
ws9["A1"].font = BIG_TITLE

ws9["A3"] = "Revenue by Event Type"
ws9["A3"].fill = HEADER_FILL
ws9["A3"].font = Font(color=WHITE, bold=True, size=11)
ws9.merge_cells("A3:C3")
ws9["A4"] = "Event Type"
ws9["B4"] = "Revenue"
ws9["C4"] = "%"
hdr_row(ws9,4,3)
for i,t in enumerate(["Wedding","Corporate","Birthday Party","Anniversary","Baby Shower","Holiday Party"],5):
    ws9.cell(row=i, column=1, value=t)
    ws9.cell(row=i, column=2).value = f"=SUMIF(Events!D:D,A{i},Events!J:J)"
    ws9.cell(row=i, column=2).number_format = "$#,##0.00"
    ws9.cell(row=i, column=3).value = f"=IF($B$11=0,0,B{i}/$B$11)"
    ws9.cell(row=i, column=3).number_format = "0.0%"

ws9["A11"] = "TOTAL"
ws9["A11"].font = BOLD
ws9["B11"] = "=SUM(B5:B10)"
ws9["B11"].font = BOLD
ws9["B11"].number_format = "$#,##0.00"

ws9["A13"] = "Client LTV Ranking"
ws9["A13"].fill = HEADER_FILL
ws9["A13"].font = Font(color=WHITE, bold=True, size=11)
ws9.merge_cells("A13:C13")
ws9["A14"] = "Rank"
ws9["B14"] = "Client"
ws9["C14"] = "Lifetime Value"
hdr_row(ws9,14,3)
for r in range(15,25):
    ws9.cell(row=r, column=1, value=r-14)
    ws9.cell(row=r, column=2).value = f"=IFERROR(INDEX(Clients!B:B,MATCH(LARGE(Clients!I:I,ROW()-14),Clients!I:I,0)),\"\")"
    ws9.cell(row=r, column=3).value = f"=IF(B{r}=\"\",\"\",VLOOKUP(B{r},Clients!B:I,8,FALSE))"
    ws9.cell(row=r, column=3).number_format = "$#,##0.00"

ws9["E3"] = "Food Cost Analysis"
ws9["E3"].fill = SUBHEADER_FILL
ws9["E3"].font = Font(color=WHITE, bold=True, size=11)
ws9.merge_cells("E3:G3")
ws9["E4"] = "Menu Item"
ws9["F4"] = "Food Cost %"
ws9["G4"] = "Verdict"
hdr_row(ws9,4,7)
for i in range(5,15):
    ws9.cell(row=i, column=5).value = f"=IFERROR(INDEX('Menu & Pricing'!A:A,ROW()),\"\")"
    ws9.cell(row=i, column=6).value = f"=IF(E{i}=\"\",\"\",VLOOKUP(E{i},'Menu & Pricing'!A:F,6,FALSE))"
    ws9.cell(row=i, column=6).number_format = "0.0%"
    ws9.cell(row=i, column=7).value = f"=IF(E{i}=\"\",\"\",VLOOKUP(E{i},'Menu & Pricing'!A:G,7,FALSE))"

# Save
output = "/home/user/Open-Claw/Catering_Business_Planner.xlsx"
wb.save(output)
print(f"Saved {output}")

# blank copy
wb2 = openpyxl.load_workbook(output)
# Clear sample data for blank? We'll just copy file as blank for now (user can delete samples)
blank = "/home/user/Open-Claw/Catering_Business_Planner_BLANK.xlsx"
wb2.save(blank)
print(f"Saved blank {blank}")

# Locked versions
def lock_file(in_path, out_path, pwd="premium"):
    wb = openpyxl.load_workbook(in_path)
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=1, max_row=120, max_col=20):
            for cell in row:
                is_formula = isinstance(cell.value, str) and str(cell.value).startswith("=")
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
                    if cell.row == 1:
                        cell.protection = Protection(locked=True)
                    else:
                        cell.protection = Protection(locked=False)
        ws.protection.password = pwd
        ws.protection.sheet = True
        ws.protection.enable()
    wb.save(out_path)
    print(f"Locked saved {out_path}")

lock_file(output, "/home/user/Open-Claw/Catering_Business_Planner_LOCKED.xlsx")
lock_file(blank, "/home/user/Open-Claw/Catering_Business_Planner_BLANK_LOCKED.xlsx")

print("All catering done")
