/**
 * textureWorker.js — Web Worker for off-thread PBR channel generation.
 * Receives: { buffer: ArrayBuffer, width: number, height: number }
 * Posts back: { roughness, ao, height, metallic, normal } all as ArrayBuffers (transferred).
 */
import {
  generateRoughnessMap,
  generateAOMap,
  generateHeightMap,
  generateMetallicMap,
  generateNormalMap,
} from './textureGenerator.js';

self.onmessage = ({ data }) => {
  const { buffer, width, height } = data;
  const imgData = { data: new Uint8ClampedArray(buffer), width, height };

  const roughness = generateRoughnessMap(imgData, 1.0);
  const ao        = generateAOMap(imgData, 1.0);
  const ht        = generateHeightMap(imgData, 1.0);
  const metallic  = generateMetallicMap(imgData, 0.8);
  const normal    = generateNormalMap(imgData, width, height, 5.0);

  const transferables = [roughness.buffer, ao.buffer, ht.buffer, metallic.buffer, normal.buffer];
  self.postMessage(
    { roughness: roughness.buffer, ao: ao.buffer, height: ht.buffer, metallic: metallic.buffer, normal: normal.buffer },
    transferables
  );
};
