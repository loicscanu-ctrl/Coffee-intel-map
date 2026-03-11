import os
import uuid
import requests
import pandas as pd
from datetime import date
from sqlalchemy.orm import Session

def fetch_ice_certified_stocks(db: Session, stock_model):
    """
    Downloads ICE report, extracts Total Bags, saves to DB, and cleans up.
    """
    # URL for ICE Coffee 'C' Certified Stocks
    url = "https://www.theice.com/publicdocs/futures_us_reports/coffee/Coffee_C_Cert_Stocks.xls"
    
    # 1. Create unique temp filename
    temp_filename = f"temp_ice_stocks_{uuid.uuid4()}.xls"

    try:
        print(f"Downloading ICE report from {url}...")
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        with open(temp_filename, 'wb') as f:
            f.write(response.content)

        # 2. Parse with Pandas
        # Reads the file to find the row containing "Total"
        df = pd.read_excel(temp_filename)
        
        total_bags = None

        for _, row in df.iterrows():
            # Convert row to string to search for "Total" case-insensitively
            row_str = row.astype(str).str.lower().tolist()
            
            if any("total" in cell for cell in row_str):
                # Find numeric values in this row
                numerics = [
                    val for val in row 
                    if isinstance(val, (int, float)) and not pd.isna(val)
                ]
                if numerics:
                    # Heuristic: The Total Bags count is usually the largest number in the summary row
                    total_bags = int(max(numerics))
                    break
        
        if total_bags is not None:
            # 3. Save to Database
            today = date.today()
            existing = db.query(stock_model).filter(stock_model.date == today).first()
            
            if existing:
                existing.value = total_bags
                print(f"Updated existing stock data for {today}: {total_bags}")
            else:
                new_entry = stock_model(date=today, value=total_bags)
                db.add(new_entry)
                print(f"Inserted new stock data for {today}: {total_bags}")
            db.commit()
            return total_bags
            
    except Exception as e:
        print(f"Error fetching ICE stocks: {e}")
    finally:
        # 4. Delete the used Excel file
        if os.path.exists(temp_filename):
            os.remove(temp_filename)