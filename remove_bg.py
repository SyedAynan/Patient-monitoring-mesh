from PIL import Image
import os

assets_dir = r"s:\stuff\assets"
images = [
    "sensing_icon.png",
    "processing_icon.png",
    "network_icon.png",
    "gateway_icon.png",
    "dashboard_icon.png",
    "storage_icon.png"
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
