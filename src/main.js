/**
 * ============================================================================
 *  SIGNATURE MORPH — Live-Projekt, Donnerstag 02.07.2026
 *  Three.js Deep Dive · Woche 4 · Morphos GmbH
 * ============================================================================
 *
 *  Was hier entsteht:
 *  Zwei echte glTF-Modelle (Helm, Flasche) werden in Punktwolken übersetzt
 *  und ineinander gemorpht: ~200.000 Partikel, komplett auf der GPU gerechnet,
 *  mit GSAP als Dirigent für einen einzigen Fortschritts-Wert.
 *
 *  Die drei Stack-Regeln dieser Woche (auswendig können):
 *  1. Renderer + alle NodeMaterials kommen aus 'three/webgpu'.
 *  2. Alle Nodes (uniform, Fn, mix, ...) kommen aus 'three/tsl'.
 *     Importiert man eins davon aus dem nackten 'three', ist es undefined.
 *  3. `await renderer.init()` steht VOR dem ersten Render.
 *     Ohne: schwarzer Schirm, keine Fehlermeldung.
 *
 *  Wiedereinstieg nach Pause? Kurzkarte der letzten zwei Wochen:
 *  - W3: GSAP (to/timeline/ease), ScrollTrigger, maath-Damping, Partikel
 *        mit Points + eigenem Point-Shader, AdditiveBlending.
 *  - W4: WebGPURenderer (Mo/Di), TSL-Nodes statt GLSL-Strings (Di/Mi),
 *        gestern: Compute-Shader — instancedArray, Fn().compute(n),
 *        renderer.compute() — eine Galaxie, die die GPU selbst rechnet.
 *  Alles davon wird heute EIN System. Die Kommentare unten sagen bei jedem
 *  Block, aus welcher Woche das Wissen stammt.
 * ============================================================================
 */

import * as THREE from 'three/webgpu';                                  // Stack-Regel 1: Renderer + NodeMaterials IMMER aus three/webgpu
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Kamera-Steuerung, bekannt seit W1
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';        // Modelle laden, bekannt seit W2 (Asset-Pipeline-Tag)
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js'; // NEU HEUTE: die eine neue Klasse des Tages
import GUI from 'three/addons/libs/lil-gui.module.min.js';              // Regler-Cockpit für Look-Entscheidungen im Bild
import WebGPU from 'three/addons/capabilities/WebGPU.js';               // der Türsteher: prüft, ob WebGPU wirklich da ist
import gsap from 'gsap';                                                // der Dirigent (W3-Wissen), Auftritt weiter unten
import {
  uniform, Fn, instancedArray, instanceIndex, hash,
  mix, float, color,
} from 'three/tsl';                                                     // Stack-Regel 2: Nodes IMMER aus three/tsl

/* ----------------------------------------------------------------------------
 * TÜRSTEHER — WebGPU oder gar nicht.
 * Der Morph rechnet gleich mit Compute-Shadern, dafür gibt es keinen
 * WebGL-Ersatz. Also kein stiller Fallback: klare Ansage statt kaputter
 * Leinwand. (Chrome oder Edge. Selbsttest: webgpureport.org)
 * ------------------------------------------------------------------------- */
if (WebGPU.isAvailable() === false) {
    document.body.innerHTML = '<p style="font:600 16px system-ui; color:#dffdff; padding: 40px"> Diese Szene Brauchst WEBGPU - Daher Bitte In Chrom Oder Edge Oefnnen</p>'
    throw new Error('WebGPU nicht verfugbar');
}

/* ----------------------------------------------------------------------------
 * MOTOR + BÜHNE  (Grundgerüst aus W1, Renderer-Generation aus W4)
 * ------------------------------------------------------------------------- */
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // DPR-Deckel: Schärfe ja, 4K-Selbstmord nein
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05060a);                              // das Haus-Dunkelblau des Monats
document.body.appendChild(renderer.domElement);

await renderer.init();   // Stack-Regel 3. OHNE diese Zeile: schwarzer Schirm, KEINE Fehlermeldung.

const scene = new THREE.Scene();
const root = new THREE.Group();
scene.add(root);         // Architektur-Regel des Projekts: das EINZIGE scene.add im ganzen Code.
                         // Alles Weitere hängt an root — so lässt sich die komplette Szene als
                         // Einheit drehen, skalieren, ausblenden oder in eine andere Umgebung setzen.

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0, 1.3, 8)          // leicht erhöht, Blick auf die Bühnenmitte

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true;          // weiches Nachlaufen — das Damping-Gefühl kennst du aus W3 (maath)

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)     // Hauptlicht ("Key"), neutralweiß
keyLight.position.set(3, 5, 4)
root.add(keyLight)                                             // Licht an die GRUPPE, nicht an die Szene (siehe oben)
root.add(new THREE.AmbientLight(0x9bbcff, 0.35))               // kühles Fülllicht, passt zum Staub-Look

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();                             // nach jeder aspect-Änderung: Kamera-Mathematik neu
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ----------------------------------------------------------------------------
 * RENDER-LOOP  (W1-Wissen: setAnimationLoop ist das rAF von Three.js)
 * Läuft bewusst schon JETZT, vor den Modellen: leere Bühne ist ein gültiger
 * Zwischenstand. Der Compute-Teil ersetzt diesen Loop später durch eine
 * Version mit renderer.compute(...) pro Frame.
 * ------------------------------------------------------------------------- */
renderer.setAnimationLoop(() => {
    controls.update()                   // Damping braucht ein Update pro Frame
    renderer.render(scene, camera)
})

/* ----------------------------------------------------------------------------
 * DATENQUELLEN — zwei GLBs laden  (GLTFLoader aus W2, Promise.all aus W1)
 * Konzept des Tages: die Modelle betreten die Bühne NIE als Meshes. Sie sind
 * Datenquellen, von deren Oberfläche wir gleich Stichproben ziehen.
 * Pfad-Regel: führender / = Wurzel des Dev-Servers, und Vite serviert den
 * INHALT von public/ genau an dieser Wurzel — der Ordnername verschwindet.
 * (/public/... funktioniert nur zufällig im Dev-Modus und bricht beim Build.)
 * ------------------------------------------------------------------------- */
const loader = new GLTFLoader();
const [helmetGLB, bottleGLB] = await Promise.all([   // beide gleichzeitig, fail-fast (W1)
    loader.loadAsync('/DamagedHelmet.glb'),
    loader.loadAsync('/WaterBottle.glb')
]);

/**
 * Fischt das erste echte Mesh aus einem glTF-Szenenbaum.
 *
 * Ein GLB ist nie "ein Mesh", sondern ein Baum aus Nodes (Gruppen, Kameras,
 * Lichter, Meshes). Wir wollen das erste Kind, das wirklich Geometrie trägt.
 *
 * @param {THREE.Object3D} object3d  Wurzelknoten des GLB (gltf.scene)
 * @returns {THREE.Mesh}             erstes Mesh mit Geometrie im Baum
 * @throws {Error}                   wenn kein Mesh existiert — LAUT scheitern
 *                                   statt still mit nichts weiterrechnen
 */
function firstMeshFrom(object3d){
    let found = null;
    object3d.updateWorldMatrix(true, true)   // Welt-Matrizen JETZT rechnen (Eltern + Kinder):
                                             // das Sampling gleich braucht mesh.matrixWorld aktuell
    object3d.traverse((child) => {           // traverse besucht JEDEN Knoten im Baum, auch tiefe
        if (!found && child.isMesh && child.geometry) found = child;
    })
    if (!found) throw new Error('Kein Mesh im GLB gefunden')

    return found;
}

const meshA = firstMeshFrom(helmetGLB.scene);   // Datenquelle A — .scene ist die Wurzel des GLB-Baums
const meshB = firstMeshFrom(bottleGLB.scene);   // Datenquelle B

/* ============================================================================
 *  AB HIER: DIE PARTIKEL-MASCHINE  (entsteht gerade live, parametrisiert)
 * ============================================================================
 *  Bauplan in fester Reihenfolge — jeder Schritt ist einzeln lauffähig:
 *
 *  1. ÜBERSETZER    sampleMeshSurface(mesh, count)
 *                   Oberfläche flächengewichtet befragen -> Float32Array.
 *                   Parametrisiert über EINEN Mengen-Knopf (particleCount):
 *                   schwächere GPU = eine Zahl ändern, sonst nichts.
 *
 *  2. NORMALISIERER beide Wolken zentrieren + auf gleiche Größe bringen,
 *                   sonst morpht ein Riesen-Helm in eine Mini-Flasche.
 *
 *  3. DREI BUFFER   zwei stille Gedächtnisse (Ziel A, Ziel B) + eine Bühne
 *                   (livePositions), aus der gezeichnet wird — instancedArray,
 *                   gestern bei der Galaxie zum ersten Mal benutzt.
 *
 *  4. KERNEL        Fn(...).compute(n): pro Partikel mix(A, B, uProgress)
 *                   plus Streuung über hash(instanceIndex). Die GPU mischt
 *                   200.000-fach parallel, die CPU schickt nur eine Zahl.
 *
 *  5. DIRIGENT      gsap tweent uProgress.value (W3: Timeline + Easing),
 *                   lil-gui bekommt Regler für Geschmack.
 * ============================================================================
 */

const particleCount = 200000;

function sampleMeshSurface(mesh, count) {
  const geometry = mesh.geometry.clone(); //NO MUTATION
  geometry.applyMatrix4(mesh.matrixWorld);

  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build(); // Ergebniss ist ein GEWISCHTTABELLE die ThreeJS zum rendering versteht.
  const point = new THREE.Vector3();
  const array = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    sampler.sample(point);
    array[i * 3 + 0] = point.x;
    array[i * 3 + 1] = point.y;
    array[i * 3 + 2] = point.z;
  }

  geometry.dispose();
  return array;
}


function normalizePointCloud(array, targetRadius){
    const min = new THREE.Vector3(+Infinity, +Infinity, +Infinity)
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)

    // const box = new THREE.Box3().setFromArray(array)
    // const center = box.getCenter(new THREE.Vector3())
    // const size = box.getSize(new THREE.Vector3())

    for(let i = 0; i< array.length; i += 3){
        min.x = Math.min(min.x, array[i]);      max.x = Math.max(max.x, array[i]);
        min.y = Math.min(min.y, array[i +1]);   max.y = Math.max(max.y, array[i +1]);
        min.z = Math.min(min.z, array[i + 2]);  max.z = Math.max(max.z, array[i + 2]);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const size = max.clone().sub(min);
    const scale = targetRadius / Math.max(size.x, size.y, size.z);

    for(let i = 0; i < array.length; i += 3){
        array[i] = (array[i] - center.x) * scale;
        array[i + 1] = (array[i + 1] - center.y) * scale;
        array[i + 2] = (array[i + 2] - center.z) * scale;
    }
}

const pointsA = sampleMeshSurface(meshA, particleCount);
const pointsB = sampleMeshSurface(meshB, particleCount);
normalizePointCloud(pointsA, 2.5);
normalizePointCloud(pointsB, 2.5);

const targetA = instancedArray(pointsA, 'vec3')

const targetB = instancedArray(pointsB, 'vec3')
const livePositions = instancedArray(new Float32Array(pointsA), 'vec3')

const particleMaterial = new THREE.PointsNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    size: 1.45,
    sizeAttenuation: true,
});

particleMaterial.positionNode = livePositions.element(instanceIndex)

particleMaterial.colorNode = mix(
    color(0x65e9ff),
    color(0xff9f6e),
    hash(instanceIndex) //PRO PARTICLE-ID
)

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3), 3))
particleGeometry.drawRange.count = 1;
const particles = new THREE.Points(particleGeometry, particleMaterial)

particles.count = particleCount;

root.add(particles);

// console.log('NaN-Check A:', pointsA.some(Number.isNaN))

// const debugCloud = new THREE.Points(
//     new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pointsA, 3)),
//     new THREE.PointsMaterial({
//         size:0.02,
//         color:0x8be0c8,
//         transparent:true,
//         depthWrite:false,
//         blending: THREE.AdditiveBlending
//     })
// )

// root.add(debugCloud);
// gsap.to(debugCloud.scale, {x:1.15 , y:1.15, z:1.15 , duration: 1.4, yoyo: true, repeat: -1, ease: 'sine.inOut'});