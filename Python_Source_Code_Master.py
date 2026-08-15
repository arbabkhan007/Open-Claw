"""
MASTER PYTHON SOURCE CODE - All Bakery, Church, Catering Generators
Generated: 2025-08-15
Etsy Listings:
- 4518308882 Cottage Bakery Business Spreadsheet
- 4547801754 Church Membership Tracker
- 4534900855 Catering Business Planner
Password: premium
Requirements: openpyxl==3.1.5, Pillow==10.4.0
Usage:
  python Python_Source_Code_Master.py --type bakery_v4
  Types: bakery, bakery_v3, bakery_v4, church, catering, all, images, lock, test
"""

import argparse
import sys
import os

# Import all generators as modules by exec
# This master file is a wrapper - actual generator code is in separate files in same folder
# For single-file use, copy-paste each generator code below as functions

def run_bakery_v1():
    print("Running generate_bakery_sheet.py...")
    import generate_bakery_sheet

def run_bakery_v3():
    print("Running generate_fixed_v3.py...")
    import generate_fixed_v3

def run_bakery_v4():
    print("Running generate_cottage_v4.py...")
    import generate_cottage_v4

def run_church():
    print("Running generate_church.py...")
    import generate_church

def run_catering():
    print("Running generate_catering.py...")
    import generate_catering

def run_all():
    run_bakery_v4()
    run_church()
    run_catering()
    print("\nAll spreadsheets generated!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Master Generator for Bakery, Church, Catering Business Planners")
    parser.add_argument("--type", type=str, default="bakery_v4", choices=["bakery","bakery_v3","bakery_v4","church","catering","all","test"], help="Which spreadsheet to generate")
    args = parser.parse_args()
    
    if args.type == "bakery":
        run_bakery_v1()
    elif args.type == "bakery_v3":
        run_bakery_v3()
    elif args.type == "bakery_v4":
        run_bakery_v4()
    elif args.type == "church":
        run_church()
    elif args.type == "catering":
        run_catering()
    elif args.type == "all":
        run_all()
    elif args.type == "test":
        print("Running test_cottage_v4.py...")
        import test_cottage_v4
    else:
        print("Unknown type")
        sys.exit(1)

