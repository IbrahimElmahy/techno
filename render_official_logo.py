import os
from PIL import Image, ImageDraw, ImageFont

def draw_official_technotherm_logo(width=800, height=800, bg_transparent=True):
    # Canvas
    bg_color = (255, 255, 255, 0) if bg_transparent else (255, 255, 255, 255)
    img = Image.new('RGBA', (width, height), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Scale factor relative to 500x500 reference
    s = width / 500.0
    
    GREEN = (35, 161, 40, 255)    # #23A128 (Exact Techno Green)
    ORANGE = (245, 124, 0, 255)   # #F57C00 (Exact Therm Orange)
    BLACK = (17, 17, 17, 255)     # #111111 (German Technology)
    
    # ---------------------------------------------------- 1. House Mark & Leaf
    center_x = 250 * s
    house_top = 40 * s
    
    stroke_w = int(12 * s)
    
    # House Roof: Peak (250, 40) -> Left (130, 130) -> Right (370, 130)
    draw.line([(130*s, 130*s), (250*s, 40*s), (370*s, 130*s)], fill=GREEN, width=stroke_w, joint='curve')
    
    # House Walls: Left wall (155, 140) -> (155, 220) -> (200, 220)
    draw.line([(155*s, 140*s), (155*s, 220*s), (210*s, 220*s)], fill=GREEN, width=stroke_w, joint='curve')
    
    # Right wall (345, 140) -> (345, 220) -> (290, 220)
    draw.line([(345*s, 140*s), (345*s, 220*s), (290*s, 220*s)], fill=GREEN, width=stroke_w, joint='curve')
    
    # Solid Leaf inside house:
    # Curved Leaf shape using polygon approximation
    leaf_pts = []
    # Left curve of leaf
    for t in range(0, 101):
        p = t / 100.0
        # Bezier (250, 80) -> (180, 120) -> (210, 195) -> (250, 215)
        x = (1-p)**3 * 250 + 3*(1-p)**2*p * 180 + 3*(1-p)*p**2 * 210 + p**3 * 250
        y = (1-p)**3 * 80 + 3*(1-p)**2*p * 120 + 3*(1-p)*p**2 * 195 + p**3 * 215
        leaf_pts.append((x*s, y*s))
        
    # Right curve of leaf back to tip
    for t in range(0, 101):
        p = t / 100.0
        # Bezier (250, 215) -> (290, 195) -> (320, 120) -> (250, 80)
        x = (1-p)**3 * 250 + 3*(1-p)**2*p * 290 + 3*(1-p)*p**2 * 320 + p**3 * 250
        y = (1-p)**3 * 215 + 3*(1-p)**2*p * 195 + 3*(1-p)*p**2 * 120 + p**3 * 80
        leaf_pts.append((x*s, y*s))
        
    draw.polygon(leaf_pts, fill=GREEN)
    
    # Leaf Stem curving out at bottom:
    # Path from (250, 210) down to (250, 240) curving right to (280, 240) to (290, 225)
    stem_pts = []
    for t in range(0, 101):
        p = t / 100.0
        x = (1-p)**3 * 250 + 3*(1-p)**2*p * 245 + 3*(1-p)*p**2 * 300 + p**3 * 280
        y = (1-p)**3 * 200 + 3*(1-p)**2*p * 255 + 3*(1-p)*p**2 * 250 + p**3 * 230
        stem_pts.append((x*s, y*s))
        
    draw.line(stem_pts, fill=GREEN, width=int(14*s), joint='curve')
    
    # Inner white line inside leaf for leaf vein
    vein_pts = []
    for t in range(0, 101):
        p = t / 100.0
        x = (1-p)**2 * 250 + 2*(1-p)*p * 248 + p**2 * 248
        y = (1-p)**2 * 110 + 2*(1-p)*p * 160 + p**2 * 215
        vein_pts.append((x*s, y*s))
    draw.line(vein_pts, fill=(255, 255, 255, 255), width=int(3*s))
    
    # ---------------------------------------------------- 2. Text: TechnoTherm
    # We will try loading system fonts or default bold font
    try:
        font_main = ImageFont.truetype("arialbd.ttf", int(64 * s))
        font_sub = ImageFont.truetype("arialbd.ttf", int(28 * s))
    except Exception:
        font_main = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        
    text_y = 280 * s
    
    # Techno (Green) + Therm (Orange)
    # We draw text using crisp rendering
    draw.text((70 * s, text_y), "Techno", fill=GREEN, font=font_main)
    
    # Calculate offset for Therm
    bbox = font_main.getbbox("Techno")
    techno_w = bbox[2] - bbox[0] if bbox else 210 * s
    
    draw.text((70 * s + techno_w, text_y), "Therm", fill=ORANGE, font=font_main)
    
    # Underline (Left half Green, Right half Orange)
    line_y = text_y + 75 * s
    draw.line([(60 * s, line_y), (60 * s + techno_w + 10*s, line_y)], fill=GREEN, width=int(5*s))
    draw.line([(60 * s + techno_w + 10*s, line_y), (440 * s, line_y)], fill=ORANGE, width=int(5*s))
    
    # GERMAN TECHNOLOGY
    sub_y = line_y + 12 * s
    draw.text((70 * s, sub_y), "GERMAN  TECHNOLOGY", fill=BLACK, font=font_sub)
    
    return img

def main():
    os.makedirs("mobile/assets/images", exist_ok=True)
    
    # 1. Full logo image for Mobile & Web (Transparent & White BG versions)
    logo_trans = draw_official_technotherm_logo(1000, 1000, bg_transparent=True)
    logo_trans.save("mobile/assets/images/technotherm_logo.png", "PNG")
    
    logo_white = draw_official_technotherm_logo(1000, 1000, bg_transparent=False)
    logo_white.save("mobile/assets/images/technotherm_logo_white.png", "PNG")
    
    print("✓ Created official logo asset: mobile/assets/images/technotherm_logo.png")
    
    # 2. Android App Launcher Icons (with white background & padded logo)
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    
    base_res = "mobile/android/app/src/main/res"
    for folder, size in densities.items():
        # Create icon canvas (White background with slight rounded corners or square)
        icon = Image.new('RGBA', (size, size), (255, 255, 255, 255))
        
        # Resize rendered official logo to fit icon
        logo_resized = logo_white.resize((int(size * 0.85), int(size * 0.85)), Image.Resampling.LANCZOS)
        offset = int(size * 0.075)
        icon.paste(logo_resized, (offset, offset), logo_resized)
        
        out_dir = os.path.join(base_res, folder)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ic_launcher.png")
        icon.save(out_path, "PNG")
        print(f"✓ Updated launcher icon {out_path} ({size}x{size})")

if __name__ == "__main__":
    main()
