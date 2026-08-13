import { readFileSync, writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';

const svgBuffer = readFileSync('public/icons/icon.svg');
const resvg = new Resvg(svgBuffer, {
  fitTo: { mode: 'width', value: 1024 },
});
const pngBuffer = resvg.render().asPng();

writeFileSync('resources/icon.png', pngBuffer);
console.log('✅ resources/icon.png generated (1024x1024)');
