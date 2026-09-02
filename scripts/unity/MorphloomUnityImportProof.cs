using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;

namespace Morphloom.Editor
{
    [Serializable]
    internal sealed class UnityImportCase
    {
        public string id = "";
        public bool pass;
        public string sourceSha256 = "";
        public int gameObjects;
        public int meshes;
        public long vertices;
        public long triangles;
        public int materials;
        public int textures;
        public int skinnedMeshes;
        public int bones;
        public int blendShapes;
        public int animationClips;
        public string[] animationNames = Array.Empty<string>();
        public float[] boundsSizeMeters = Array.Empty<float>();
        public string[] blockers = Array.Empty<string>();
    }

    [Serializable]
    internal sealed class UnityImportReport
    {
        public string schema = "morphloom.unity-cross-domain-import/0.1";
        public string unityVersion = Application.unityVersion;
        public string generatedAt = DateTime.UtcNow.ToString("O");
        public bool pass;
        public UnityImportCase[] cases = Array.Empty<UnityImportCase>();
    }

    public static class CrossDomainImportProof
    {
        private const string FixtureRoot = "Assets/MorphloomFixtures";

        public static void Run()
        {
            var reportPath = ReadArgument("-morphloomReport");
            if (string.IsNullOrWhiteSpace(reportPath))
            {
                throw new ArgumentException("-morphloomReport is required.");
            }

            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var paths = Directory.GetFiles(FixtureRoot, "*.glb", SearchOption.TopDirectoryOnly)
                .Select(path => path.Replace('\\', '/'))
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            if (paths.Length != 5)
            {
                throw new InvalidOperationException($"Expected five GLB fixtures, found {paths.Length}.");
            }

            var cases = paths.Select(Inspect).ToArray();
            var report = new UnityImportReport
            {
                pass = cases.All(item => item.pass),
                cases = cases,
            };
            var absoluteReport = Path.GetFullPath(reportPath);
            Directory.CreateDirectory(Path.GetDirectoryName(absoluteReport) ?? ".");
            File.WriteAllText(absoluteReport, JsonUtility.ToJson(report, true) + Environment.NewLine);
            Debug.Log($"MORPHLOOM_UNITY_REPORT {absoluteReport} pass={report.pass}");
            if (!report.pass)
            {
                throw new InvalidOperationException("One or more Morphloom Unity imports failed.");
            }
        }

        private static UnityImportCase Inspect(string assetPath)
        {
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var id = Path.GetFileNameWithoutExtension(assetPath);
            var blockers = new List<string>();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
            {
                return new UnityImportCase
                {
                    id = id,
                    sourceSha256 = Sha256(assetPath),
                    blockers = new[] { "glTFast did not create a native Unity prefab" },
                };
            }

            var instance = UnityEngine.Object.Instantiate(prefab);
            instance.name = $"__morphloom_proof_{id}";
            try
            {
                var transforms = instance.GetComponentsInChildren<Transform>(true);
                var meshFilters = instance.GetComponentsInChildren<MeshFilter>(true);
                var skinnedRenderers = instance.GetComponentsInChildren<SkinnedMeshRenderer>(true);
                var renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer is MeshRenderer || renderer is SkinnedMeshRenderer)
                    .ToArray();
                var meshes = meshFilters.Select(filter => filter.sharedMesh)
                    .Concat(skinnedRenderers.Select(renderer => renderer.sharedMesh))
                    .Where(mesh => mesh != null)
                    .Distinct()
                    .ToArray();
                var materials = renderers.SelectMany(renderer => renderer.sharedMaterials)
                    .Where(material => material != null)
                    .Distinct()
                    .ToArray();
                var textures = materials.SelectMany(MaterialTextures).Distinct().ToArray();
                var animationClips = AssetDatabase.LoadAllAssetsAtPath(assetPath)
                    .OfType<AnimationClip>()
                    .Where(clip => !clip.name.StartsWith("__preview__", StringComparison.Ordinal))
                    .OrderBy(clip => clip.name, StringComparer.Ordinal)
                    .ToArray();

                if (meshes.Length == 0) blockers.Add("no native Unity meshes");
                if (meshes.Sum(mesh => (long)mesh.vertexCount) == 0) blockers.Add("no vertices");
                if (meshes.Sum(TriangleCount) == 0) blockers.Add("no triangles");
                if (materials.Length == 0) blockers.Add("no native Unity materials");
                if (transforms.Any(transform => !Finite(transform.localPosition)
                    || !Finite(transform.localScale) || !Finite(transform.localRotation))) blockers.Add("non-finite transform");
                if (skinnedRenderers.Any(renderer => renderer.rootBone == null
                    || renderer.bones.Length == 0 || renderer.bones.Any(bone => bone == null))) blockers.Add("broken skin binding");

                var bounds = CombinedBounds(renderers, blockers);
                var bones = skinnedRenderers.SelectMany(renderer => renderer.bones)
                    .Where(bone => bone != null)
                    .Distinct()
                    .Count();
                var result = new UnityImportCase
                {
                    id = id,
                    sourceSha256 = Sha256(assetPath),
                    gameObjects = transforms.Length,
                    meshes = meshes.Length,
                    vertices = meshes.Sum(mesh => (long)mesh.vertexCount),
                    triangles = meshes.Sum(TriangleCount),
                    materials = materials.Length,
                    textures = textures.Length,
                    skinnedMeshes = skinnedRenderers.Length,
                    bones = bones,
                    blendShapes = meshes.Sum(mesh => mesh.blendShapeCount),
                    animationClips = animationClips.Length,
                    animationNames = animationClips.Select(clip => clip.name).ToArray(),
                    boundsSizeMeters = new[] { bounds.size.x, bounds.size.y, bounds.size.z },
                    blockers = blockers.ToArray(),
                };
                result.pass = result.blockers.Length == 0;
                Debug.Log($"MORPHLOOM_UNITY_CASE {id} pass={result.pass} meshes={result.meshes} tris={result.triangles}");
                return result;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }

        private static IEnumerable<Texture> MaterialTextures(Material material)
        {
            if (material == null || material.shader == null) yield break;
            foreach (var propertyName in material.GetTexturePropertyNames())
            {
                var texture = material.GetTexture(propertyName);
                if (texture != null) yield return texture;
            }
        }

        private static long TriangleCount(Mesh mesh)
        {
            long indices = 0;
            for (var subMesh = 0; subMesh < mesh.subMeshCount; subMesh += 1)
            {
                if (mesh.GetTopology(subMesh) != MeshTopology.Triangles) continue;
                indices += (long)mesh.GetIndexCount(subMesh);
            }
            return indices / 3;
        }

        private static Bounds CombinedBounds(Renderer[] renderers, List<string> blockers)
        {
            if (renderers.Length == 0)
            {
                blockers.Add("no render bounds");
                return new Bounds();
            }
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            if (!Finite(bounds.center) || !Finite(bounds.size) || bounds.size.x <= 0 || bounds.size.y <= 0 || bounds.size.z <= 0)
            {
                blockers.Add("invalid render bounds");
            }
            return bounds;
        }

        private static bool Finite(Vector3 value)
        {
            return Finite(value.x) && Finite(value.y) && Finite(value.z);
        }

        private static bool Finite(Quaternion value)
        {
            return Finite(value.x) && Finite(value.y)
                && Finite(value.z) && Finite(value.w);
        }

        private static bool Finite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private static string Sha256(string assetPath)
        {
            using (var stream = File.OpenRead(Path.GetFullPath(assetPath)))
            using (var hash = SHA256.Create())
            {
                return string.Concat(hash.ComputeHash(stream).Select(value => value.ToString("x2")));
            }
        }

        private static string ReadArgument(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var index = 0; index + 1 < args.Length; index += 1)
            {
                if (args[index] == name) return args[index + 1];
            }
            return "";
        }
    }
}
