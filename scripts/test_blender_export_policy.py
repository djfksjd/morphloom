import unittest,tempfile,json,struct
from pathlib import Path
from blender_export_policy import tangent_export_required
class Policy(unittest.TestCase):
 def test_actual_source_requirements(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'case.glb'
   for doc,expected in [({'materials':[{'pbrMetallicRoughness':{}}]},False),({'meshes':[{'primitives':[{'attributes':{'TANGENT':0}}]}]},True),({'materials':[{'normalTexture':{'index':0}}]},True),({'materials':[{'extensions':{'KHR_materials_clearcoat':{'clearcoatNormalTexture':{'index':0}}}}]},True)]:
    data=json.dumps(doc).encode();p.write_bytes(b'glTF'+struct.pack('<IIII',2,20+len(data),len(data),0x4e4f534a)+data);self.assertEqual(tangent_export_required(p),expected)
   p.write_bytes(b'bad');self.assertRaises(RuntimeError,tangent_export_required,p)
if __name__=='__main__':unittest.main()
