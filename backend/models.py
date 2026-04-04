import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text
from database import Base

class CardProcess(Base):
    __tablename__ = "card_processes"

    id = Column(Integer, primary_key=True, index=True)
    barcode = Column(String, index=True)
    status = Column(String, default="pending")  # pending, processing, complete, partial, error
    
    # Store full parsed result as JSON string (flexible for nested PSA/PC/eBay data)
    result_json = Column(Text, nullable=True)
    
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
