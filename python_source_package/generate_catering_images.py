from PIL import Image, ImageDraw, ImageFont
import os, textwrap

out_dir = "/home/user/Open-Claw/catering_listing_kit/images"
os.makedirs(out_dir, exist_ok=True)

colors = {
    "sage_dark": (45,74,62),
    "sage": (90,125,106),
    "sage_light": (168,196,181),
    "terra": (193,122,95),
    "cream": (255,248,240),
    "gold": (212,165,116),
    "dark": (43,43,43),
    "white": (255,255,255),
}

W,H=1500,1000

def create_image(fname, title, subtitle, bullets, bg, accent, icon="🍽️"):
    img = Image.new("RGB", (W,H), color=bg)
    draw = ImageDraw.Draw(img)
    try:
        ft = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 60)
        fs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 32)
        fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
        fsmall = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    except:
        ft=fs=fb=fsmall=ImageFont.load_default()
    header_h=160
    draw.rectangle([0,0,W,header_h], fill=accent)
    draw.text((70,20), icon, font=ft, fill=(255,255,255))
    wrapped = textwrap.fill(title, width=28)
    draw.multiline_text((170,15), wrapped, font=ft, fill=(255,255,255), spacing=6)
    draw.text((70, header_h+15), subtitle, font=fs, fill=colors["dark"])
    y=header_h+80
    for bullet in bullets:
        draw.ellipse([70, y+8, 85, y+23], fill=accent)
        lines=textwrap.wrap(bullet, width=65)
        for j,line in enumerate(lines):
            draw.text((105, y+j*32), line, font=fb, fill=colors["dark"])
        y+=len(lines)*32+14
        if y>H-80:
            break
    footer_h=60
    draw.rectangle([0, H-footer_h, W, H], fill=accent)
    footer="Google Sheets | Instant Download | Catering Business Planner | 8 Tabs + Bonus"
    draw.text((70, H-footer_h+18), footer, font=fsmall, fill=(255,255,255))
    draw.ellipse([W-200, H-300, W-80, H-180], fill=colors["sage_light"], outline=accent, width=3)
    path=os.path.join(out_dir,fname)
    img.save(path,"PNG",quality=95)
    print(f"Created {path}")

data=[
("01_hero_dashboard.png","Catering Business Planner","Run Your Entire Catering Business From One Sheet",[
"Dashboard: Booked revenue, cash collected & net profit at a glance + charts",
"Events: Client, date, type, service style, venue, guests, pricing, deposit, balance, status badges",
"Clients: Built-in CRM phone email source event count lifetime value VIP tags",
"Google Sheets Compatible + Excel | Instant Download | Password: premium",
"8 Connected Tabs + Bonus Analytics | No monthly fee | Everything connects behind scenes"
],colors["cream"],colors["sage_dark"],"🍽️"),

("02_whats_included.png","What's Included - 8 Connected Tabs","ProsperaLab Catering Planner",[
"1 Dashboard - whole business at glance booked revenue cash collected net profit",
"2 Events - track every booking deposit to final payment status badges",
"3 Clients - built-in CRM lifetime value automatic VIP/repeat tags",
"4 Recipe Calculator - true cost every dish down to penny per serving",
"5 Menu & Pricing - food-cost % and healthy vs underpriced verdicts",
"6 Quote Calculator - build polished professional quotes in seconds",
"7 Income & Expenses - real profit month by month 2026 summary",
"8 Instructions & Setup - quick-start guide plus customizable dropdowns",
],colors["cream"],colors["sage"],"📦"),

("03_dashboard.png","Dashboard - Whole Business At a Glance","Booked Revenue, Cash Collected & Net Profit",[
"Booked Revenue =SUM Events Total Price | Cash Collected =SUM Deposit Paid",
"Outstanding Balance =SUM Balance Due | Net Profit =Income & Expenses total",
"Total Events, Upcoming Events Booked+Confirmed, Total Clients, Avg Event Value",
"Avg Food Cost % from Menu, Overdue Payments count",
"Upcoming Events Next 10 Date Client Type Guests | Overdue Balances Needs Collection",
"Monthly Revenue & Profit trend table Month Revenue Profit + Bar Chart",
"Revenue by Event Type Wedding Corporate etc % + Pie Chart",
],colors["cream"],colors["sage_dark"],"📊"),

("04_events.png","Events - Track Every Booking","Deposit to Final Payment Status Badges",[
"Event ID, Client Name dropdown Clients, Event Date, Event Type Wedding/Corporate/Birthday",
"Service Style Buffet/Plated/Family Style/Cocktail/Food Truck, Venue Location, Guest Count",
"Menu Package, Price/Person $, Total Price =Guests*Price, Deposit % 25%, Deposit Required =Total*%",
"Deposit Paid, Balance Due =Total-Deposit Paid, Payment Status Unpaid/Partial/Paid Overdue color",
"Event Status Inquiry/Quote Sent/Booked/Confirmed/Completed color badges, Source, Staff Needed, Notes",
"Status badges: Booked yellow, Confirmed green, Overdue red | Never miss payment",
"Log event once watch deposits balances client history income update themselves",
],colors["cream"],colors["terra"],"📅"),

("05_clients.png","Clients - Built-in CRM","Lifetime Value + Automatic VIP/Repeat Tags",[
"Client ID, Client Name, Phone, Email, Source Referral/Website/Instagram/Repeat",
"First Event Date, Last Event Date, Event Count =COUNTIF Events Client",
"Lifetime Value =SUMIF Events Total Price, Avg Event Value =LTV/Count",
"Status Lead/Active/VIP/Past, VIP Tag =IF LTV>=5000 VIP IF Count>=3 Repeat auto GOLD highlight",
"Address, Allergies, Preferences Vegetarian Gluten-free, Notes, Family Size, Company",
"Your clients remembered - phone email source event dates count lifetime value",
"Conditional: VIP GOLD, Past gray | See who spends most",
],colors["cream"],colors["gold"],"👥"),

("06_recipe_calculator.png","Recipe Calculator","True Cost Every Dish Down To Penny Per Serving",[
"Recipe Name Baked Ziti Category Pasta Servings 20 - Edit yellow",
"Ingredients: Ingredient Qty Unit Unit Cost Total Cost =Qty*Cost auto",
"Ziti Pasta 2 lb $1.50, Ground Beef 3 lb $4.50 etc, Total Ingredient Cost =SUM",
"Labor Hours 2 * Hourly Rate from Setup =Labor Total, Packaging $15, Overhead % from Setup",
"Total Recipe Cost =Ingredient+Labor+Packaging+Overhead+Other, Cost Per Serving =Total/Servings",
"Suggested Pricing per Serving: 3x Standard, 3.5x, Food Cost 30% Target =Cost/0.3, 25% Premium",
"Know your true numbers - see exactly what each dish earns",
],colors["cream"],colors["sage"],"🧮"),

("07_menu_pricing.png","Menu & Pricing","Food-Cost % + Healthy vs Underpriced Verdicts",[
"Menu Item Baked Ziti Category Pasta Recipe Link Baked Ziti Cost per Serving VLOOKUP Recipe",
"Price per Person $18 edit yellow, Food Cost % =Cost/Price auto, Verdict auto",
"Verdict: ✅ Healthy if <=30% ⚠️ Watch if 30-40% ❌ Underpriced if >40%",
"Suggested Price =Cost/30% for 30% target, Profit/Person =Price-Cost, Status Active/Seasonal",
"Notes Best seller | Conditional: Food Cost >40% red 30-40% yellow <30% green",
"See food-cost % instant - know if dish underpriced",
"Category dropdown Appetizer/Main/Side/Salad/Dessert/Beverage",
],colors["cream"],colors["sage_dark"],"🍝"),

("08_quote_calculator.png","Quote Calculator","Build Polished Professional Quotes In Seconds",[
"Event Details: Client Name dropdown Clients auto pulls Phone Email Source, Event Date, Guest Count, Event Type, Venue, Service Style yellow inputs",
"Menu Items for Quote: Menu Item dropdown Menu & Pricing, Category auto VLOOKUP, Cost/Person auto, Price/Person auto, Qty =Guest Count auto, Line Cost =Cost*Qty, Line Price =Price*Qty",
"Sample Menu Baked Ziti Caesar Salad Garlic Bread Tiramisu auto",
"TOTAL FOOD =SUM Line Price GOLD fill, Quote Breakdown Service Fee % from Setup Service Fee $=Food*%, Delivery Fee $ from Setup, Gratuity % from Setup, Tax % from Setup Tax $=(Food+Fees)*Tax%",
"TOTAL QUOTE =Food+Service+Delivery+Gratuity+Tax large bold GOLD, Deposit % from Setup Deposit $=Total*%, Balance Due =Total-Deposit",
"Margin Analysis Food Profit =Food Price-Food Cost, Food Margin %, Overall Profit =Total Quote-Total Cost, Overall Margin %",
"Win more bookings with accurate professional quotes",
],colors["cream"],colors["terra"],"🧾"),

("09_income_expenses.png","Income & Expenses","Real Profit Tracked Month by Month",[
"Date, Type Income/Expense dropdown, Category Event Income/Deposit/Grocery/Staff Labor etc dropdown, Description, Amount $ (negative for expense), Payment Method, Event ID dropdown, Month =TEXT auto, Year =YEAR auto, Running Balance =cumulative auto",
"Total Income =SUMIF Type Income, Total Expenses =SUMIF Expense, Net Profit =Income+Expenses (expenses negative) bold",
"2026 Monthly Summary: Month Income =SUMIFS Month Type Income, Expenses =SUMIFS Month Expense, Profit =Income+Expenses",
"See your real profit tracked month by month - 2026 summary table",
"Date Category Description Amount Month Year Running Balance Notes",
"Editable Income/Expense Categories dropdown in Setup",
],colors["cream"],colors["sage"],"💰"),

("10_why_love.png","Here's the Good Part Why You'll Love It","8 Features",[
"✅ Everything in one place - no more juggling scattered files",
"✅ Automatic math - totals deposits balances profit calculate themselves",
"✅ Know your true numbers - see exactly what each dish and event earns",
"✅ Win more bookings with accurate professional quotes",
"✅ Never miss a payment with deposit & balance tracking",
"✅ Your clients remembered - phone email source lifetime value",
"✅ Beginner-friendly - plug in details and it just works",
"✅ Made for caterers - Party decor for gatherings and celebrations",
],colors["cream"],colors["sage_dark"],"⭐"),

("11_how_it_works.png","How It Works","3 Simple Steps",[
"1 Click link on download page to make your own copy of Google Sheet",
"2 Enter your info on simple color-coded tabs yellow inputs",
"3 Watch dashboard CRM reports fill in automatically",
"Color-coded tabs: yellow editable, white formula locked password premium",
"Everything connects behind scenes Log event once watch deposits balances client history income update",
"Whether just starting or booking weddings every weekend",
],colors["cream"],colors["sage"],"⚙️"),

("12_google_sheets.png","Smart, Scalable, Collaborative","Access Anywhere Anytime Google Sheets",[
"Edit effortlessly from computer browser, or manage routine on go using mobile app",
"Google Sheets Instant Download - Free Google account required",
"Works desktop tablet phone - iOS Android Windows Mac",
"No monthly subscription - One-time purchase",
"Phone app: Update events at venue, log payments, check upcoming events",
"Cloud sync - Access anywhere anytime",
],colors["sage_light"],colors["sage"],"📱"),

("13_food_cost.png","Know Your True Numbers","See Exactly What Each Dish Earns",[
"Recipe Calculator Cost per Serving down to penny =Total Cost/Servings",
"Menu & Pricing Food Cost % =Cost/Price instant verdict Healthy Watch Underpriced",
"Target Food Cost % 30% in Setup - Suggested Price =Cost/Target%",
"Quote Calculator Margin Analysis Food Profit Food Margin % Overall Profit Overall Margin %",
"Dashboard Avg Food Cost % =AVERAGE Menu Food Cost %",
"Never underprice again - see true numbers",
],colors["cream"],colors["navy"] if "navy" in colors else colors["sage_dark"],"🎯"),

("14_never_miss.png","Never Miss a Payment","Deposit & Balance Tracking",[
"Events: Deposit % 25% editable Setup, Deposit Required =Total*% auto, Deposit Paid yellow input, Balance Due =Total-Deposit Paid auto",
"Payment Status dropdown Unpaid Partial Deposit Partial Half Paid in Full Overdue Refunded color: Overdue red Paid green",
"Dashboard Outstanding Balance =SUM Balance Due, Overdue Payments =COUNTIF Overdue",
"Overdue Balances panel - who needs collection",
"Cash Collected =SUM Deposit Paid - know cash flow",
"Stop chasing payments - sheet tracks",
],colors["cream"],(139,0,0),"💳"),

("15_clients_remembered.png","Your Clients Remembered","Built-in CRM Lifetime Value",[
"Clients tab phone email source first/last event date event count lifetime value avg event value status VIP tag address allergies preferences",
"Lifetime Value =SUMIF Events for client auto, VIP =IF LTV>=5000 VIP IF Count>=3 Repeat auto",
"Event Count =COUNTIF Events Client auto",
"Dashboard Total Clients =COUNTA Clients",
"Client LTV Ranking in Analytics BONUS Top 10 clients by lifetime value",
"Build repeat business - see who spends most",
"Preferences: Vegetarian Gluten-free Loves Italian - remember favorites",
],colors["cream"],colors["gold"],"💛"),

("16_beginner_friendly.png","Beginner-Friendly","Plug In Details and It Just Works",[
"Yellow cells UNLOCKED editable - white formula cells LOCKED password premium",
"Color-coded tabs - Instructions yellow inputs, Dashboard auto, Events yellow client/date etc",
"Editable dropdowns lists in Instructions & Setup tab comma separated rename to your business",
"Event Types, Service Styles, Statuses, Sources, Menu Categories, Income/Expense Categories",
"Automatic math totals deposits balances profit calculate themselves",
"No scripts no add-ons no monthly fee - pure Google Sheets formulas",
"Protected formulas gentle warning - prevents accidental breaks",
],colors["cream"],colors["sage"],"👍"),

("17_made_for_caterers.png","Made for Caterers","Party Decor for Gatherings and Celebrations",[
"Designed by ProsperaLab - Owner Kez 4.8 stars 16 reviews 213 sales",
"Whether just starting out or booking weddings every weekend",
"Tracks events payments clients recipe costs profit automatically",
"Spend less time on spreadsheets more time cooking",
"For personal/business use only - do not resell share",
"Digital download instant - no physical shipped",
"Support happy to help message via Etsy",
],colors["cream"],colors["sage_dark"],"👩‍🍳"),

("18_what_you_get.png","You'll Receive","Complete Package",[
"File type 1 PDF with Google Sheets link + instructions (Etsy requires PDF)",
"Actually deliver 4 xlsx files: Demo, Blank, Demo Locked, Blank Locked",
"Plus listing kit 20 images titles descriptions tags keywords",
"BONUS Analytics tab Revenue by Type Client LTV Food Cost Analysis",
"Password premium for protected formulas",
"Free Google account required Basic Sheets knowledge Internet required",
],colors["cream"],colors["terra"],"📦"),

("19_dashboard_closeup.png","Dashboard Closeup","Booked Revenue Cash Collected Net Profit Charts",[
"KPI Cards: Booked Revenue Cash Collected Outstanding Balance Net Profit Total Events Upcoming Events Total Clients Avg Event Value Avg Food Cost % Overdue Payments",
"Upcoming Events Next 10 Date Client Type Guests SMART via SMALL INDEX MATCH",
"Overdue Balances Needs Collection Client Date Balance Status",
"Monthly Revenue & Profit Month Revenue SUMIFS Events Total Profit SUMIFS Income Expenses + Bar Chart Monthly Revenue",
"Revenue by Event Type Wedding Corporate Birthday etc Revenue % + Pie Chart Revenue by Type",
],colors["cream"],colors["sage_dark"],"📈"),

("20_thank_you.png","Thank You + Bonus","Start Your Catering Business Today",[
"Run entire catering business from one simple beautiful Google Sheet",
"Everything connects behind scenes - Log event once watch deposits balances client history income update",
"Thank you for supporting small business - ProsperaLab Inspired Enhanced v3",
"Questions? Message via Etsy happy to help - responds within hours",
"Password premium to edit formulas Review > Unprotect Sheet > premium",
"Works desktop tablet phone free Google Sheets app No monthly subscription",
"Happy Cooking! 🍽️",
],colors["cream"],colors["sage_dark"],"🙏"),
]

for fname,title,sub,bullets,bg,accent,icon in data:
    create_image(fname,title,sub,bullets,bg,accent,icon)

print("All catering images done")
