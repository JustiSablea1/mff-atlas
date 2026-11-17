"""Build compact portrait matching features from THANO$VIB$ catalogue exports."""
import argparse
import base64
import json
import math
from io import BytesIO
from zipfile import ZipFile

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("characters", help="JSON from thanosvibs.money/api/characters")
parser.add_argument("portraits", help="ZIP from thanosvibs.money/images/portraits.zip")
parser.add_argument("output")
args = parser.parse_args()

with open(args.characters, encoding="utf-8") as source:
    catalogue = json.load(source)

with ZipFile(args.portraits) as portraits, open(args.output, "w", encoding="utf-8") as output:
    available = set(portraits.namelist())
    for entry in catalogue:
        filename = entry["portrait"] + ".png"
        if filename not in available:
            continue
        image = Image.open(BytesIO(portraits.read(filename)))
        pixels = image.convert("L").resize((12, 12), Image.Resampling.BILINEAR).load()
        values = [pixels[x, y] for y in range(1, 9) for x in range(2, 10)]
        mean = sum(values) / len(values)
        deviation = max(8, math.sqrt(sum((value - mean) ** 2 for value in values) / len(values)))
        feature = bytes(max(0, min(255, round(128 + 32 * (value - mean) / deviation))) for value in values)
        data = [entry["base_portrait"], entry["uniform"], base64.b64encode(feature).decode()]
        print(json.dumps(data, ensure_ascii=False, separators=(",", ":")), file=output)
