from PIL import Image, ImageDraw, ImageFont
import os, textwrap

output_dir = "/home/user/Open-Claw/church_listing_kit/images"
os.makedirs(output_dir, exist_ok=True)

colors = {
    "navy": (30,58,95),
    "navy_light": (44,95,141),
    "gold": (212,165,116),
    "cream": (255,248,240),
    "sage": (122,158,126),
    "light_blue": (232,240,254),
    "dark": (43,43,43),
    "white": (255,255,255),
    "yellow": (255,249,196),
}

W,H = 1500,1000

def create_image(filename, title, subtitle, bullets, bg, accent, icon="⛪"):
    img = Image.new("RGB", (W,H), color=bg)
    draw = ImageDraw.Draw(img)
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 62)
        font_sub = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
        font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_body = ImageFont.load_default()
        font_small = ImageFont.load_default()

    header_h = 170
    draw.rectangle([0,0,W,header_h], fill=accent)
    draw.text((70, 25), icon, font=font_title, fill=(255,255,255))
    wrapped_title = textwrap.fill(title, width=30)
    draw.multiline_text((170, 20), wrapped_title, font=font_title, fill=(255,255,255), spacing=8)

    draw.text((70, header_h+20), subtitle, font=font_sub, fill=colors["dark"])

    y = header_h + 90
    for bullet in bullets:
        draw.ellipse([70, y+10, 90, y+30], fill=accent)
        lines = textwrap.wrap(bullet, width=60)
        for j,line in enumerate(lines):
            draw.text((110, y + j*36), line, font=font_body, fill=colors["dark"])
        y += len(lines)*36 + 18
        if y > H-90:
            break

    footer_h = 70
    draw.rectangle([0, H-footer_h, W, H], fill=accent)
    footer = "Google Sheets | Instant Download | Church Membership Tracker | 2 Files: Demo + Blank"
    draw.text((70, H-footer_h+22), footer, font=font_small, fill=(255,255,255))

    # Decorative
    draw.ellipse([W-220, H-320, W-80, H-180], fill=colors["light_blue"], outline=accent, width=3)

    path = os.path.join(output_dir, filename)
    img.save(path, "PNG", quality=95)
    print(f"Created {path}")

images_data = [
    ("01_hero_dashboard.png","Church Membership Tracker","Know Your People, Not Just Phone Numbers",[
        "⛪ Dashboard: Active members, giving YTD, attendance trends, birthdays, Needs Attention",
        "📖 Member Directory: 1000 rows, age, years, engagement Engaged/Cooling/Drifting auto",
        "👋 Visitors & Follow-Up: First visit → follow-up due → pipeline, overdue flags",
        "Google Sheets Compatible + Excel | Instant Download | Password: premium",
        "7 Tabs + Bonus Analytics | No monthly fee | Works phone/tablet/desktop"
    ], colors["cream"], colors["navy"], "⛪"),

    ("02_what_you_receive.png","What You Will Receive","7 Designed Tabs + 2 Files",[
        "1 Instructions + Setup - 3-step quick start, editable dropdowns",
        "2 Dashboard - KPI cards, attendance & giving charts, Needs Attention + birthdays",
        "3 Member Directory - 1000 rows, ages, years, engagement auto",
        "4 Visitors & Follow-Up - first visit to membership pipeline",
        "5 Attendance Log - one row per service, totals & trends auto",
        "6 Giving Log - weekly totals by fund, YTD, private",
        "7 Ministry Teams - build team once, phone/email VLOOKUP from directory",
        "BONUS Analytics + 2 Files: Demo with sample + Blank ready",
    ], colors["cream"], colors["navy_light"], "📦"),

    ("03_dashboard.png","Dashboard You'll Actually Open Sunday","KPI Cards + Charts + Needs Attention",[
        "Active Members =COUNTIF Directory Active | Total Directory",
        "Visitors This Month, Last Sunday Attendance, Avg Attendance",
        "Giving YTD, Giving This Month, Needs Attention Drifting+Cooling+Overdue",
        "Needs Attention Panel: Who needs a call - Drifting members auto surface",
        "Birthdays This Month Panel - Name, Birthday, Age Turning, Phone",
        "Attendance Trend Monthly Avg + Total Services + Line Chart",
        "Giving Trend Monthly + YTD + Bar Chart",
    ], colors["cream"], colors["navy"], "📊"),

    ("04_member_directory.png","Member Directory - 1000 Rows","Age, Years, Engagement Auto Calculates",[
        "Member ID, Family ID, First/Last Name, Full Name =First+Last auto",
        "Phone, Email, Address, City, State, Birthday, Age =DATEDIF(TODAY) auto",
        "Join Date, Membership Years =DATEDIF auto, Role dropdown, Ministry",
        "Status dropdown Active/Inactive/Visitor/New Convert, Baptism Date",
        "Last Attended, Days Since =TODAY()-Last, Engagement Engaged/Cooling/Drifting/Inactive auto",
        "Needs Attention YES Call! / Check-in / Urgent auto, Emergency Contact, Notes",
        "Conditional: Engaged green, Cooling yellow, Drifting red, Inactive gray",
    ], colors["cream"], colors["navy_light"], "📖"),

    ("05_visitors_followup.png","Visitors & Follow-Up","First Visit → Follow-Up That Actually Follows Up",[
        "Visitor ID, First Visit Date, First/Last Name, Full Name auto",
        "Phone, Email, How Heard dropdown, Guest Of Member, Assigned To",
        "Follow-up Due Date =First Visit+2 days auto, Follow-up Status dropdown",
        "Next Contact Due =IF Not Contacted Due, IF Contacted Due+7 auto",
        "Overdue? =IF Due<TODAY and not Joined/Closed OVERDUE auto RED flag",
        "Visit Count, Converted to Member? Yes/No, Notes, Prayer Request, Address",
        "No more first-time visitors slipping through cracks",
    ], colors["cream"], (139,0,0), "👋"),

    ("06_attendance_log.png","Attendance Log","One Row Per Service, Trends Build Themselves",[
        "Date, Service Type dropdown Sunday Morning/Evening/Wednesday etc",
        "Total Present, Members Present, Visitors Present, Children Present, Online",
        "Speaker, Sermon Topic, Offering?, Weather, Notes",
        "Month =TEXT(Date YYYY-MM) auto, Week # =WEEKNUM auto",
        "Totals: Avg Attendance =AVERAGE, Max Attendance =MAX auto",
        "Feeds Dashboard attendance trend & charts",
        "Editable Service Types dropdown in Setup tab",
    ], colors["light_blue"], colors["sage"], "📝"),

    ("07_giving_log.png","Giving Log - Privacy by Design","Weekly Totals by Fund, No Member Names",[
        "Week Ending Date, Fund dropdown Tithes/Offering/Missions/Building etc",
        "Amount $, Method Cash/Check/Online/ACH dropdown, Giver Count, Notes",
        "Month =TEXT auto, Year =YEAR auto, Running YTD =SUM($C$2:C) auto",
        "YTD by Fund =SUMIF Fund auto, All-time and YTD build themselves",
        "Total Giving =SUM auto, Giving that stays private - no names attached",
        "Editable Funds dropdown - rename to your church funds",
        "Confidence protected by design",
    ], colors["cream"], colors["gold"], "💰"),

    ("08_ministry_teams.png","Ministry Teams","Build Team Once, Phone/Email Pull from Directory",[
        "Team ID, Ministry Name dropdown Worship/Ushers/Hospitality etc",
        "Role in Team Leader/Co-Leader/Member/Volunteer dropdown",
        "Member Name from Directory dropdown, Phone =VLOOKUP Directory auto",
        "Email =VLOOKUP Directory auto, Availability, Start Date, Notes",
        "Family ID =INDEX/MATCH Directory auto, Build team once",
        "Phone and email pull from Member Directory - no double entry",
        "Editable Ministries list in Setup tab - rename to yours",
    ], colors["cream"], colors["navy"], "🤝"),

    ("09_analytics_bonus.png","BONUS Analytics","Growth, Engagement, Giving Insights",[
        "Engagement Breakdown: Engaged/Cooling/Drifting/Inactive/Active/Visitor counts + % + Bar Chart",
        "Giving by Fund YTD: Tithes/Offering/Missions etc totals + % + Pie Chart",
        "Monthly Growth: New Members =COUNTIFS Join Date, New Visitors =COUNTIFS First Visit",
        "No volatile formulas - Excel safe, no AGGREGATE, no circular refs",
        "Exclusive BONUS not in original - Value $19 FREE",
    ], colors["cream"], colors["navy_light"], "📈"),

    ("10_mobile_compatible.png","Works Everywhere","Desktop, Tablet, Phone - Free Google Sheets App",[
        "📱 Mobile Friendly - Update attendance on Sunday from phone",
        "💻 Desktop Full Power - Edit dropdowns, view charts",
        "📲 Tablet Perfect for Welcome Desk",
        "☁️ Cloud Sync - Access anywhere, anytime",
        "✏️ Editable Dropdowns - Roles, Ministries, Service Types, Funds - yours to rename",
        "🔒 Protected Formulas Password: premium - gentle warning",
        "No add-ons, no scripts, no monthly fee",
    ], colors["cream"], colors["navy"], "📱"),

    ("11_how_it_works.png","How It Works","Get Started in 3 Steps",[
        "1 Purchase and instantly download your PDF",
        "2 Click link inside and choose Make a copy to Drive",
        "3 Delete samples, add your people - that's it",
        "Demo copy with realistic sample data - see how everything works",
        "Blank copy ready for your congregation from first click",
        "Works on desktop, tablet, phone in free Google Sheets app",
        "Free Google account required, no subscription",
    ], colors["cream"], colors["sage"], "⚙️"),

    ("12_features.png","Made for Real Churches","Every Dropdown Yours to Rename",[
        "✅ Automatic columns locked behind gentle warning - no accidental breaks",
        "✅ Works desktop tablet phone in free Google Sheets app",
        "✅ No add-ons, no scripts, no monthly fee",
        "✅ 1000 Member Rows, 200 Visitor, 200 Attendance, 200 Giving, 100 Teams",
        "✅ Engagement auto: Engaged <=14 days, Cooling <=30, Drifting <=90, Inactive >90",
        "✅ Visitor follow-up due = First Visit +2 days, overdue flag auto RED",
        "✅ VLOOKUP phone/email from Directory to Teams - no double entry",
        "✅ 2 Files: Demo + Blank + Locked versions password premium",
    ], colors["cream"], colors["navy"], "✨"),

    ("13_needs_attention.png","See Who's Drifting Before They're Gone","Update One Date, Flags Surface Themselves",[
        "Member Directory Days Since =TODAY()-Last Attended auto",
        "Engagement =IF Days<=14 Engaged, <=30 Cooling, <=90 Drifting, else Inactive auto",
        "Needs Attention =IF Drifting YES Call! Red, IF Cooling Check-in Yellow auto",
        "Dashboard Needs Attention Panel lists Drifting members needing call",
        "Visitors Overdue =IF Next Contact<TODAY and not Joined OVERDUE Red flag",
        "People who need a call surface on dashboard by themselves",
        "Pastoral care made proactive, not reactive",
    ], colors["cream"], (139,0,0), "🚨"),

    ("14_visitor_pipeline.png","Visitor Follow-Up That Actually Follows Up","Log Once, Sheet Works Out When Next Contact Due",[
        "First Visit Date → Follow-up Due Date =+2 days auto",
        "Next Contact Due logic: Not Contacted=Due, Contacted=Due+7 days, Second Visit=TODAY+14",
        "Overdue flag =IF Due<TODAY and Status not Joined/Closed OVERDUE RED",
        "Dashboard counts Overdue Follow-ups =COUNTIF OVERDUE",
        "Pipeline: Not Contacted → Contacted → Second Visit → Joined → Closed",
        "Converted to Member? Yes/No flag, Notes for next steps",
        "No more first-time visitors slipping through cracks",
    ], colors["cream"], colors["navy_light"], "🔄"),

    ("15_privacy_giving.png","Giving That Stays Private","Weekly Totals by Fund, No Names Attached",[
        "Giving Log: Week Ending, Fund, Amount, Method, Giver Count only - NO member names",
        "Privacy by design - confidence protected, totals only",
        "YTD per fund =SUMIF auto, Running YTD =SUM cumulative auto",
        "Month/Year auto =TEXT/YEAR, Total Giving =SUM",
        "Editable Funds: Tithes, Offering, Missions, Building, Youth, Benevolence",
        "Dashboard shows Giving YTD and This Month, not individual givers",
        "All-time and year-to-date build themselves",
    ], colors["cream"], colors["gold"], "🔒"),

    ("16_birthdays.png","Birthdays & Anniversaries","Never Miss a Celebration",[
        "Member Directory Birthday, Age =DATEDIF auto, Anniversary",
        "Dashboard Birthdays This Month panel: Name, Birthday, Age Turning, Phone",
        "Formula filters MONTH(Birthday)=MONTH(TODAY) auto",
        "Pastoral care touchpoint - call or card on birthday",
        "Anniversary tracking for families - Head + Spouse",
        "Age calculation auto - no manual math",
        "Builds community, shows people you remember",
    ], colors["cream"], (212,100,100), "🎂"),

    ("17_dropdowns.png","Every Dropdown Yours to Rename"," Roles, Ministries, Service Types, Funds",[
        "Editable in Instructions + Setup tab - yellow cells, comma separated list",
        "Membership Status: Active, Inactive, Visitor, New Convert, Transferred, Child, Youth",
        "Roles: Member, Elder, Deacon, Volunteer, Worship Leader, Usher, Greeter, Teacher...",
        "Ministries: Worship, Ushers, Hospitality, Children's, Youth, Outreach, Missions...",
        "Service Types: Sunday Morning, Sunday Evening, Wednesday Bible Study, Prayer...",
        "Giving Funds: Tithes, Offering, Missions, Building Fund, Youth Fund, Benevolence...",
        "Follow-up Status, How Heard - all yours to rename to your church language",
    ], colors["cream"], colors["sage"], "📝"),

    ("18_two_files.png","You'll Receive Two Files","Demo + Blank + Locked",[
        "1 Demo Copy filled with realistic sample data - see exactly how everything works",
        "2 Blank Copy ready for your congregation from first click - delete samples",
        "Plus Locked versions with formulas protected password: premium",
        "Yellow cells unlocked editable, white formula cells locked",
        "To unprotect: Review > Unprotect Sheet > premium",
        "Google Sheets: Data > Protected sheets and ranges > Remove",
        "No add-ons, no scripts, beginner-friendly",
    ], colors["light_blue"], colors["navy"], "📦"),

    ("19_dashboard_sunday.png","Dashboard You'll Actually Open Sunday","Active Members, Giving YTD, Attendance, Birthdays",[
        "Active Members =COUNTIF Status Active - know your flock size",
        "Total Directory, Visitors This Month, Last Service Attendance =MAX",
        "Avg Attendance, Giving YTD =SUM, Giving This Month =SUMIFS",
        "Needs Attention Drifting+Cooling+Overdue visitors - action panel",
        "Birthdays This Month - celebration panel",
        "Attendance Trend Monthly Avg + Services Chart Line",
        "Giving Trend Monthly Total + YTD Bar Chart - all updating as you type",
    ], colors["cream"], colors["navy"], "☀️"),

    ("20_thank_you.png","Thank You - Start Today","For Pastors, Secretaries, Ministry Leaders",[
        "Built for real churches - clarity of church management software without monthly fee",
        "Know your people, not just phone numbers",
        "For personal and single-church use, please don't resell or share",
        "Questions? Message - We respond in hours, happy to help",
        "Password for formulas: premium - protected to prevent breaks",
        "Works desktop tablet phone - free Google Sheets app",
        "Thank you for shepherding your people well - 💚 ProsperaLab Inspired + Enhanced v3",
    ], (255,248,240), colors["navy"], "🙏"),
]

for fname, title, sub, bullets, bg, accent, icon in images_data:
    create_image(fname, title, sub, bullets, bg, accent, icon)

print("All church images created")
