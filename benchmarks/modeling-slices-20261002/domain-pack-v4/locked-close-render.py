# coding: utf-8
# Reuse the repository neutral studio, locking only normalization to the before report.
from pathlib import Path
import sys
reference=Path(sys.argv[-1]).resolve()
sys.argv=sys.argv[:-1]
script=Path('scripts/blender-neutral-render.py').read_text()
insert='''
def locked_normalize_scene(meshes):
    reference_report = json.loads(Path(%r).read_text())
    ref = reference_report['normalization']
    minimum, maximum = world_bounds(meshes)
    center = Vector(ref['sourceBounds']['min']) + Vector(ref['sourceBounds']['max'])
    center *= 0.5
    transform = Matrix.Scale(ref['scale'], 4) @ Matrix.Translation(-center)
    for root in [obj for obj in bpy.context.scene.objects if obj.parent is None]:
        root.matrix_world = transform @ root.matrix_world
    bpy.context.view_layer.update()
    low, high = world_bounds(meshes)
    return {'method':'reference-locked-broadside','referenceSha256':digest(Path(%r)),
        'scale':ref['scale'],'referenceCenter':list(center),
        'sourceBounds':{'min':list(minimum),'max':list(maximum),'size':list(maximum-minimum)},
        'normalizedBounds':{'min':list(low),'max':list(high),'size':list(high-low)}}

''' % (str(reference),str(reference))
script=script.replace('args = sys.argv',insert+'args = sys.argv',1).replace('normalization = normalize_scene(meshes)','normalization = locked_normalize_scene(meshes)',1)
exec(compile(script,'scripts/blender-neutral-render.py','exec'))
