import os
from PIL import Image

SRC_IMAGE = r"C:\Users\Ibrahim Elmahy\.gemini\antigravity\brain\137112e1-f25a-4a0e-b941-8b13fc5436c6\.user_uploaded\media_1786467818776.png"

def process_logo():
    if not os.path.exists(SRC_IMAGE):
        print(f"Error: Source image not found at {SRC_IMAGE}")
        return
        
    img = Image.open(SRC_IMAGE).convert("RGBA")
    
    # Trim white borders to get tight bounding box around logo
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    diff = Image.composite(img, bg, img)
    
    # Find bounding box of non-white pixels
    bbox = img.getbbox()
    if bbox:
        # Get bounding box by removing plain white background pixels
        # Simple color mask to crop tightly
        datas = img.getdata()
        newData = []
        for item in datas:
            # If pixel is close to white, make transparent or crop border
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                newData.append((255, 255, 255, 0)) # transparent
            else:
                newData.append(item)
        img_transparent = Image.new("RGBA", img.size)
        img_transparent.putdata(newData)
        
        crop_box = img_transparent.getbbox()
        if crop_box:
            cropped_trans = img_transparent.crop(crop_box)
            cropped_orig = img.crop(crop_box)
        else:
            cropped_trans = img_transparent
            cropped_orig = img
    else:
        cropped_trans = img
        cropped_orig = img

    # Save to mobile assets
    os.makedirs("mobile/assets/images", exist_ok=True)
    
    # Save original high-res logo
    cropped_orig.save("mobile/assets/images/technotherm_logo_original.png")
    cropped_trans.save("mobile/assets/images/technotherm_logo.png")
    
    # Also save to frontend public
    os.makedirs("frontend/public", exist_ok=True)
    cropped_trans.save("frontend/public/logo.png")
    
    print("✓ Saved official logo assets to mobile/assets/images and frontend/public")
    
    # Generate Android App Launcher Icons
    base_res = "mobile/android/app/src/main/res"
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    
    for folder, size in densities.items():
        # Create launcher icon with white rounded square background
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        
        # Fit cropped logo in center with padding
        margin = int(size * 0.1)
        target_w = size - 2 * margin
        target_h = size - 2 * margin
        
        # Aspect ratio resize
        orig_w, orig_h = cropped_orig.size
        ratio = min(target_w / orig_w, target_h / orig_h)
        new_w = int(orig_w * ratio)
        new_h = int(orig_h * ratio)
        
        resized_logo = cropped_orig.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        pos_x = (size - new_w) // 2
        pos_y = (size - new_h) // 2
        
        canvas.paste(resized_logo, (pos_x, pos_y), resized_logo)
        
        out_dir = os.path.join(base_res, folder)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ic_launcher.png")
        canvas.save(out_path, "PNG")
        print(f"✓ Saved launcher icon: {out_path} ({size}x{size})")

if __name__ == "__main__":
    process_logo()
