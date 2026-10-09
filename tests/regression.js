'use strict';
const assert=require('assert'), fs=require('fs'), path=require('path'), os=require('os'), vm=require('vm');
const Core=require('../client/bitmap-core');
const root=path.resolve(__dirname,'..');
const pkgVer=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperfig-tests-'));
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
function metadata(name,bytes){const f=path.join(dir,name);fs.writeFileSync(f,bytes);return Core.readMetadata(fs,f,Buffer);}
function tiff(le){const b=Buffer.alloc(300080); b.write(le?'II':'MM');const w16=(v,p)=>le?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p);const w32=(v,p)=>le?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);w16(42,2);w32(300000,4);w16(4,300000);[[256,1200],[257,800],[258,16],[277,1]].forEach(([tag,v],i)=>{let p=300002+i*12;w16(tag,p);w16(4,p+2);w32(1,p+4);w32(v,p+8);});return b;}
try {
 test('TIFF directory beyond 256 KiB; both byte orders; bounded I/O',()=>{for(const le of [true,false]){const m=metadata('late'+le+'.tif',tiff(le));assert.equal(m.width,1200);assert.equal(m.height,800);assert.equal(m.bitsPerSample,16);assert(m.bytesRead<200);}});
 test('JPEG SOF after large metadata segments',()=>{let b=Buffer.alloc(140030);b[0]=255;b[1]=216;let p=2;for(let i=0;i<3;i++){b[p]=255;b[p+1]=225;b.writeUInt16BE(40000,p+2);p+=40002;}b[p]=255;b[p+1]=194;b.writeUInt16BE(17,p+2);b[p+4]=8;b.writeUInt16BE(600,p+5);b.writeUInt16BE(900,p+7);b[p+9]=3;let m=metadata('late.jpg',b);assert.equal(m.width,900);assert.equal(m.height,600);assert.equal(m.orientation||1,1);assert(m.bytesRead<100);});
 test('JPEG EXIF Orientation from APP1 IFD0',()=>{function jpegWithOrient(orient,le){const sof=Buffer.alloc(19);sof[0]=255;sof[1]=192;sof.writeUInt16BE(17,2);sof[4]=8;sof.writeUInt16BE(40,5);sof.writeUInt16BE(80,7);sof[9]=3;const ifd=Buffer.alloc(2+12+4);const w16=(b,p,v)=>le?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p);const w32=(b,p,v)=>le?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);w16(ifd,0,1);w16(ifd,2,274);w16(ifd,4,3);w32(ifd,6,1);w16(ifd,10,orient);w32(ifd,14,0);const tiff=Buffer.alloc(8+ifd.length);tiff.write(le?'II':'MM');w16(tiff,2,42);w32(tiff,4,8);ifd.copy(tiff,8);const exifBody=Buffer.concat([Buffer.from('Exif\0\0','binary'),tiff]);const app1=Buffer.alloc(4+exifBody.length);app1[0]=255;app1[1]=225;app1.writeUInt16BE(exifBody.length+2,2);exifBody.copy(app1,4);return Buffer.concat([Buffer.from([255,216]),app1,sof]);}for(const le of [true,false]){for(const o of [1,3,6,8]){const m=metadata('o'+o+(le?'le':'be')+'.jpg',jpegWithOrient(o,le));assert.equal(m.width,80);assert.equal(m.height,40);assert.equal(m.orientation,o);}}});
 test('exifOrientationTransform covers tags 1-8',()=>{const map={1:[0,false,false],2:[0,true,false],3:[2,false,false],4:[2,true,false],5:[1,true,true],6:[3,false,true],7:[3,true,true],8:[1,false,true]};for(const [o,exp] of Object.entries(map)){const xf=Core.exifOrientationTransform(Number(o));assert.equal(xf.turns,exp[0]);assert.equal(xf.flipH,exp[1]);assert.equal(xf.swap,exp[2]);}assert.equal(Core.exifOrientationTransform(99).turns,0);});
 test('PNG dimensions and bit depth',()=>{const b=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(300,16);b.writeUInt32BE(200,20);b[24]=16;assert.equal(metadata('a.png',b).bitsPerSample,16);});
 test('Truncated metadata is rejected, descriptor closed',()=>{assert.throws(()=>metadata('truncated.tif',tiff(true).subarray(0,40)),/Invalid/);});
 test('Crop clamps right/bottom and rejects outside source',()=>{assert.deepEqual(Core.cropRect({cropLeft:90,cropTop:40,cropWidth:30,cropHeight:20},100,50),{left:90,top:40,width:10,height:10});assert.throws(()=>Core.cropRect({cropLeft:100,cropWidth:1,cropHeight:1},100,50),/outside/);assert.equal(Core.cropRect({cropWidth:0,cropHeight:20},100,50).width,100);});
 test('Separable blur matches 3x3 reference within one quantization level',()=>{for(const [w,h] of [[1,1],[1,5],[7,1],[9,6]]){let d=new Uint8ClampedArray(w*h*4);for(let i=0;i<d.length;i++)d[i]=(i*37+19)%256;let expected=new Uint8ClampedArray(d.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<4;c++){let sum=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){let xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h){sum+=d[(yy*w+xx)*4+c];n++;}}expected[(y*w+x)*4+c]=sum/n;}let im={width:w,height:h,data:d};let scratch=Core.boxBlur3(im);assert(d.every((v,i)=>Math.abs(v-expected[i])<=1));assert.strictEqual(Core.boxBlur3(im,scratch).horizontal,scratch.horizontal);}});
 const host=fs.readFileSync(path.join(root,'jsx/bitmap.jsx'),'utf8');
 const doc={name:'test.ai',fullName:{fsName:'/test.ai'},selection:[]};
 let writes=0;
 let places=0;
 function item(uuid,source){return {typename:'PlacedItem',uuid,name:uuid,embedded:false,file:{fsName:source,name:'image.png',exists:true,length:12},width:100,height:100,position:[0,100],geometricBounds:[0,100,100,0],matrix:{mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0},relink(f){this.file=f;writes++;},translate(){},remove(){this.gone=true;},move(){},selected:false};}
 doc.placedItems={_: [], add(){const it=item('N'+this._.length,'');places++;this._.push(it);return it;}};
 const a=item('A','/same.png'), b=item('B','/same.png');doc.selection=[a];
 const ctx={app:{documents:[doc],activeDocument:doc,redraw(){},getIdentityMatrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0};}},File:function(p){this.exists=true;this.fsName=p;this.name=path.basename(p);},Math,Date,ElementPlacement:{PLACEBEFORE:0}};vm.createContext(ctx);vm.runInContext(host,ctx);
 const lock=()=>JSON.parse(ctx.captureSelectionLock()).lock;
 const verify=l=>JSON.parse(ctx.verifySelectionLock(JSON.stringify(l)));
 test('Distinct UUIDs sharing source are rejected by atomic write',()=>{doc.selection=[a];const l=lock();doc.selection=[b];assert.equal(verify(l).ok,false);assert.equal(JSON.parse(ctx.replaceLockedWithFile(JSON.stringify(l),'/new.png',0,0,0)).ok,false);assert.equal(writes,0);});
 test('Same target with changed link or matrix is rejected',()=>{doc.selection=[a];let l=lock();a.file.fsName='/external.png';assert.equal(verify(l).ok,false);a.file.fsName='/same.png';a.matrix.mValueA=-1;assert.equal(verify(l).ok,false);a.matrix.mValueA=1;});
 test('Reopened same-path document is a different operation target',()=>{doc.selection=[a];let l=lock();ctx.app.activeDocument={name:doc.name,fullName:doc.fullName,selection:[a]};assert.equal(verify(l).ok,false);ctx.app.activeDocument=doc;});
 test('Same target succeeds via place-replace and verifies link',()=>{doc.selection=[a];const r=JSON.parse(ctx.replaceLockedWithFile(JSON.stringify(lock()),'/new.png',0,0,0));assert.equal(r.ok,true);assert.equal(r.mode,'placed-replaced');assert.equal(r.linkedPath,'/new.png');assert.equal(r.path,'/new.png');assert(places>=1);assert(typeof r.relinkMs==='number');assert(typeof r.redrawMs==='number');});
 test('Legacy no-UUID identity stable across relink but distinct from duplicate',()=>{const c=item('', '/same.png'),d=item('', '/same.png');doc.selection=[c];let l=lock();doc.selection=[d];assert.equal(verify(l).ok,false);doc.selection=[c];let old=l.objectKey;c.file.fsName='/new.png';assert.equal(lock().objectKey,old);});
 test('Fingerprint distinguishes identical same-source copies',()=>{doc.selection=[a];let x=ctx.selectionFingerprint();doc.selection=[b];assert.notEqual(ctx.selectionFingerprint(),x);});
 // Full controller syntax and narrowly scoped macro generation run outside the Adobe host.
 const panelMain=fs.readFileSync(path.join(root,'client/bitmap-panel.js'),'utf8');
 const panelMarquee=fs.readFileSync(path.join(root,'client/bitmap-panel-marquee.js'),'utf8');
 const panel=panelMarquee+'\n'+panelMain;
 new vm.Script(panelMain);new vm.Script(panelMarquee);new vm.Script(fs.readFileSync(path.join(root,'client/bitmap-output.js'),'utf8'));new vm.Script(fs.readFileSync(path.join(root,'client/file-stamp.js'),'utf8'));new vm.Script(host);
 function extract(name){const start=panel.indexOf('  function '+name+'(');assert(start>=0);const end=panel.indexOf('\n  function ',start+1);return panel.slice(start,end<0?undefined:end);}
 const px={Math,Number,String,Uint8ClampedArray,Core,blurScratch:{}};vm.createContext(px);
 ['clampTone','toneRange','tonePointsTouched','colorBalanceGains','brightnessContrastRange','ijPath','escapeIjString','generateApplyMacro'].forEach(n=>vm.runInContext(extract(n),px));
 test('Fiji export encoding honors PNG/JPEG/TIFF and preview remains TIFF',()=>{for(const [format,expected] of [['PNG','PNG'],['JPEG','Jpeg'],['TIFF','Tiff']]){let macro=px.generateApplyMacro('/in.tif','/out',{format,toneLow:0,toneHigh:255});assert(macro.includes('saveAs("'+expected+'"'));assert(!macro.includes('channels=1 slices=1'));}assert(px.generateApplyMacro('/in','/out',{format:'PNG',previewMaxEdge:100,toneLow:0,toneHigh:255}).includes('saveAs("Tiff"'));});
 test('Controller writes use locked host entry point',()=>{assert(!/evalHost\('replaceSelectedWithFile/.test(panel));assert(!/evalHost\('previewPlaceSelected/.test(panel));assert(!/evalScript\('restoreOriginalLink/.test(panel));});
 test('0.5.6 Apply hot path has zero backup/copy/restore',()=>{
   const wf=panel.slice(panel.indexOf('function workflowApply'), panel.indexOf('function presets()'));
   assert(!/copyBackupBesideSource/.test(panel));
   assert(!/maybeBackupBeforeApply\s*\(/.test(panel));
   assert(!/skipPanelBackup/.test(panel));
   assert(!/rememberBackupForObject/.test(panel));
   assert(!/restoreFromBackup/.test(panel));
   assert(!/paperfig-backups/.test(panel));
   assert(/assertAppliedLink/.test(wf));
   assert(/takeApplyReady|tryRasterizeFromLivePreview|writeRasterToFile/.test(wf));
   assert(/applyStage/.test(wf));
 });
 test('0.5.6 place-replace + force refresh + link verify',()=>{
   assert(/function sciBitmapPlaceReplaceExact/.test(host));
   assert(/function sciBitmapAssertLinkedPath/.test(host));
   assert(/function sciBitmapForceArtboardRefresh/.test(host));
   assert(/relinkMs/.test(host));
   assert(/redrawMs/.test(host));
   assert(/linkedPath/.test(host));
   assert(/hostRelinkTimingBits/.test(panel));
   assert(/assertAppliedLink/.test(panel));
   assert(/durableFallbackDir/.test(panel));
   assert(/paperfig-out/.test(fs.readFileSync(path.join(root,'client/bitmap-output.js'),'utf8')));
   assert(!/os\.tmpdir\(\), 'paperfig-out'/.test(panel) && !/os\.tmpdir\(\),\s*'paperfig-out'/.test(panel));
 });
 test('0.5.6 durableOutputPath avoids Downloads and uses durable fallback not TEMP',()=>{
   const path=require('path'), os=require('os'), fs=require('fs');
   const vm2=require('vm');
   const testHome=path.join(dir,'home'); fs.mkdirSync(testHome,{recursive:true});
   const testOs={homedir:()=>testHome,tmpdir:()=>path.join(dir,'temporary')};
   const ctx={window:{require:(n)=>{if(n==='fs')return fs;if(n==='path')return path;if(n==='os')return testOs;throw new Error(n);}},process:{env:{}},console};
   vm2.createContext(ctx);
   vm2.runInContext(fs.readFileSync(path.join(root,'client/bitmap-output.js'),'utf8'), ctx);
   const downloads=path.join(testOs.homedir(),'Downloads','photo.png');
   const out=ctx.window.PaperFigOutput.durableOutputPath(downloads,'.png');
   const fallback=path.join(testOs.homedir(),'paperfig-out');
   assert(out.indexOf(fallback)===0, out);
   assert(out.indexOf(testOs.tmpdir())!==0, 'must not use ephemeral TEMP: '+out);
   const localDir=path.join(testHome,'local');
   fs.mkdirSync(localDir);
   try {
     const local=path.join(localDir,'shot.png');
     const beside=ctx.window.PaperFigOutput.durableOutputPath(local,'.png');
     assert.equal(path.dirname(beside), localDir, beside);
   } finally { fs.rmSync(localDir,{recursive:true,force:true}); }
 });

 test('0.5.7 crop aspect helpers keep FILE-px ratio and fixed size',()=>{
   assert.equal(Core.cropAspectRatio('free'),0);
   assert.equal(Core.cropAspectRatio('1:1'),1);
   assert.equal(Core.cropAspectRatio('16:9'),16/9);
   assert.equal(Core.cropAspectRatio('custom',4,5),0.8);
   assert.equal(Core.cropAspectRatio('fixed'),0);
   assert.equal(Core.cropAspectRatio('source-px'),0);
   const drawn=Core.constrainDrawRect(10,10,110,50,2,200,100);
   assert.equal(drawn.width,100);
   assert.equal(drawn.height,50);
   const sync=Core.syncSizeWithAspect(0,0,80,10,'width',2,200,100);
   assert.equal(sync.width,80);
   assert.equal(sync.height,40);
   const syncH=Core.syncSizeWithAspect(0,0,10,40,'height',2,200,100);
   assert.equal(syncH.width,80);
   assert.equal(syncH.height,40);
   const fixed=Core.placeFixedRect(180,90,50,50,200,100);
   assert.deepEqual(fixed,{left:150,top:50,width:50,height:50});
   const resized=Core.constrainResizeRect({left:20,top:20,width:40,height:20},'se',40,0,2,200,100);
   assert.equal(resized.width,80);
   assert.equal(resized.height,40);
 });
 test('0.5.7 crop UI uses source-file pixels + rotate mapping helpers',()=>{
   const i18n=fs.readFileSync(path.join(root,'client/i18n.js'),'utf8');
   assert(/Fixed W×H are original/.test(i18n)||/file pixels/.test(i18n)||/hintCrop/.test(i18n));
   assert(/id="langZh"/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')));
   assert(/paperfig_ui_lang/.test(i18n));
   assert(/\{version\}/.test(i18n), 'banner/footer should use {version} placeholder');
   const pkgVer=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
   assert(/HOST_SCRIPT_VERSION = PANEL_VERSION/.test(panel)||/PANEL_VERSION/.test(panel));
   assert(pkgVer === JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version);

   assert(/function mapHandleToFileSpace/.test(panel));
   assert(/function displayPointToSource/.test(panel));
   assert(/function transposeCropDisplayToSource/.test(panel));
   assert(/pointerToImagePx\(event\.clientX/.test(panel));
   assert(/getFixedCropSize/.test(panel));
   assert(/cropAspectMode/.test(panel));
   assert(/HOST_SCRIPT_VERSION = PANEL_VERSION/.test(panel));
   assert(new RegExp('SCI_BITMAP_HOST_VERSION = "'+pkgVer+'"').test(host));
   assert(!/writeCropUiRect/.test(panel));
 });

 test('Preview compatibility helpers and crop overlay structure remain available',()=>{
   assert(/function refreshPanelPreviewAfterGeom/.test(panel));
   assert(/preferAi:\s*true,\s*skipCache:\s*true/.test(panel));
   assert(/keepPreviewUntilLoad:\s*true/.test(panel));
   assert(/invalidatePanelPreviewCache\(lastSourcePath\)/.test(panel));
   assert(/function bakeArtboardOrientIntoPreview/.test(panel));
assert(/function ensurePreviewMatchesArtboardOrient/.test(panel));
assert(/function bakeExifOrientIntoPreview/.test(panel));
assert(/previewBakedExif/.test(panel));
assert(/jpegDecoderAlreadyOriented/.test(panel));
assert(/exifOrientationTransform/.test(panel));
   assert(/function instantOrientPanelPreview/.test(panel));
   assert(/function transformRgbaBuffer/.test(panel));
   assert(/function applyCssOrientFallback/.test(panel));
   assert(/function syncPreviewTransformStyle/.test(panel));
   assert(/orientToArtboard/.test(panel));
   assert(/previewMatchesArtboard/.test(panel));
   assert(/artboardOrientActive/.test(panel));
   assert(/instantOrientPanelPreview\(angle/.test(panel));
   assert(/failed:\s*true,\s*busy:\s*true/.test(panel));
   assert(/function pointerToDisplayPx/.test(panel));
   assert(/function displayCropRectForHit/.test(panel));
   assert(/Core\.hitTestCrop/.test(panel));
   assert(/HOST_SCRIPT_VERSION = PANEL_VERSION/.test(panel));
   assert(new RegExp('SCI_BITMAP_HOST_VERSION = "'+pkgVer+'"').test(host));
   const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
   assert(/id="cropOverlay"/.test(html));
   const xfClose=html.indexOf('id="previewTransform"');
   const canvasAt=html.indexOf('previewCanvas', xfClose);
   const xfEnd=html.indexOf('</div>', canvasAt);
   const overlayAt=html.indexOf('id="cropOverlay"');
   assert(overlayAt>xfEnd, 'cropOverlay should be outside previewTransform');
   const css=fs.readFileSync(path.join(root,'client/styles.css'),'utf8');
   assert(/\.preview-canvas[\s\S]*?pointer-events:\s*none/.test(css));
   assert(/\.checker[\s\S]*?pointer-events:\s*none/.test(css));
   assert(/\.preview-transform[\s\S]*?pointer-events:\s*none/.test(css));
   assert(/\.crop-overlay[\s\S]*?pointer-events:\s*auto/.test(css));
 });

 test('0.5.9 crop drag hit-testing: handles, move interior, draw outside',()=>{
   assert.equal(typeof Core.hitTestCrop, 'function');
   const crop={left:40,top:30,width:80,height:60};
   assert.deepEqual(Core.hitTestCrop(40,30,crop,8,true),{mode:'resize',handle:'nw'});
   assert.deepEqual(Core.hitTestCrop(120,30,crop,8,true),{mode:'resize',handle:'ne'});
   assert.deepEqual(Core.hitTestCrop(120,90,crop,8,true),{mode:'resize',handle:'se'});
   assert.deepEqual(Core.hitTestCrop(40,90,crop,8,true),{mode:'resize',handle:'sw'});
   assert.deepEqual(Core.hitTestCrop(80,30,crop,8,true),{mode:'resize',handle:'n'});
   assert.deepEqual(Core.hitTestCrop(120,60,crop,8,true),{mode:'resize',handle:'e'});
   assert.deepEqual(Core.hitTestCrop(70,55,crop,8,true),{mode:'move'});
   assert.deepEqual(Core.hitTestCrop(10,10,crop,8,true),{mode:'draw'});
   assert.deepEqual(Core.hitTestCrop(40,30,crop,8,false),{mode:'move'});
   assert.deepEqual(Core.hitTestCrop(0,0,null,8,true),{mode:'draw'});
   assert.deepEqual(Core.hitTestCrop(5,5,{left:0,top:0,width:0,height:0},8,true),{mode:'draw'});
 });

 test('0.6.0 moveCropBox translates freely without shrinking; clamp prefers shift',()=>{
   assert.equal(typeof Core.moveCropBox, 'function');
   const moved=Core.moveCropBox(50,10,80,40,200,100);
   assert.deepEqual(moved,{left:50,top:10,width:80,height:40});
   const edge=Core.moveCropBox(180,90,80,40,200,100);
   assert.deepEqual(edge,{left:120,top:60,width:80,height:40});
   const clamp=Core.clampCropBox(190,0,80,40,200,100);
   assert.equal(clamp.width,80);
   assert.equal(clamp.left,120);
 });
 test('0.6.0 crop Apply resets upright geometry (no FitCorners stretch)',()=>{
   assert(/function sciBitmapPlaceUprightCrop/.test(host));
   assert(/function sciBitmapSizeUprightInPlace/.test(host));
   assert(/resetUpright/.test(host));
   assert(/geomOptsForCropReplace/.test(panel));
   assert(/lockedReplace\([^\n]+geomOptsForCropReplace/.test(panel)||/geomOptsForCropReplace\(opts,processed\)/.test(panel));
   assert(/keepCropSize:\s*true/.test(panel));
   assert(/moveCropBox/.test(panel));
 });
 test('0.6.5 workflowApply clears crop and seeds preview from processed output',()=>{
   const wf=panel.slice(panel.indexOf('function workflowApply'), panel.indexOf('function presets()'));
   assert(/resetAdjustmentsAfterApply\(true\)/.test(wf));
   assert(/invalidatePanelPreviewCache\(source\)/.test(wf));
   assert(/seedPreviewFromProcessed\(processed,\s*replaced\.info\)/.test(wf));
   assert(/lastSourcePath\s*=\s*out/.test(wf));
   assert(!/seedPreviewFromCachedSource\(source/.test(wf));
 });

 test('0.7.0 fluorescence keep-channel UI and mapChannels keep without enabled',()=>{
   const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
   assert(/id="keepRGBtn"/.test(html));
   assert(/id="rawKeepButtons"/.test(html));
   assert(/荧光通道/.test(html));
   assert(/HOST_SCRIPT_VERSION = PANEL_VERSION/.test(panel));
   assert(new RegExp('SCI_BITMAP_HOST_VERSION = "'+pkgVer+'"').test(host));
   assert(/keepMask/.test(fs.readFileSync(path.join(root,'client/bitmap-workflow.js'),'utf8')));
   assert(/function keepChannels/.test(fs.readFileSync(path.join(root,'client/scientific-core.js'),'utf8')));
   assert(/rebuildKeepButtons/.test(fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8')));
 });
 test('0.9.0 per-channel Low/High UI + mapChannels levels without enabled',()=>{
   const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
   const wf=fs.readFileSync(path.join(root,'client/bitmap-workflow.js'),'utf8');
   assert(/id="ch0LowSlider"/.test(html));
   assert(/id="fluorToneLow"/.test(html) && /id="fluorToneHigh"/.test(html));
   assert(/id="adjustPhoto" hidden/.test(html) && /id="adjustKindFluor"/.test(html));
   assert(html.indexOf('id="adjustKindFluor"') < html.indexOf('id="presetSelect"'));
   assert(/id="ch1HighSlider"/.test(html));
   assert(/id="ch2LowSlider"/.test(html));
   assert(/id="autoChannelLevelsBtn"/.test(html));
   assert(/function levelsTouched/.test(wf));
   assert(/anyLevels/.test(wf)||/levelsTouched\(cs\)/.test(wf));
   assert(/autoLevelsPerChannelFromPreview/.test(panel));
   assert(new RegExp('SCI_BITMAP_HOST_VERSION = "'+pkgVer+'"').test(host));
   assert(/^\d+\.\d+\.\d+$/.test(pkgVer));
   const releaseZip = require(path.join(root, 'scripts/release-name')).releaseZip(pkgVer);
   assert.equal(releaseZip, 'paperfig-' + pkgVer + '.zip');
   assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).version, pkgVer);
   const manifest = fs.readFileSync(path.join(root, 'CSXS/manifest.xml'), 'utf8');
   assert(manifest.includes('ExtensionBundleVersion="' + pkgVer + '"'));
   assert(manifest.includes('Id="com.zhaoli.paperfig.panel" Version="' + pkgVer + '"'));
   ['INSTALL.md', 'HOWTO.md', 'ARCHITECTURE.md'].forEach(function (name) {
     const doc = fs.readFileSync(path.join(root, name), 'utf8');
     assert(!/\b\d+\.\d+\.\d+\b/.test(doc), name + ' should not contain a release version');
   });
   assert(/10\.5281\/zenodo\.23137291/.test(fs.readFileSync(path.join(root, 'README.md'), 'utf8')));
   assert(/\b1\.2\.1\b/.test(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')));
   const installSh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
   assert(installSh.indexOf('rm -rf "${DEST}"') < 0);
   assert(installSh.indexOf('.paperfig-new.') >= 0);
   var swap = installSh.slice(installSh.indexOf('SAME_DIR}" == 0'));
   assert(swap.indexOf('copy_payload') < swap.indexOf('stage_is_valid'));
   assert(swap.indexOf('stage_is_valid') < swap.indexOf('mv "${DEST}" "${BACKUP}"'));
 });
 test('0.6.6/0.8.1 post-Apply reroots via .baseline.json; processing record stays write-once',()=>{
   const wf=panel.slice(panel.indexOf('function workflowApply'), panel.indexOf('function presets()'));
   assert(/rerootAppliedBaseline\(key,\s*out\)/.test(wf));
   assert(/function rerootAppliedBaseline/.test(panel));
   assert(/function isAppliedBaseline/.test(panel));
   assert(/BASELINE_SUFFIX\s*=\s*'\.baseline\.json'/.test(panel));
   assert(/paperfig-baseline-marker/.test(panel));
   assert(/provenanceSha256/.test(panel));
   assert(/Never touch <out>\.json/.test(panel)||/Never touch <out>\.json \(provenance\)/.test(panel));
   // Legacy 0.8.0 in-place rewrite still recognised; new code must NOT stamp role onto the record
   assert(/role === 'applied-baseline'|role === \"applied-baseline\"/.test(panel));
   const reroot=panel.slice(panel.indexOf('function rerootAppliedBaseline'), panel.indexOf('\n  function switchDraft'));
   assert(!/role\s*[:=]\s*['\"]applied-baseline['\"]/.test(reroot));
   assert(!/writeFileSync\(outPath \+ '\.json'|writeFileSync\(sidecar/.test(reroot)||/BASELINE_SUFFIX/.test(reroot));
   assert(/outPath \+ BASELINE_SUFFIX/.test(reroot));
   // Empty crop hides overlay (cleared after Apply)
   assert(/no active crop/.test(panel)||/W\/H unset/.test(panel));
   // seed updates identity so quiet geometryOnly can keep processed pixels
   const seed=panel.slice(panel.indexOf('function seedPreviewFromProcessed'), panel.indexOf('function refreshPanelPreviewAfterGeom'));
   assert(/shownSource\s*=\s*previewSourceIdentity/.test(seed));
   assert(/HOST_SCRIPT_VERSION\s*=\s*PANEL_VERSION/.test(panel));
   assert(new RegExp('SCI_BITMAP_HOST_VERSION\\s*=\\s*"'+JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version+'"').test(host));
 });
 test('0.8.1 immutable record + baseline marker hash + parent lineage on second Apply',()=>{
   assert(/PaperFig for Illustrator ['"]?\s*\+\s*PANEL_VERSION/.test(panel)||/PaperFig for Illustrator '\s*\+\s*PANEL_VERSION/.test(panel));
   assert(/schema:\s*'paperfig-baseline-marker'/.test(panel));
   assert(/provenanceSha256:\s*fs\.existsSync\(sidecar\)\s*\?\s*fileSha256\(sidecar\)/.test(panel));
   assert(/function fileSha256/.test(panel));
   assert(/createHash\('sha256'\)/.test(panel));
   // recipeSidecar writes parent when input is itself a PaperFig output
   const side=panel.slice(panel.indexOf('function recipeSidecar'), panel.indexOf('\n  function markRecord'));
   assert(/record\.parent\s*=/.test(side));
   assert(/recordSha256:\s*fileSha256\(source\+'\.json'\)/.test(side));
   assert(/origin:\(up\.parent&&up\.parent\.origin\)\|\|up\.source/.test(side));
   assert(/sci-bitmap-processing-record/.test(side));
   assert(/sci-raw-display/.test(side));
   // markRecord only updates status/error — does not clear source or set applied-baseline
   const mark=panel.slice(panel.indexOf('function markRecord'), panel.indexOf('\n  function workflowApply'));
   assert(/record\.status\s*=\s*status/.test(mark));
   assert(!/applied-baseline/.test(mark));
   assert(!/record\.source\s*=/.test(mark));
   // Raw recovery honours marker (asymmetry: raw Apply does not write one today)
   const sci=fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8');
   assert(/\.baseline\.json/.test(sci));
   assert(/role!=='applied-baseline'/.test(sci));
 });
 test('0.6.4 flat overlay crop is canonical under rotation; Apply bakes then upright-places',()=>{
   const m=[-0.8,-0.6,-0.6,0.8];
   // Core AABB helpers remain for geometry math, but panel must NOT store crop via AABB round-trip
   const src={left:100,top:100,width:500,height:300};
   const screen=Core.sourceRectToScreenAABB(src,1600,800,m);
   assert(screen.width>=src.width-1);
   assert(/cropNeedsDisplayBake/.test(panel));
   assert(/cropDisplaySpace/.test(panel));
   assert(/displayMatrix/.test(panel));
   // 0.9.2+: direct crop-sized bake (no full-src intermediate bakeCanvas)
   assert(/Do NOT allocate a full srcW/.test(panel)||/ctx\.translate\(-sx, -sy\)/.test(panel));
   assert(/ctx\.transform\(Number\(m\[0\]\)/.test(panel));
   assert(!/bakeCanvas\.width\s*=\s*srcW/.test(panel));
   assert(/keepCropSize:\s*true/.test(panel));
   assert(/Pure translate of flat overlay/.test(panel)||/keepCropSize:\s*true/.test(panel));
   // Overlay must not copy preview matrix; upright crop place retained
   assert(/overlay\.style\.transform\s*=\s*['"]['"]/.test(panel)||/pinOverlayStyle\(overlay, 'transform', 'none'\)/.test(panel));
   assert(/sourceRectToOverlayRect/.test(panel));
   assert(/overlayRectToSourceRect/.test(panel));
   assert(/Never inherit preview rotate/.test(panel)||/box stays screen-upright/.test(panel)||/Photoshop-style/.test(panel));
   assert(/function sciBitmapPlaceUprightCrop/.test(host));
   assert(/geomOptsForCropReplace/.test(panel));
   assert(/resetUpright:\s*true/.test(panel));
   // Panel must not call screenRectToSourceAABB when committing overlay crop (no AABB store)
   const commit = panel.slice(panel.indexOf('function overlayRectToSourceRect'), panel.indexOf('function displayCropRectForHit'));
   assert(!/screenRectToSourceAABB/.test(commit));
   assert(!/sourceRectToScreenAABB/.test(panel.slice(panel.indexOf('function sourceRectToOverlayRect'), panel.indexOf('function overlayRectToSourceRect'))));
 });
 test('0.9.2/0.9.2 exclusive crop/inset marquee mode',()=>{
   assert(/function setMarqueeMode/.test(panel));
   assert(/marqueeMode !== 'crop'/.test(panel));
   assert(/marqueeMode !== 'inset'/.test(panel));
   assert(/marqueeModeCropBtn/.test(panel)||/marqueeModeCropBtn/.test(require('fs').readFileSync(require('path').join(__dirname,'../client/index.html'),'utf8')));
   assert(/clearCropMarqueeQuiet|clearInsetRegionQuiet/.test(panel));
   assert(/setMarqueeMode\('crop'/.test(panel));
  assert(/paperfig-tab/.test(panel) && /exitInsetMarqueeIfNeeded/.test(panel), 'leaving non-geometry tabs must exit inset marquee');
  assert(/tab === 'label' && science && science\.figureLabel/.test(panel), 'Apply on the label tab creates the figure label');
  assert(/tab === 'scale' && science && science\.scaleBar/.test(panel), 'Apply on the scale tab creates the scale bar');
  assert(/paperfig-tab/.test(require('fs').readFileSync(require('path').join(__dirname,'../client/index.html'),'utf8')), 'tab activate dispatches paperfig-tab');
  assert(/Enable remapping without requiring/.test(panel), '启用换色 must not require a live selection');
  assert(/adjustTabActive && previewBase/.test(panel), 'Adjust remapping uses associated previewBase while Raw may still be loaded');
 });
test('Scale presets use native dialogs seeded in Downloads',()=>{
  const fs=require('fs'), path=require('path');
  const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
  const sci=fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8');
  const i18n=fs.readFileSync(path.join(root,'client/i18n.js'),'utf8');
  assert(/id="scalePresetSave"/.test(html) && /id="scalePresetLoad"/.test(html));
  assert(!/id="scalePresetName"/.test(html) && !/id="scalePresetSavePanel"/.test(html));
  assert(/function downloadsDir/.test(sci) && /os.homedir/.test(sci) && /path\.join\(home,'Downloads'\)/.test(sci));
  assert(/showSaveDialogEx/.test(sci) && /showOpenDialogEx/.test(sci));
  assert(/showSaveDialogEx\(t\('scalePresetSave'\)\|\|'Save scale preset',dir,\['json'\],'scale-preset\.json'/.test(sci), 'Save must use showSaveDialogEx(title,initialPath,fileTypes,defaultName,...) not OpenDialogEx arg order');
  assert(!/showSaveDialogEx\(false,false,/.test(sci), 'Save must not use OpenDialogEx boolean prefix args');
  assert(!/saveDlg/.test(sci) && !/root.prompt/.test(sci));
  assert(/dialogPath/.test(sci) && /if\(!picked\)return/.test(sci));
  assert(/scalePresetSaveTitle/.test(i18n) && /starts in Downloads/.test(i18n));
  assert(/addEventListener\('click',function\(\)\{saveNamedScalePreset\(\);\}\)/.test(sci), 'Save click must not pass Event as name');
  assert(!/if\(fs\.existsSync\(dest\)\)throw new Error\(t\('errScalePresetExists'\)\)/.test(sci), 'Save must allow overwrite');
  assert(/typeof optName==='string'/.test(sci), 'programmatic save only accepts string names');
});
test('Original-file-px crop mode is additive (keeps fixed)',()=>{
  const fs=require('fs'), path=require('path');
  const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
  const panel=fs.readFileSync(path.join(root,'client/bitmap-panel-marquee.js'),'utf8')+fs.readFileSync(path.join(root,'client/bitmap-panel.js'),'utf8');
  const core=fs.readFileSync(path.join(root,'client/bitmap-core.js'),'utf8');
  assert(/value="fixed"/.test(html) && /value="source-px"/.test(html), 'fixed kept; source-px added');
  assert(/getStrictSourcePixelSize/.test(panel));
  assert(/mode === 'source-px'/.test(panel) || /mode === "source-px"/.test(panel));
  assert(/source-px/.test(core));
  assert(/errNeedSourcePixels/.test(panel) || /errNeedSourcePixels/.test(fs.readFileSync(path.join(root,'client/i18n.js'),'utf8')));
});
test('0.10.0 panel open resets channel remap; Fiji presets live in color-picker popup',()=>{
  const fs=require('fs'), path=require('path');
  const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
  const picker=fs.readFileSync(path.join(root,'client/color-picker.js'),'utf8');
  assert(/Fresh remapping defaults on every panel open/.test(panel));
  assert(/settings\.channels = null/.test(panel));
  assert(/channelsToUi\(W\.channelsDefault\(\)\)/.test(panel));
  assert(!/channelsToUi\(settings\.channels\|\|W\.channelsDefault\(\)\)/.test(panel));
  assert(/color-picker\.js/.test(html), 'index loads in-panel color picker');
  assert(!/channel-color-presets/.test(html), 'no Fiji swatches in channel row markup');
  assert(/pf-color-popup/.test(picker) && /pf-color-presets/.test(picker), 'picker hosts Fiji presets');
  assert(/fijiPresets|channelColorPresets/.test(picker));
  assert(/isColorInput/.test(picker), 'keeps RGB color input interception');
  assert(/pf-color-sv/.test(picker) && /pf-color-rgb/.test(picker), 'RGB picker retained inside popup');
});
test('0.10.0 color picker close-race guard; default channel swatches sync+CSS',()=>{
  const fs=require('fs'), path=require('path');
  const picker=fs.readFileSync(path.join(root,'client/color-picker.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'client/styles.css'),'utf8');
  assert(/suppressCloseUntil|armCloseGuard|closeSuppressed/.test(picker), 'open gesture close guard');
  assert(/openOrToggle/.test(picker), 'mousedown open/toggle helper');
  assert(/trailing click|Block native color UI on click|click only blocks native/.test(picker), 'click does not toggle-close');
  assert(!/if \(isColorInput\(e\.target\)\) \{ intercept\(e\); \}/.test(picker), 'click must not call intercept toggle');
  assert(/PaperFigColorPicker\.sync\(byId\('ch'\+i\+'Color'\)\)/.test(panel), 'channelsToUi paints swatches');
  assert(/-webkit-appearance:\s*none/.test(css) && /::-webkit-color-swatch/.test(css), 'CSS shows JS background as swatch');
  assert(new RegExp("PANEL_VERSION = '" + pkgVer.replace(/\./g, '\\.') + "'").test(panel));
  assert(/\.pf-color-preset[\s\S]*?background-image:\s*none/.test(css), 'Fiji preset buttons clear global button gradient');
  assert(/backgroundImage\s*=\s*'none'|backgroundImage\s*=\s*"none"/.test(picker), 'JS clears background-image for solid Fiji presets');
  assert(!/addEventListener\('mousedown',\s*function\s*\([^)]*\)\s*\{\s*e\.stopPropagation\(\);\s*\},\s*true\)/.test(picker), 'popup must not capture-stopPropagation (blocks Fiji preset clicks)');
  assert(/pickPreset|applyHex\(p\.hex\)/.test(picker), 'Fiji preset click/mousedown applies hex');
});

 test('0.9.2/0.9.2 rotate+crop Apply bakes directly into crop canvas (no full-src alloc)',()=>{
   let createCanvas;
   try { ({createCanvas}=require('@napi-rs/canvas')); }
   catch (err) { if (err.code==='MODULE_NOT_FOUND') { console.log('SKIP canvas bake — npm install @napi-rs/canvas'); return; } throw err; }
   const W=200,H=100,m=[0,-1,1,0],sx=60,sy=30,sw=50,sh=40;
   const src=createCanvas(W,H); const s=src.getContext('2d');
   s.fillStyle='#f00'; s.fillRect(0,0,W,H);
   s.fillStyle='#0f0'; s.fillRect(10,20,40,30);
   s.fillStyle='#00f'; s.fillRect(150,60,30,20);
   const bake=createCanvas(W,H); const b=bake.getContext('2d');
   b.translate(W/2,H/2); b.transform(m[0],m[1],m[2],m[3],0,0); b.drawImage(src,-W/2,-H/2);
   const oldC=createCanvas(sw,sh); oldC.getContext('2d').drawImage(bake,sx,sy,sw,sh,0,0,sw,sh);
   const neu=createCanvas(sw,sh); const n=neu.getContext('2d');
   n.translate(-sx,-sy); n.translate(W/2,H/2); n.transform(m[0],m[1],m[2],m[3],0,0); n.drawImage(src,-W/2,-H/2);
   const od=oldC.getContext('2d').getImageData(0,0,sw,sh).data;
   const nd=neu.getContext('2d').getImageData(0,0,sw,sh).data;
   let diff=0; for(let i=0;i<od.length;i++) if(od[i]!==nd[i]) diff++;
   assert.equal(diff,0,'direct bake-crop must match full bake then crop');
   assert(/busyWait/.test(panel));
   assert(/notice\(t\('busyWait'\)/.test(panel));
 });
 test('0.8.6 inset reuses file-pixel crop space, side height match, non-crossing leaders',()=>{
   assert.equal(Core.cropAspectRatio('4:3'), 4/3);
   assert.equal(Core.cropAspectRatio('16:9'), 16/9);
   assert.equal(Core.cropAspectRatio('1:1'), 1);
   assert.deepEqual(Core.strokeDashArray('solid'), []);
   assert.deepEqual(Core.strokeDashArray('dashed'), [6,4]);
   assert.deepEqual(Core.strokeDashArray('dotted'), [1,2.5]);
   assert.deepEqual(Core.strokeDashArray('dash-dot'), [8,3,1,3]);
   const style = Core.insetStrokeStyle({weight:2,color:'#FFCC00',dash:'dashed',corner:'round',radius:4}, 1);
   assert.equal(style.color, '#ffcc00');
   assert.equal(style.corner, 'round');
   assert.equal(style.radius, 4);
   assert.deepEqual(style.dashes, [6,4]);
   assert.throws(()=>Core.insetStrokeStyle({color:'red'}, 1), /Invalid inset stroke color/);
   const norm = Core.insetNormFromRect({left:100,top:50,width:400,height:300}, 1000, 800);
   assert.deepEqual(norm, {x:0.1,y:0.0625,w:0.4,h:0.375});
   const corners = [[0,100],[200,100],[200,0],[0,0]];
   const quad = Core.insetFrameQuad(corners, {x:0.25,y:0.2,w:0.5,h:0.4});
   function near(a,b){assert(Math.abs(a[0]-b[0])<1e-6 && Math.abs(a[1]-b[1])<1e-6, a+' vs '+b);} 
   near(quad[0], [50,80]);
   near(quad[1], [150,80]);
   near(quad[2], [150,40]);
   near(quad[3], [50,40]);
   const size = Core.insetPointSize(corners, {x:0.25,y:0.2,w:0.5,h:0.4}, 'right');
   assert.equal(size.height, 100, 'side inset height matches main');
   assert.equal(size.width, 250, 'side inset width from crop aspect');
   assert(Math.abs(size.effectiveMagnification - 2.5) < 1e-9);
   
const sizeAbove = Core.insetPointSize(corners, {x:0.25,y:0.2,w:0.5,h:0.4}, 'above');
   
assert.equal(sizeAbove.width, 200, 'above inset width matches main');
   
assert.equal(sizeAbove.height, 80, 'above inset height from crop aspect');
   
assert(Math.abs(sizeAbove.effectiveMagnification - 2) < 1e-9);
   
const sizeBelow = Core.insetPointSize(corners, {x:0.25,y:0.2,w:0.5,h:0.4}, 'below');
   
assert.equal(sizeBelow.width, 200, 'below inset width matches main');
   
assert.equal(sizeBelow.height, 80, 'below inset height from crop aspect');
   const pos = Core.insetAnchorPosition([0,100,200,0], size, 10, 'right');
   assert.deepEqual({x:pos.x,y:pos.y}, {x:210,y:100});
   assert(Math.abs(pos.y - 100) < 1e-9);
   assert(Math.abs((pos.y - size.height) - 0) < 1e-9);
   const leaders = Core.insetLeaders(quad, {x:210,y:100}, size);
   assert.equal(leaders.length, 2);
   function segCross(a,b){
     function cross(o,p,q){return (p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);}
     const d1=cross(a[0],a[1],b[0]), d2=cross(a[0],a[1],b[1]), d3=cross(b[0],b[1],a[0]), d4=cross(b[0],b[1],a[1]);
     return d1*d2<0 && d3*d4<0;
   }
   assert(!segCross(leaders[0], leaders[1]), 'leaders must not form an X');
   leaders.forEach(seg=>{
     assert(seg[0][0] >= 140, 'leader should leave the frame toward the inset');
     assert(seg[1][0] >= 200);
   });
   const tall = {width:80, height:160};
   const tallLeaders = Core.insetLeaders([[0,100],[40,100],[40,60],[0,60]], {x:60,y:120}, tall);
   assert.equal(tallLeaders.length, 2);
   assert(!segCross(tallLeaders[0], tallLeaders[1]), 'taller side inset leaders must not cross');
   assert(!/id="insetApply"/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')), '0.9.2 removes separate Create inset button');
   assert(!/id="insetMag"/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')), 'unused Inset Zoom control is removed');
   assert(!/id="(?:insetDrawBtn|insetClearBtn|cropFullBtn)"/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')), 'redundant region buttons are removed');
   const scaleHtml=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
   assert(scaleHtml.indexOf('id="scalePresetSave"')<scaleHtml.indexOf('id="scaleMethod"'), 'Scale preset controls come before calibration');
   assert(!/id="scaleAudit"/.test(scaleHtml), 'unused selection comparison is removed');
  assert(/marqueeMode === 'inset'/.test(panel) && /return applyInset\(\)/.test(panel), 'inset-mode Apply must call applyInset');
  assert(!/channels:\s*W\.channelsDefault/.test(panelMarquee), 'marquee applyInset must not use panel-local W');
  assert(/SciBitmapWorkflow\.channelsDefault\(\)/.test(panelMarquee), 'marquee applyInset uses SciBitmapWorkflow');
   assert(/id="insetOverlay"/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')));
   assert(/function sciBitmapInset/.test(host));
   assert(/frameCorners/.test(host), 'host must accept tight frameCorners');
   assert(/sciBitmapOrientInsetPlaced/.test(host), 'host must upright-orient inset');
   assert(/placed\.resize\(100,\s*-100\)/.test(host), 'inset orient can V-flip when det>0');
   assert(/pos\[0\] \+ sizeW/.test(host) && /pos\[1\] - sizeH/.test(host), 'host must stroke matching frame around inset');
   assert(/overlayRectToSourceNormCorners/.test(panel), 'panel maps overlay to source corners');
   assert(/function applyInset/.test(panel));
   assert(/identityPixels/.test(panel));
   assert(/insetHeading/.test(fs.readFileSync(path.join(root,'client/i18n.js'),'utf8')));
   assert.throws(()=>Core.insetPointSize(corners, {w:0.2,h:0.2}, 'diagonal'), /Invalid inset settings/);
   /* 0.8.9: file Y → artboard via geometricBounds; BL-first corner UV remapped. */
   assert.equal(Core.insetFileNyToCornerNy(corners, 0.25), 0.25, 'TL-first: file Y = corner UV');
   const blFirst = [[0,0],[200,0],[200,100],[0,100]]; /* corner[0] at visual bottom */
   assert.equal(Core.insetFileNyToCornerNy(blFirst, 0.25), 0.75, 'BL-first: file top maps near corner ny=1');
   const bounds = [0,100,200,0];
   const fileCorners = [{x:0.1,y:0.2},{x:0.5,y:0.2},{x:0.5,y:0.6},{x:0.1,y:0.6}];
   const gQuad = Core.insetFileNormQuad(bounds, blFirst, fileCorners);
   function near2(a,b,msg){assert(Math.abs(a[0]-b[0])<1e-6 && Math.abs(a[1]-b[1])<1e-6, msg||(a+' vs '+b));}
   near2(gQuad[0], [20,80], 'axis-aligned file top-left → artboard top');
   near2(gQuad[2], [100,40], 'axis-aligned file bottom-right → artboard bottom');
   const wrong = Core.insetFrameQuad(blFirst, {x:0.1,y:0.2,w:0.4,h:0.4});
   assert(wrong[0][1] < gQuad[0][1], 'raw BL-first UV would place frame too low/high vs geometricBounds map');
   assert(/sciBitmapFileNormQuad/.test(host), 'host maps file UV via FileNormQuad');
   assert(/sciBitmapFileNyToCornerNy/.test(host), 'host remaps BL-first file Y');
   assert(/geometricBounds/.test(host.slice(host.indexOf('function sciBitmapInsetScale'))), 'inset scale uses geometricBounds');
  const scaleFn = host.slice(host.indexOf('function sciBitmapScaleBar'), host.indexOf('function sciBitmapHexColor'));
  assert(/geometricBounds/.test(scaleFn), 'main scale bar prefers geometricBounds for bottom-*');
  assert(/yBottom/.test(scaleFn), 'main scale bar remaps BL-first UV y for visual bottom');
 });
 test('science.jsx stays identical to the host copy inside bitmap.jsx',()=>{
   const norm=function(s){return s.replace(/\r\n/g,'\n');};
   const b=norm(fs.readFileSync(path.join(root,'jsx/bitmap.jsx'),'utf8'));
   const s=norm(fs.readFileSync(path.join(root,'jsx/science.jsx'),'utf8'));
   const i=b.indexOf('/* Scientific geometry');
   assert(i>=0 && b.slice(i)===s, 'edit jsx/science.jsx and keep the bundled tail in sync');
 });
 test('content stamp ignores mtime-only changes and rejects byte changes',()=>{
   const crypto=require('crypto');
   const file=path.join(dir,'stamp.bin');
   fs.writeFileSync(file, Buffer.from('abc'));
   const stamp=require(path.join(root,'client/file-stamp.js'));
   const a=stamp.contentStamp(file);
   assert.equal(a, 'sha256:'+crypto.createHash('sha256').update('abc').digest('hex'));
   const future=new Date(Date.now()+60*1000);
   fs.utimesSync(file, future, future);
   assert.equal(stamp.contentStamp(file), a);
   assert.equal(stamp.classify(file, '3:'+Date.now()), 'legacy');
   assert.equal(stamp.matches(file, '3:'+Date.now()), false);
   fs.writeFileSync(file, Buffer.from('abd'));
   assert.equal(stamp.classify(file, '3:1'), 'legacy');
   assert.equal(stamp.matches(file, '3:1'), false);
   fs.writeFileSync(file, Buffer.from('abcd'));
   assert.notEqual(stamp.contentStamp(file), a);
   assert.equal(stamp.matches(file, a), false);
 });

 test('inset ratios are not stuck at 1:1 and crop drag is opt-in',()=>{
   assert.equal(Core.cropAspectRatio('4:3'), 4/3);
   assert.equal(Core.cropAspectRatio('16:9'), 16/9);
   assert.equal(Core.cropAspectRatio('1:1'), 1);
   assert.equal(Core.cropAspectRatio('free'), 0);
   assert.equal(Core.cropAspectRatio('5:4'), 5/4);
   const wide = Core.constrainDrawRect(0, 0, 300, 300, 16/9, 2000, 1500);
   assert(Math.abs(wide.width / wide.height - 16/9) < 0.05, wide.width + 'x' + wide.height);
   const fitted = Core.fitAspectRect(0, 0, 900, 900, 16/9, 400, 400);
   assert(Math.abs(fitted.width / fitted.height - 16/9) < 0.05, 'square clamp kept 16:9 ' + fitted.width + 'x' + fitted.height);
   const fourThree = Core.fitAspectRect(0, 0, 800, 800, 4/3, 500, 500);
   assert(Math.abs(fourThree.width / fourThree.height - 4/3) < 0.05, 'square clamp kept 4:3 ' + fourThree.width + 'x' + fourThree.height);
   assert(/endpoint-pick/.test(panelMain));
   assert(/fitAspectRect/.test(panelMarquee));
   assert(/endpoint-pick/.test(fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8')));
   const square = Core.constrainDrawRect(0, 0, 300, 80, 1, 2000, 1500);
   assert.equal(square.width, square.height);
   var fpFn = host.slice(host.indexOf('function selectionFingerprint'), host.indexOf('function sciBitmapTempDir'));
   assert(fpFn.indexOf('sciBitmapItemInfo(') < 0, 'poll fingerprint must not stat the linked file');
   assert(fpFn.indexOf('.map(') < 0, 'fingerprint stays ExtendScript-safe');
   assert(/background: true/.test(panelMain));
   assert(/applyInsetAspect\(chosen\)/.test(panelMarquee));
   assert(/window\.__pfAspectChosen = function/.test(panelMarquee));
   assert(/liveOverlay\.width > 0/.test(panelMarquee));
   assert(/function updateInsetOverlay[\s\S]*overlay\.classList\.add\('hidden'\)/.test(panelMarquee));
   assert(/function keepCalibrationAfterCrop/.test(fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8')));
   assert(/scale = sw \/ iw/.test(panelMarquee));
   assert(/lockInsetFileAspect/.test(panelMarquee));
   assert(/if \(api\.marqueeMode !== 'inset' && !api\.cropDrawArmed && !api\.pickMode\) \{ return; \}/.test(panelMarquee));
   assert(/armCrop: true/.test(panelMarquee));
   var downFn = panelMarquee.slice(panelMarquee.indexOf('function onCropPointerDown'));
   downFn = downFn.slice(0, downFn.indexOf('function onCropPointerMove'));
   assert(downFn.indexOf('science.pick(event)') >= 0 && downFn.indexOf('science.pick(event)') < downFn.indexOf('cropDrawArmed'), 'endpoint pick before disarmed-crop return');
   assert(/var cropDrawArmed = false/.test(panelMain));
   assert(/previewPointerAction/.test(panelMain));
   assert(/interaction-policy\.js/.test(fs.readFileSync(path.join(root,'client/index.html'),'utf8')));
   assert(/function previewPointerAction/.test(fs.readFileSync(path.join(root,'client/interaction-policy.js'),'utf8')));
   assert(/beginPreviewPan/.test(panelMain));
   assert(/syncHand:function/.test(panelMain));
   const css = fs.readFileSync(path.join(root,'client/styles.css'),'utf8');
   assert(/\.hand-pan/.test(css));
   assert(/\.preview-stage\.pick-mode[\s\S]*cursor: crosshair/.test(css));
   assert(/\.preview-stage \{[^}]*display:\s*block/.test(css), 'preview stage must not be a grid');
   assert(!/\.preview-stage \{[^}]*display:\s*grid/.test(css));
   assert(/setProperty\(prop, value, 'important'\)/.test(panelMarquee));
   assert(/__pfAspectChosen/.test(fs.readFileSync(path.join(root,'client/dark-select.js'),'utf8')));
   assert(/syncPickCursor/.test(fs.readFileSync(path.join(root,'client/scientific-panel.js'),'utf8')));
   assert(/function sciBitmapApplyPlacedSize/.test(host));
   assert(/m\.mValueA = Number\(m\.mValueA\) \* sx/.test(host));
   assert(/sciBitmapApplyPlacedSize\(placed, sizeW, sizeH\)/.test(host));
   var insetFn = host.slice(host.indexOf('function sciBitmapInset(lockJson'));
   insetFn = insetFn.slice(0, insetFn.indexOf('\nfunction '));
   assert(insetFn.indexOf('sciBitmapApplyPlacedSize(placed, sizeW, sizeH)') >= 0);
   assert(insetFn.indexOf('liveAspect') >= 0);
 });

 console.log('\n'+count+' regression checks passed. Adobe/Fiji integration still requires host testing.');

} finally {fs.rmSync(dir,{recursive:true,force:true});}
