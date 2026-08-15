from PIL import Image, ImageDraw, ImageFont
import os
import textwrap

output_dir = "/home/user/Open-Claw/listing_kit/images"
os.makedirs(output_dir, exist_ok=True)

# Define cottage bakery color palette
colors = {
    "terracotta": (164, 106, 90),
    "cream": (255, 248, 240),
    "peach": (250, 220, 217),
    "sage": (122, 158, 126),
    "butter": (249, 228, 183),
    "dark": (74, 74, 74),
}

# Image specs
W, H = 1500, 1000  # Etsy recommended 2700x2025 but use 1500x1000 good

# Helper to create image with title and content
def create_image(filename, title, subtitle, bullets, bg_color, accent_color, icon="🧁"):
    img = Image.new("RGB", (W, H), color=bg_color)
    draw = ImageDraw.Draw(img)

    # Try to use a nice font, fallback to default
    try:
        # Try DejaVu which is often available
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 70)
        font_sub = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 38)
        font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
    except:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_body = ImageFont.load_default()
        font_small = ImageFont.load_default()

    # Header bar
    header_h = 180
    draw.rectangle([0,0,W,header_h], fill=accent_color)

    # Title in header
    draw.text((80, 30), icon, font=font_title, fill=(255,255,255))
    # Wrap title
    wrapped_title = textwrap.fill(title, width=28)
    draw.multiline_text((180, 25), wrapped_title, font=font_title, fill=(255,255,255), spacing=10)

    # Subtitle below header
    draw.text((80, header_h+30), subtitle, font=font_sub, fill=colors["dark"])

    # Bullets
    y = header_h + 110
    for bullet in bullets:
        # bullet point circle
        draw.ellipse([80, y+12, 100, y+32], fill=accent_color)
        # wrapped text
        # limit width
        lines = textwrap.wrap(bullet, width=55)
        for j, line in enumerate(lines):
            draw.text((120, y + j*40), line, font=font_body, fill=colors["dark"])
        y += len(lines)*40 + 20
        if y > H-120:
            break

    # Footer bar
    footer_h = 80
    draw.rectangle([0, H-footer_h, W, H], fill=accent_color)
    footer_text = "Google Sheets | Instant Download | Cottage Bakery Business Tracker | BONUS Analytics"
    draw.text((80, H-footer_h+25), footer_text, font=font_small, fill=(255,255,255))

    # Decorative bakery elements - simple shapes
    # Croissant-like circles in corner
    draw.ellipse([W-200, H-300, W-80, H-180], fill=colors["butter"], outline=accent_color, width=3)
    draw.ellipse([W-300, H-200, W-180, H-80], fill=colors["peach"], outline=accent_color, width=2)

    path = os.path.join(output_dir, filename)
    img.save(path, "PNG", quality=95)
    print(f"Created {path}")

# Remaining images 11-20 (since 1-10 already generated via AI)
images_data = [
    ("11_analytics_bonus.png", "BONUS: Advanced Analytics", "Exclusive Bonus Not in Original!", [
        "📊 Profit Deep Dive - Best Seller, Highest Margin, Avg Margin",
        "💰 Expense Breakdown by Category % with pie chart",
        "📈 Seasonality - Monthly Sales Trends Jan-Dec",
        "🏆 Customer Ranking - Top Spenders LTV",
        "📉 Monthly Revenue Bar Chart from Orders",
        "Exclusive: Worth It? Market Analysis",
        "BONUS VALUE $19 - Included FREE"
    ], colors["cream"], colors["sage"], "📊"),

    ("12_mobile_compatible.png", "Works Everywhere", "Phone, Tablet, Desktop - Google Sheets App", [
        "📱 Mobile Friendly - Log orders at markets live",
        "💻 Desktop - Full editing power",
        "📲 Tablet - Perfect for kitchen counter",
        "☁️ Cloud Sync - Access anywhere anytime",
        "✏️ Editable, Printable & Easy To Use",
        "No App Needed - Just Google Account",
        "Compatible: iOS, Android, Windows, Mac"
    ], (240, 248, 255), colors["terracotta"], "📱"),

    ("13_how_it_works.png", "How It Works", "Get Started in 5 Minutes", [
        "1️⃣ Purchase Template on Etsy - Instant Download",
        "2️⃣ Go to Etsy > Purchases & Reviews",
        "3️⃣ Click Google Sheets Link",
        "4️⃣ File > Make a Copy to your Drive",
        "5️⃣ Open Instructions Tab - Fill Yellow Cells!",
        "No coding, no setup fees, beginner-friendly",
        "Support included - Message us anytime!"
    ], colors["cream"], colors["sage"], "⚙️"),

    ("14_features.png", "Powerful Features", "Smart, Scalable, Collaborative", [
        "✅ Beginner-Friendly Setup - 5 min start",
        "✅ Clean & Professional Cottage Design",
        "✅ Organized Tabs - Easy Navigation",
        "✅ Automatic Calculations - No Manual Math",
        "✅ Protected Formulas - Password: premium",
        "✅ No Monthly Subscription - One-time",
        "✅ Tax-Ready Reports - Filter Deductible",
        "✅ Commercial Use Allowed"
    ], colors["cream"], colors["terracotta"], "✨"),

    ("15_tax_ready.png", "Tax Season Made Easy", "CPA-Ready Bookkeeping", [
        "📑 Tax Deductible Column - Yes/No Filter",
        "🏦 Payment Method Tracking - Venmo, Cash, Card...",
        "📅 Month Auto =TEXT(Date) for Grouping",
        "💵 Running Balance Cumulative Formula",
        "🏷️ Categories: Ingredients, Packaging, Fees...",
        "🧾 Vendor & Receipt Link Columns",
        "📤 Export Filtered Report for CPA in 1 Click"
    ], colors["cream"], (54, 69, 79), "🧾"),

    ("16_profit_pricing.png", "Perfect Pricing", "Never Undercharge Again", [
        "🧮 True Cost = Ingredients + Labor + Packaging",
        "   + Overhead % + Waste % = Batch Cost",
        "💲 Cost per Unit = Batch Cost / Yield",
        "💰 3 Pricing Methods: 2x Wholesale, 2.5x Standard, 3x Premium",
        "📊 3 Margin Methods: 50%, 65% Recommended, 75% Luxury",
        "⚠️ Profitability Check vs Current Price",
        "✅ Ensure 65-75% Margin for Cottage Success"
    ], colors["cream"], colors["terracotta"], "💰"),

    ("17_low_stock.png", "Never Run Out", "Auto Low Stock Alerts", [
        "📦 Current Stock vs Min Alert - Auto Comparison",
        "🚨 Status Auto: OUT (red), LOW (yellow), OK (green)",
        "💲 Stock Value = Stock * Cost per Unit",
        "🔄 Reorder Qty Suggestion - Package Size",
        "⏰ Expiry Date Tracking - FIFO",
        "📍 Location - Pantry A, Fridge, Freezer",
        "📊 Total Stock Value Dashboard KPI"
    ], (255, 240, 240), (192, 57, 43), "📦"),

    ("18_customer_ltv.png", "VIP Customers", "Build Repeat Business", [
        "👥 Auto-Builds from Orders - No Manual Entry!",
        "🔢 Total Orders =COUNTIF Orders Customer",
        "💸 Total Spent =SUMIF Orders Total $$$",
        "📅 Last Order =MAXIFS Latest Date",
        "💳 Balance Owed =SUMIF Balance Due",
        "🏷️ LTV Tier: Platinum $500+, Gold $200+, Silver $50+",
        "⚠️ Allergies & Preferences - Never Forget!"
    ], colors["cream"], colors["sage"], "👥"),

    ("19_whats_included.png", "Complete Package", "Everything You Need", [
        "📂 Files: 1 .xlsx Google Sheets Compatible",
        "📄 Plus: Instructions Guide, Protection Guide",
        "🔒 Protected Formulas - Password: premium",
        "📸 20 Listing Images for Your Shop (if reselling?)",
        "🎨 Design Files - Cottage Theme Colors",
        "📱 Mobile Setup Guide Included",
        "🎁 BONUS Analytics Tab Worth $19 FREE",
        "📧 Support - Premium Sellers Help"
    ], colors["butter"], colors["terracotta"], "📦"),

    ("20_thank_you_bonus.png", "Thank You! + Bonus", "Start Your Bakery Today", [
        "🙏 Thank You for Supporting Small Business!",
        "🎁 BONUS: Advanced Analytics Tab Included",
        "🚀 Scale Your Cottage Bakery with Confidence",
        "📈 From Home Baker to 6-Figure Bakery",
        "💌 Questions? Message Us - We Respond in Hours",
        "⭐ Love it? Leave a 5-Star Review!",
        "🧁 Happy Baking! - ProsperaLab Inspired + Enhanced"
    ], colors["peach"], colors["terracotta"], "🎁"),
]

for filename, title, subtitle, bullets, bg, accent, icon in images_data:
    create_image(filename, title, subtitle, bullets, bg, accent, icon)

print("All remaining images created!")
