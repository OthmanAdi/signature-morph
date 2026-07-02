# Signature Morph — Live-Projekt Do 02.07.2026

Three.js Deep Dive · Woche 4 · Klassenprojekt (live getippt)

Zwei glTF-Modelle werden in ~200.000 GPU-Partikel übersetzt und ineinander gemorpht: MeshSurfaceSampler liest die Oberflächen, ein Compute-Kernel mischt zwei Ziel-Buffer, GSAP dirigiert einen einzigen Fortschritts-Wert.

## Starten

```bash
bun install
bun run dev
```

Chrome oder Edge (WebGPU nötig, Selbsttest: webgpureport.org). Die Modelle liegen in `public/` und werden über `/DamagedHelmet.glb` geladen (führender Slash = Server-Wurzel, Vite serviert den Inhalt von public/ genau dort).

## Wiedereinstieg nach Pause — die Kurzkarte

Der Kopf von `src/main.js` enthält eine Wiedereinstiegs-Karte: was in Woche 3 (GSAP, ScrollTrigger, maath-Damping, Partikel/AdditiveBlending) und Woche 4 (WebGPURenderer, TSL-Nodes, Compute mit instancedArray + Fn().compute) passiert ist, und jeder Code-Block darunter sagt, aus welcher Woche sein Wissen stammt. Von oben nach unten lesen, dann bist du im Film.

Heutige Begleitseiten:
- Warmup (Konzept, 25 min lesen): https://steady-nimbus-ya2s.here.now/
- Praxis 1 (die Mathematik zum Anfassen): https://lucid-mantra-md46.here.now/
- Praxis 2 (der Übersetzer, selbst schreiben): https://olive-lemon-ffv9.here.now/

## Architektur-Regeln des Projekts

1. Renderer + NodeMaterials aus `three/webgpu`, Nodes aus `three/tsl`, nie aus nacktem `three`.
2. `await renderer.init()` vor dem ersten Render.
3. Genau EIN `scene.add(root)` — alles andere hängt an Gruppen.
4. WebGPU only: klarer Hinweis statt stillem Fallback.
5. Ein Mengen-Knopf (`particleCount`) parametrisiert die ganze Maschine.
