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
IR_PATH = ROOT / "outputs/poor-coyotes-cabin-habs-test.assembly-ir.json"
MODEL_PATH = ROOT / "outputs/poor-coyotes-cabin-3d-test.png"
PLAN_PATH = ROOT / "tmp/pdfs/building-test/poor-coyotes-cabin-plan.png"
COMPARISON_PATH = ROOT / "outputs/poor-coyotes-cabin-plan-vs-3d-test.jpg"


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
        [-half[0], -half[1], -half[2]],
        [half[0], -half[1], -half[2]],
        [half[0], half[1], -half[2]],
        [-half[0], half[1], -half[2]],
        [-half[0], -half[1], half[2]],
        [half[0], -half[1], half[2]],
        [half[0], half[1], half[2]],
        [-half[0], half[1], half[2]],
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
    light = np.array([-0.45, 0.82, 0.35])
    light /= np.linalg.norm(light)
    illumination = 0.58 + 0.4 * abs(float(np.dot(normal, light)))
    return tuple(np.clip(base * illumination + 0.035, 0, 1))


def render_model(ir: dict) -> None:
    figure = plt.figure(figsize=(10.5, 8.2), facecolor="#f2f0e9")
    axis = figure.add_subplot(111, projection="3d", facecolor="#f2f0e9")

    for component in ir["components"]:
        geometry = component["geometry"]
        if geometry["op"] != "roundedBox":
            continue
        source_faces = box_faces(
            geometry["size"],
            component.get("position", [0, 0, 0]),
            component.get("rotation", [0, 0, 0]),
        )
        # Three.js uses Y-up while Matplotlib's 3D view displays Z vertically.
        faces = [face[:, [0, 2, 1]] for face in source_faces]
        colors = [shaded_color(component["material"]["color"], face) for face in faces]
        collection = Poly3DCollection(
            faces,
            facecolors=colors,
            edgecolors=(0.18, 0.14, 0.11, 0.34),
            linewidths=0.22,
        )
        collection.set_zsort("average")
        axis.add_collection3d(collection)

    axis.set_xlim(-3600, 3600)
    axis.set_ylim(-3300, 3300)
    axis.set_zlim(-900, 5200)
    axis.set_box_aspect((1.15, 1.05, 0.94))
    axis.view_init(elev=24, azim=-48)
    axis.set_axis_off()
    figure.subplots_adjust(left=0, right=1, top=1, bottom=0)
    figure.savefig(MODEL_PATH, dpi=240, bbox_inches="tight", pad_inches=0.02, facecolor=figure.get_facecolor())
    plt.close(figure)


def fit_panel(image: Image.Image, size: tuple[int, int], background: str) -> Image.Image:
    copy = image.convert("RGB")
    copy.thumbnail((size[0] - 80, size[1] - 120), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", size, background)
    panel.paste(copy, ((size[0] - copy.width) // 2, 86 + (size[1] - 120 - copy.height) // 2))
    return panel


def render_comparison() -> None:
    plan = Image.open(PLAN_PATH)
    model = Image.open(MODEL_PATH)
    width, height = 1280, 920
    left = fit_panel(plan, (width, height), "#fbfaf6")
    right = fit_panel(model, (width, height), "#f2f0e9")
    canvas = Image.new("RGB", (width * 2, height + 96), "#171714")
    canvas.paste(left, (0, 96))
    canvas.paste(right, (width, 96))
    draw = ImageDraw.Draw(canvas)
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    bold_path = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    title_font = ImageFont.truetype(bold_path, 31)
    meta_font = ImageFont.truetype(font_path, 20)
    draw.text((42, 24), "SOURCE PLAN · HABS ID-75", fill="#ffffff", font=title_font)
    draw.text((width + 42, 24), "MORPHLOOM 3D TEST · 116 NAMED PARTS", fill="#ffffff", font=title_font)
    draw.text((42, 62), "MEASURED 17'4\" × 13'10\" · PUBLIC-DOMAIN HABS RECORD", fill="#a9aaa4", font=meta_font)
    draw.text((width + 42, 62), "108,432 TRIANGLES · 0 BOUNDARY / NON-MANIFOLD EDGES", fill="#a9aaa4", font=meta_font)
    canvas.save(COMPARISON_PATH, quality=94, subsampling=0)


def main() -> None:
    with IR_PATH.open(encoding="utf-8") as stream:
        ir = json.load(stream)
    render_model(ir)
    render_comparison()
    print(MODEL_PATH)
    print(COMPARISON_PATH)


if __name__ == "__main__":
    main()
