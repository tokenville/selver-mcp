import pdfplumber
import json

path = "/home/takoitatakoita/.hermes/profiles/household/cache/documents/doc_2e801c343fdc_waybill-2113133318732.pdf"
items = []

with pdfplumber.open(path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)

