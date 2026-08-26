import os
from PIL import Image, ImageDraw

def create_technotherm_icon(size):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle background (TechnoTherm Green gradient base)
    padding = int(size * 0.05)
    rect = [padding, padding, size - padding, size - padding]
    radius = int(size * 0.22)
    
    # Draw dark green rounded square background
    draw.rounded_rectangle(rect, radius=radius, fill=(63, 169, 43, 255)) # #3FA92B
    
    # Inner border / highlight
    inner_padding = int(size * 0.08)
    inner_rect = [inner_padding, inner_padding, size - inner_padding, size - inner_padding]
    draw.rounded_rectangle(inner_rect, radius=radius - 2, outline=(255, 255, 255, 60), width=max(1, int(size * 0.02)))
    
    # Draw Roof and House Mark in White and Orange Accent
    s = size / 120.0
    
    # Roof (White)
    roof_pts = [(14*s, 56*s), (60*s, 16*s), (106*s, 56*s)]
    draw.line(roof_pts, fill=(255, 255, 255, 255), width=max(2, int(9*s)), joint='curve')
    
    # Left Wall
    l_pts = [(26*s, 62*s), (26*s, 96*s), (46*s, 96*s)]
    draw.line(l_pts, fill=(255, 255, 255, 255), width=max(2, int(9*s)), joint='curve')
    
    # Right Wall
    r_pts = [(94*s, 62*s), (94*s, 96*s), (74*s, 96*s)]
    draw.line(r_pts, fill=(255, 255, 255, 255), width=max(2, int(9*s)), joint='curve')
    
    # Leaf in Orange / White Highlight
    # Center circle / emblem accent
    cx, cy = int(60*s), int(64*s)
    r_emb = int(18*s)
    draw.ellipse([cx - r_emb, cy - r_emb, cx + r_emb, cy + r_emb], fill=(240, 124, 30, 255)) # #F07C1E Therm Orange
    
    # Inner white dot
    r_dot = int(6*s)
    draw.ellipse([cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot], fill=(255, 255, 255, 255))
    
    return img

def main():
    base_res = "mobile/android/app/src/main/res"
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    
    for folder, size in densities.items():
        out_dir = os.path.join(base_res, folder)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ic_launcher.png")
        icon_img = create_technotherm_icon(size)
        icon_img.save(out_path, "PNG")
        print(f"✓ Generated {out_path} ({size}x{size})")

if __name__ == "__main__":
    main()
