import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const source='resources/icon.png';
const bg={r:10,g:118,b:255,alpha:1};
const sizes={ldpi:36,mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192};
for(const [density,size] of Object.entries(sizes)){
  const dir=path.join('android/app/src/main/res','mipmap-'+density);
  fs.mkdirSync(dir,{recursive:true});
  const art=await sharp(source).resize(size,size,{fit:'cover'}).png().toBuffer();
  await sharp(art).toFile(path.join(dir,'ic_launcher.png'));
  const mask=Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`);
  await sharp(art).composite([{input:mask,blend:'dest-in'}]).png().toFile(path.join(dir,'ic_launcher_round.png'));
  const adaptive=Math.round(size*108/48);
  const artLarge=await sharp(source).resize(adaptive,adaptive,{fit:'cover'}).png().toBuffer();
  await sharp(artLarge).toFile(path.join(dir,'ic_launcher_foreground.png'));
  await sharp({create:{width:adaptive,height:adaptive,channels:4,background:bg}}).png().toFile(path.join(dir,'ic_launcher_background.png'));
}
console.log('Generated blue launcher assets.');
