from __future__ import annotations

import json
import math
import os
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path("tmp/matplotlib")))

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_rgb
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
IR_PATH = ROOT / "outputs/laurel-homes-building-b-typical-floor.assembly-ir.json"
METRICS_PATH = ROOT / "outputs/laurel-homes-building-b-typical-floor.metrics.json"
MODEL_PATH = ROOT / "outputs/laurel-homes-building-b-typical-floor.png"
PLAN_PATH = ROOT / "tmp/pdfs/apartment-test/laurel-hi-6.png"
SOURCE_PLAN_PATH = ROOT / "outputs/laurel-homes-building-b-source-plan.png"
COMPARISON_PATH = ROOT / "outputs/laurel-homes-building-b-plan-vs-3d.jpg"


def rotation_matrix(rotation: list[float]) -> np.ndarray:
    rx, ry, rz = rotation
    sx, cx = math.sin(rx), math.cos(rx)
    sy, cy = math.sin(ry), math.cos(ry)
    sz, cz = math.sin(rz), math.cos(rz)
    x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return z @ y @ x


def box_faces(size: list[float], position: list[float], rotation: list[float]) -> list[np.ndarray]:
    half = np.array(size, dtype=float) / 2
    corners = np.array([
        [-half[0], -half[1], -half[2]], [half[0], -half[1], -half[2]],
        [half[0], half[1], -half[2]], [-half[0], half[1], -half[2]],
        [-half[0], -half[1], half[2]], [half[0], -half[1], half[2]],
        [half[0], half[1], half[2]], [-half[0], half[1], half[2]],
    ])
    transformed = corners @ rotation_matrix(rotation).T + np.array(position, dtype=float)
    indices = ([0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4])
    return [transformed[list(face)] for face in indices]


def shaded_color(color: str, face: np.ndarray) -> tuple[float, float, float]:
    base = np.array(to_rgb(color))
    a = face[1] - face[0]
    b = face[2] - face[0]
    normal = np.cross(a, b)
    length = np.linalg.norm(normal)
    if length:
        normal /= length
    light = np.array([-0.36, 0.78, 0.51])
    light /= np.linalg.norm(light)
    illumination = 0.62 + 0.34 * abs(float(np.dot(normal, light)))
    return tuple(np.clip(base * illumination + 0.035, 0, 1))


def render_model(ir: dict) -> None:
    # PIL painter's algorithm gives deterministic face-level depth sorting.
    # Matplotlib sorts each component as one collection, which allowed the very
    # large floor slab to hide smaller rooms even when they were physically above it.
    azimuth = math.radians(-54)
    elevation = math.radians(63)
    view = np.array([
        math.cos(elevation) * math.cos(azimuth),
        math.sin(elevation),
        math.cos(elevation) * math.sin(azimuth),
    ])
    view /= np.linalg.norm(view)
    right = np.cross(np.array([0.0, 1.0, 0.0]), view)
    right /= np.linalg.norm(right)
    up = np.cross(view, right)
    up /= np.linalg.norm(up)

    faces_to_draw: list[tuple[int, float, np.ndarray, tuple[int, int, int], bool]] = []
    projected_points: list[np.ndarray] = []
    for component in ir["components"]:
        geometry = component["geometry"]
        if geometry["op"] != "roundedBox":
            continue
        is_glass = component["material"].get("surface") == "optical-glass"
        component_id = component["id"]
        if component_id.endswith("_floor_slab"):
            layer = 0
        elif component_id.startswith("unit_") and component_id.endswith("_floor"):
            layer = 1
        elif is_glass:
            layer = 3
        else:
            layer = 2
        for face in box_faces(
            geometry["size"],
            component.get("position", [0, 0, 0]),
            component.get("rotation", [0, 0, 0]),
        ):
            projected = np.column_stack((face @ right, -(face @ up)))
            projected_points.extend(projected)
            shade = shaded_color(component["material"]["color"], face)
            color = tuple(int(channel * 255) for channel in shade)
            faces_to_draw.append((layer, float(np.mean(face @ view)), projected, color, is_glass))

    points = np.array(projected_points)
    minimum = points.min(axis=0)
    maximum = points.max(axis=0)
    canvas_width, canvas_height = 2_800, 1_620
    margin_x, margin_y = 150, 120
    scale = min(
        (canvas_width - margin_x * 2) / (maximum[0] - minimum[0]),
        (canvas_height - margin_y * 2) / (maximum[1] - minimum[1]),
    )

    def to_pixel(projected: np.ndarray) -> list[tuple[float, float]]:
        centered_width = (maximum[0] - minimum[0]) * scale
        centered_height = (maximum[1] - minimum[1]) * scale
        offset_x = (canvas_width - centered_width) / 2
        offset_y = (canvas_height - centered_height) / 2
        return [
            (offset_x + (point[0] - minimum[0]) * scale, offset_y + (point[1] - minimum[1]) * scale)
            for point in projected
        ]

    canvas = Image.new("RGB", (canvas_width, canvas_height), "#eeece5")
    draw = ImageDraw.Draw(canvas, "RGBA")
    # A larger depth is closer to the camera, so distant faces are painted first.
    for _, _, projected, color, is_glass in sorted(faces_to_draw, key=lambda item: (item[0], item[1])):
        fill = (*color, 112 if is_glass else 255)
        outline = (36, 38, 38, 80 if is_glass else 150)
        draw.polygon(to_pixel(projected), fill=fill, outline=outline, width=1)

    canvas.resize((1_680, 972), Image.Resampling.LANCZOS).save(MODEL_PATH)


def crop_plan(source: Image.Image) -> Image.Image:
    # The archival page embeds its landscape plan sideways. Crop the drawing
    # region before rotation so the plan—not the page border—fills the panel.
    width, height = source.size
    drawing = source.crop((int(width * 0.11), int(height * 0.15), int(width * 0.91), int(height * 0.91)))
    rotated = drawing.convert("L").rotate(270, expand=True, fillcolor=255)
    threshold = np.array(rotated) < 205
    ys, xs = np.where(threshold)
    if len(xs) == 0:
        return rotated.convert("RGB")
    left = max(0, int(xs.min()) - 40)
    top = max(0, int(ys.min()) - 40)
    right = min(rotated.width, int(xs.max()) + 40)
    bottom = min(rotated.height, int(ys.max()) + 40)
    return rotated.crop((left, top, right, bottom)).convert("RGB")


def fit_panel(image: Image.Image, size: tuple[int, int], background: str) -> Image.Image:
    copy = image.convert("RGB")
    copy.thumbnail((size[0] - 76, size[1] - 122), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", size, background)
    panel.paste(copy, ((size[0] - copy.width) // 2, 92 + (size[1] - 122 - copy.height) // 2))
    return panel


def render_comparison(parts: int, triangles: int) -> None:
    plan = crop_plan(Image.open(PLAN_PATH))
    plan.save(SOURCE_PLAN_PATH)
    model = Image.open(MODEL_PATH)
    width, height = 1440, 900
    left = fit_panel(plan, (width, height), "#fbfaf6")
    right = fit_panel(model, (width, height), "#eeece5")
    canvas = Image.new("RGB", (width * 2, height + 104), "#181816")
    canvas.paste(left, (0, 104))
    canvas.paste(right, (width, 104))
    draw = ImageDraw.Draw(canvas)
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    bold_path = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    title_font = ImageFont.truetype(bold_path, 30)
    meta_font = ImageFont.truetype(font_path, 19)
    draw.text((40, 22), "SOURCE · HABS OH-2468-A · FIRST-FLOOR PLAN", fill="#ffffff", font=title_font)
    draw.text((width + 40, 22), "MORPHLOOM · NINE-APARTMENT FLOOR CUTAWAY", fill="#ffffff", font=title_font)
    draw.text((40, 66), "139' × 46'4\" MAIN BAR · 36 APARTMENTS / 4 FLOORS DOCUMENTED", fill="#a9aaa4", font=meta_font)
    draw.text((width + 40, 66), f"{parts} NAMED PARTS · {triangles:,} TRIANGLES · 9 UNITS · 3 STAIRS", fill="#a9aaa4", font=meta_font)
    canvas.save(COMPARISON_PATH, quality=94, subsampling=0)


def main() -> None:
    with IR_PATH.open(encoding="utf-8") as stream:
        ir = json.load(stream)
    with METRICS_PATH.open(encoding="utf-8") as stream:
        metrics = json.load(stream)
    render_model(ir)
    render_comparison(metrics["parts"], metrics["triangles"])
    print(MODEL_PATH)
    print(COMPARISON_PATH)


if __name__ == "__main__":
    main()
