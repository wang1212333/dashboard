import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve('src/design-library/lieflat-assets');
const catalog=JSON.parse(await readFile(resolve(root,'catalog.json'),'utf8'));
await mkdir(resolve(root,'covers'),{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
 for(const entry of catalog.templates){
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  await page.goto(pathToFileURL(resolve(root,entry.file)).href,{waitUntil:'load',timeout:30000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(1800);
  const shot=await page.screenshot({fullPage:entry.kind==='report'});
  await sharp(shot).resize(640,420,{fit:'contain',background:'#f0efeb'}).webp({quality:85}).toFile(resolve(root,entry.cover));
  console.log(entry.id);
  await page.close();
 }
} finally {await browser.close()}
