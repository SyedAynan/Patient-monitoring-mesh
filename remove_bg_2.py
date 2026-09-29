from PIL import Image
import os

assets_dir = r"s:\stuff\assets"
images = [
    "toc_icon.png",
    "star_icon.png",
    "books_icon.png",
    "rocket_icon.png",
    "tools_icon.png",
    "handshake_icon.png",
    "license_icon.png"
]

def remove_white_bg(img_path, out_path, tolerance=240):
    img = Image.open(img_path).convert("RGBA")
    datas = img.getdata()
    
    newData = []
    for item in datas:
        if item[0] >= tolerance and item[1] >= tolerance and item[2] >= tolerance:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
            
    img.putdata(newData)
    img.save(out_path, "PNG")

for img_name in images:
    path = os.path.join(assets_dir, img_name)
    if os.path.exists(path):
        remove_white_bg(path, path)
        print(f"Processed {img_name}")
