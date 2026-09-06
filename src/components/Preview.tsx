import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ExtrudedMesh } from '../core/mesh';

export interface RenderPart {
  id: number;
  name: string;
  mesh: ExtrudedMesh;
  color: string;
}

export type PreviewProps = {
  width: number;
  height: number;
  baseColor: string;
  baseMesh: ExtrudedMesh | null;
  glyphParts: RenderPart[];
  view: 'perspective' | 'top' | 'side';
};

export default function Preview({ width, height, baseColor, baseMesh, glyphParts, view }: PreviewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rotRef = useRef<{ x: number; z: number }>({ x: 0.65, z: -0.5 });
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f9fc');

    const camera = new THREE.PerspectiveCamera(28, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.1, 2000);
    const maxDim = Math.max(width, height, 50);
    const cameraDist = maxDim * 2.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // Root model group that rotates
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 1.8);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight('#ffffff', 2.2);
    dirLight1.position.set(100, -120, 200);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight('#dfe8f7', 1.2);
    dirLight2.position.set(-100, 100, 150);
    scene.add(dirLight2);

    // Build Baseplate mesh from exact geometry
    if (baseMesh) {
      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute('position', new THREE.BufferAttribute(baseMesh.vertices, 3));
      baseGeo.setIndex(new THREE.BufferAttribute(baseMesh.indices, 1));
      baseGeo.computeVertexNormals();

      const baseMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.45,
        metalness: 0.08,
      });
      const baseMeshObj = new THREE.Mesh(baseGeo, baseMat);
      baseMeshObj.castShadow = true;
      baseMeshObj.receiveShadow = true;
      modelGroup.add(baseMeshObj);
    }

    // Build Glyph meshes from exact geometry
    glyphParts.forEach((part) => {
      const glyphGeo = new THREE.BufferGeometry();
      glyphGeo.setAttribute('position', new THREE.BufferAttribute(part.mesh.vertices, 3));
      glyphGeo.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
      glyphGeo.computeVertexNormals();

      const glyphMat = new THREE.MeshStandardMaterial({
        color: part.color,
        roughness: 0.4,
        metalness: 0.05,
      });
      const glyphMeshObj = new THREE.Mesh(glyphGeo, glyphMat);
      glyphMeshObj.castShadow = true;
      glyphMeshObj.receiveShadow = true;
      modelGroup.add(glyphMeshObj);
    });

    // Subtle drop shadow floor
    const floorGeo = new THREE.PlaneGeometry(width * 2.2, height * 2.2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.z = -0.5;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // View Angle Camera Setup
    if (view === 'perspective') {
      camera.position.set(0, -cameraDist * 0.75, cameraDist * 0.85);
      camera.lookAt(0, 0, 0);
      modelGroup.rotation.x = rotRef.current.x;
      modelGroup.rotation.z = rotRef.current.z;
    } else if (view === 'top') {
      camera.position.set(0, 0, cameraDist * 1.15);
      camera.lookAt(0, 0, 0);
      modelGroup.rotation.set(0, 0, 0);
    } else if (view === 'side') {
      camera.position.set(0, -cameraDist * 1.1, maxDim * 0.15);
      camera.lookAt(0, 0, 1.8);
      modelGroup.rotation.set(0, 0, 0);
    }

    // Mouse drag rotation in perspective view
    const onMouseDown = (e: MouseEvent) => {
      if (view !== 'perspective') return;
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || view !== 'perspective') return;
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      rotRef.current.z += dx * 0.012;
      rotRef.current.x = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, rotRef.current.x + dy * 0.012));
      modelGroup.rotation.x = rotRef.current.x;
      modelGroup.rotation.z = rotRef.current.z;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
    };

    mount.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    let frameId = 0;
    const render = () => {
      frameId = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };
    render();

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const observer = new ResizeObserver(onResize);
    observer.observe(mount);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      mount.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.domElement.remove();
    };
  }, [width, height, baseColor, baseMesh, glyphParts, view]);

  return (
    <div
      className="preview-canvas"
      ref={mountRef}
      style={{ cursor: view === 'perspective' ? 'grab' : 'default', width: '100%', height: '100%' }}
      aria-label="3D 실제 모델 미리보기"
    />
  );
}
