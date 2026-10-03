'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert');
const {createCanvas,Image,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'paperfig-integration-'));
function makeImage(name,color){const c=createCanvas(1600,800),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1600,800);const p=path.join(out,name);fs.writeFileSync(p,c.toBuffer('image/png'));return p;}
const blobs=new Map();let blobId=0;
class BlobImage extends Image {
  set src(v){if(blobs.has(v)){blobs.get(v).arrayBuffer().then(b=>{super.src=Buffer.from(b);});}else{super.src=v;}}
  get src(){return super.src;}
}
function TestFileReader(){this.readAsArrayBuffer=blob=>{blob.arrayBuffer().then(b=>{this.result=b;this.onload();}).catch(()=>this.onerror());};}
const aPath=makeImage('a.png','#d04020'),bPath=makeImage('b.png','#2040d0');
const cls=()=>{const set=new Set();return {add(...v){v.forEach(x=>set.add(x));},remove(...v){v.forEach(x=>set.delete(x));},toggle(x,on){if(on===undefined)on=!set.has(x);if(on)set.add(x);else set.delete(x);},contains(x){return set.has(x);}};};
const els={};const callbacks={};
function element(id){if(els[id])return els[id];const e=id==='previewCanvas'?createCanvas(1,1):{};Object.assign(e,{id,value:'',checked:false,disabled:false,style:{setProperty(){}},classList:cls(),dataset:{},textContent:'',clientWidth:340,clientHeight:280,type:'',min:'',max:'',children:[],get firstChild(){return this.children[0]||null;},appendChild(c){this.children.push(c);return c;},removeChild(c){this.children.splice(this.children.indexOf(c),1);},blur(){},options:[],parentElement:{classList:cls()},setAttribute(){},getAttribute(){return null;},removeAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:340,height:280};},closest(){return this.parentElement;},addEventListener(n,f){(callbacks[id+':'+n]||(callbacks[id+':'+n]=[])).push(f);},removeEventListener(){},click(){if(!this.disabled)emit(id,'click');}});els[id]=e;return e;}
const html=fs.readFileSync(path.join(root,'client/index.html'),'utf8');
for(const m of html.matchAll(/<(input|select|button|canvas|div|output|span|p)[^>]*\bid="([^"]+)"[^>]*>/g)){const e=element(m[2]);e.type=(/type="([^"]+)"/.exec(m[0])||[])[1]||'';e.min=(/min="([^"]*)"/.exec(m[0])||[])[1]||'';e.max=(/max="([^"]*)"/.exec(m[0])||[])[1]||'';e.checked=/\bchecked\b/.test(m[0]);e.value=(/value="([^"]*)"/.exec(m[0])||[])[1]||'';}
element('format').options=['TIFF','PNG','JPEG'].map(x=>({value:x,text:x}));
function emit(id,n,event={}){for(const f of callbacks[id+':'+n]||[])f(Object.assign({preventDefault(){},target:element(id)},event));}
const storage={paperfig_ui_lang:'en'};let failWrite=false,writeDelay=0;
const fsMock=Object.assign({},fs,{writeFile(p,b,cb){setTimeout(()=>{if(failWrite){cb(new Error('simulated disk failure'));}else fs.writeFile(p,b,cb);},writeDelay);}});
const doc={name:'mock.ai',fullName:{fsName:path.join(out,'mock.ai')},selection:[]};
const allPlaced=[];function placed(id,p){const it={uuid:id,name:id,typename:'PlacedItem',embedded:false,file:{fsName:p,name:path.basename(p),exists:true,length:12},width:200,height:100,position:[0,100],geometricBounds:[0,100,200,0],matrix:{mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0},relink(f){this.file={fsName:f.fsName||f,name:path.basename(f.fsName||f),exists:true,length:12};},rotate(angle){this.matrix.mValueA=Math.cos(angle*Math.PI/180);this.matrix.mValueB=Math.sin(angle*Math.PI/180);},resize(){},remove(){/* place-replace mock keeps the same object */},move(){},selected:false,translate(){}};allPlaced.push(it);return it;}
doc.placedItems={_: [], add(){
  /* Integration mock: mutate the place-target (or selection) so test refs stay valid. */
  const target=allPlaced.find(x=>x&&x.__sciPlaceTarget)||(doc.selection&&doc.selection[0])||placed('P'+this._.length,'');
  const proxy={
    get typename(){return 'PlacedItem';},
    get uuid(){return target.uuid;},
    get name(){return target.name;},
    get embedded(){return target.embedded;},
    get file(){return target.file;},
    set file(f){target.file={fsName:f.fsName||f,name:path.basename(f.fsName||f),exists:true,length:12};},
    get width(){return target.width;}, set width(v){target.width=v;},
    get height(){return target.height;}, set height(v){target.height=v;},
    get position(){return target.position;}, set position(v){target.position=v;},
    get geometricBounds(){return target.geometricBounds;},
    get matrix(){return target.matrix;},
    get selected(){return target.selected;}, set selected(v){target.selected=v;},
    move(){}, translate(){}, remove(){},
    __target: target
  };
  this._.push(proxy); return proxy;
}};
const a=placed('A',aPath),b=placed('B',bPath),duplicate=placed('C',aPath);doc.selection=[a];
const host={app:{documents:[doc],activeDocument:doc,redraw(){},getIdentityMatrix(){return {mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0};}},File:function(p){this.fsName=p;this.name=path.basename(p);this.exists=fs.existsSync(p);this.length=fs.existsSync(p)?fs.statSync(p).size:0;},ElementPlacement:{PLACEBEFORE:0}};vm.createContext(host);vm.runInContext(fs.readFileSync(path.join(root,'jsx/bitmap.jsx'),'utf8'),host);
const Core=require(path.join(root,'client/bitmap-core.js'));
let init,errors=[];const nodeRequire=m=>m==='fs'?fsMock:m==='os'?{tmpdir:()=>out,homedir:()=>out}:require(m);
const ctx={console,Image:BlobImage,Blob,FileReader:TestFileReader,Uint8ClampedArray,Float32Array,Buffer,Promise,Date,Math,Number,String,Object,Array,JSON,isFinite,parseFloat,parseInt,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}},SystemPath:{EXTENSION:'ext'},CSInterface:function(){this.getSystemPath=()=>root;this.evalScript=(s,cb)=>{setTimeout(()=>{try{cb(String(vm.runInContext(s,host)));}catch(e){errors.push(e.message);cb('EvalScript error.');}},0);}},document:{getElementById:element,querySelector(sel){if(String(sel).indexOf('[data-tab].active')>=0)return {getAttribute(){return 'adjust';}};return null;},createElement(t){return t==='canvas'?createCanvas(1,1):element('new-'+Math.random());},querySelectorAll(){return Object.values(els).filter(x=>x.type||x.id==='format'||x.id==='lut');},addEventListener(n,f){if(n==='DOMContentLoaded')init=f;}},window:{URL:{createObjectURL(blob){const id='blob:test-'+(++blobId);blobs.set(id,blob);return id;},revokeObjectURL(id){blobs.delete(id);}},require:nodeRequire,SciBitmapCore:Core,SciBitmapWorkflow:require(path.join(root,'client/bitmap-workflow.js')),SciBitmapFiji:{},requestAnimationFrame:f=>setTimeout(f,0),addEventListener(){},removeEventListener(){}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'client/i18n.js'),'utf8'),ctx);ctx.PaperFigI18n=ctx.window.PaperFigI18n;if(ctx.PaperFigI18n){ctx.PaperFigI18n.setVersion(require(path.join(root,'package.json')).version);ctx.PaperFigI18n.setLang('en');}
['file-stamp.js','bitmap-output.js','interaction-policy.js','bitmap-panel-marquee.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(root,'client',f),'utf8'),ctx));
let source=fs.readFileSync(path.join(root,'client/bitmap-panel.js'),'utf8');
source=source.replace("  document.addEventListener('DOMContentLoaded', init);",`  window.__test={prepareBatch:prepareBatch,runBatch:runBatch,stopBatch:function(){batchStop=true;},batch:function(){return batchReview;},currentRecipe:currentRecipe,loadWorkflowImage:loadWorkflowImage,inspectSelection:inspectSelection,applyPipeline:applyPipeline,runArtboardPreview:runArtboardPreview,cancelArtboardPreview:cancelArtboardPreview,renderPreviewCanvas:renderPreviewCanvas,samplePreviewNeighborhood:samplePreviewNeighborhood,stop:function(){clearInterval(pollTimer);},clearDrafts:function(){drafts={};draftKey='';draftPath='';},state:function(){return {previewBase:previewBase,previewBaseDrag:previewBaseDrag,lastObjectKey:lastObjectKey,applyRunning:applyRunning,artboardPreviewRunning:artboardPreviewRunning,artboardPreviewActive:artboardPreviewActive,original:artboardPreviewOriginalPath,file:artboardPreviewFile,cache:panelPreviewCacheBytes,sourceImageSize:sourceImageSize};}};\n  document.addEventListener('DOMContentLoaded', init);`);
vm.runInContext(source,ctx);const api=ctx.window.__test;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10);}throw new Error('Timed out; notice='+element('notice').textContent+'; preview='+element('previewStatus').textContent+'; message='+element('previewMessage').textContent+'; errors='+JSON.stringify(errors)+'; state='+JSON.stringify(api.state(),(k,v)=>k==='data'?'pixels':v));}
let n=0;async function test(name,f){await f();n++;console.log('PASS '+name);}
(async()=>{
init();element('format').value='PNG';await sleep(100);await api.inspectSelection({quiet:false});await waitFor(()=>api.state().previewBase);api.stop();
await test('Initial PNG load builds 800px and 400px buffers',async()=>{assert.equal(api.state().previewBase.width,800);assert.equal(api.state().previewBaseDrag.width,400);});
await test('A → B → cached A restores BOTH pixel buffers',async()=>{doc.selection=[b];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase?.data[2]>100);doc.selection=[a];await api.inspectSelection({quiet:true});assert(api.state().previewBase.data[0]>100);assert(api.state().previewBaseDrag.data[0]>100);assert(api.state().previewBaseDrag.data[2]<100);});
await test('Preset saves and restores only image adjustments',async()=>{element('presetName').value='Microscopy A';element('brightness').value=20;emit('savePresetBtn','click');element('brightness').value=0;emit('loadPresetBtn','click');assert.equal(element('brightness').value,20);assert(!storage.sci_bitmap_presets_v1.includes('crop'));});
await test('PNG Apply writes immutable record + baseline marker; UI resets; second Apply adds parent lineage',async()=>{
 const crypto=require('crypto');
 api.applyPipeline();await waitFor(()=>!api.state().applyRunning);
 const out1=a.file.fsName;assert.notEqual(out1,aPath);
 assert.equal(Number(element('brightness').value),0); // post-Apply baseline reset
 const rec1=JSON.parse(fs.readFileSync(out1+'.json','utf8'));
 assert.equal(rec1.status,'applied');assert.equal(rec1.role,'display-derivative');
 assert.equal(rec1.source,aPath);assert.equal(rec1.recipe.brightness,20);
 assert.equal(rec1.output,out1);assert(!rec1.parent);
 const marker=JSON.parse(fs.readFileSync(out1+'.baseline.json','utf8'));
 assert.equal(marker.schema,'paperfig-baseline-marker');assert.equal(marker.path,out1);
 assert.equal(marker.provenance,out1+'.json');
 assert.equal(marker.provenanceSha256,crypto.createHash('sha256').update(fs.readFileSync(out1+'.json')).digest('hex'));
 const recBytes=fs.readFileSync(out1+'.json'); // immutable after applied
 const first=await pixel(out1);
 api.applyPipeline();await waitFor(()=>!api.state().applyRunning);
 assert.deepEqual(fs.readFileSync(out1+'.json'),recBytes); // first record untouched
 assert.deepEqual(await pixel(a.file.fsName),first); // identity on baseline, no accumulation
 const out2=a.file.fsName;assert.notEqual(out2,out1);
 const rec2=JSON.parse(fs.readFileSync(out2+'.json','utf8'));
 assert.equal(rec2.status,'applied');assert.equal(rec2.source,out1);
 assert(rec2.parent);assert.equal(rec2.parent.path,out1);
 assert.equal(rec2.parent.record,out1+'.json');
 assert.equal(rec2.parent.recordSha256,marker.provenanceSha256);
 assert.equal(rec2.parent.source,aPath);assert.equal(rec2.parent.origin,aPath);
 assert(fs.existsSync(out2+'.baseline.json'));
});
await test('Crop output dimensions and original source remain intact',async()=>{element('cropLeft').value=10;element('cropTop').value=20;element('cropWidth').value=300;element('cropHeight').value=200;api.applyPipeline();await waitFor(()=>!api.state().applyRunning);const im=await loadImage(fs.readFileSync(a.file.fsName));assert.equal(im.width,300);assert.equal(im.height,200);assert(fs.existsSync(aPath));});
await test('Artboard preview A; select B; Cancel cannot modify B',async()=>{api.runArtboardPreview({auto:false});await waitFor(()=>!api.state().artboardPreviewRunning);assert(api.state().artboardPreviewActive);const aPreview=a.file.fsName;doc.selection=[b];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);assert(!api.state().artboardPreviewActive);const before=b.file.fsName;await api.cancelArtboardPreview();assert.equal(b.file.fsName,before);assert.equal(a.file.fsName,aPreview);});
await test('Returning to A recovers preview; Cancel restores source and retains Undo file',async()=>{doc.selection=[a];await api.inspectSelection({quiet:true});assert(api.state().artboardPreviewActive);const original=api.state().original,preview=api.state().file;await api.cancelArtboardPreview();assert.equal(a.file.fsName,original);assert(fs.existsSync(preview));});
await test('Changing to another object during Apply aborts relink',async()=>{doc.selection=[b];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase?.data[2]>100);const before=b.file.fsName;writeDelay=100;api.applyPipeline();await sleep(40);doc.selection=[duplicate];await waitFor(()=>!api.state().applyRunning);writeDelay=0;assert.equal(b.file.fsName,before);assert.equal(duplicate.file.fsName,aPath);assert(/Target changed|Selection changed since preview/.test(element('notice').textContent));});
await test('Write failure leaves original object unchanged and unlocks controls',async()=>{doc.selection=[b];await api.inspectSelection({quiet:true});const before=b.file.fsName;failWrite=true;api.applyPipeline();await waitFor(()=>!api.state().applyRunning);failWrite=false;assert.equal(b.file.fsName,before);assert(!element('applyBtn').disabled);assert(/disk failure/.test(element('notice').textContent));});
await test('JPEG option produces actual JPEG bytes',async()=>{element('format').value='JPEG';api.applyPipeline();await waitFor(()=>!api.state().applyRunning);assert.equal(fs.readFileSync(b.file.fsName).subarray(0,2).toString('hex'),'ffd8');});
await test('Cancel failure retains recovery record and preview bytes',async()=>{
 doc.selection=[b];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);
 api.runArtboardPreview({auto:false});await waitFor(()=>!api.state().artboardPreviewRunning);
 const original=api.state().original,preview=api.state().file,key=api.state().lastObjectKey;
 fs.renameSync(original,original+'.held');
 try {assert.equal(await api.cancelArtboardPreview(),false);assert.equal(b.file.fsName,preview);assert(fs.existsSync(preview));assert(JSON.parse(storage.sci_bitmap_preview_by_object)[key]);}
 finally{fs.renameSync(original+'.held',original);}
 assert.equal(await api.cancelArtboardPreview(),true);assert.equal(b.file.fsName,original);
});
await test('Numeric fields synchronize sliders, clamp bounds and reject blank values',async()=>{
 emit('resetBtn','click');element('brightnessValue').value='17';emit('brightnessValue','change');assert.equal(Number(element('brightness').value),17);
 element('brightnessValue').value='300';emit('brightnessValue','change');assert.equal(Number(element('brightness').value),100);
 element('brightnessValue').value='';emit('brightnessValue','change');assert.equal(Number(element('brightnessValue').value),100);
 element('toneLowValue').value='10';emit('toneLowValue','change');assert(element('brightnessValue').disabled);emit('resetBtn','click');
});
await test('Preset overwrite/delete and Repeat last keep geometry separate',async()=>{
 element('presetName').value='Second';element('brightness').value=11;emit('savePresetBtn','click');
 element('brightness').value=23;emit('updatePresetBtn','click');element('brightness').value=0;emit('loadPresetBtn','click');assert.equal(Number(element('brightness').value),23);
 element('cropLeft').value=7;emit('repeatLastBtn','click');assert.equal(Number(element('cropLeft').value),7);
 emit('deletePresetBtn','click');assert.equal(JSON.parse(storage.sci_bitmap_presets_v1).presets.length,1);emit('resetBtn','click');
});
await test('TIFF Apply exports merged RGB even while solo preview is selected',async()=>{
 // Re-root selection on original PNG (prior JPEG Apply left b on a baseline derivative).
 b.file={fsName:bPath,name:'b.png',exists:true,length:fs.statSync(bPath).size};b.matrix={mValueA:1,mValueB:0,mValueC:0,mValueD:1,mValueTX:0,mValueTY:0};
 try{const map=JSON.parse(storage.sci_bitmap_recipes_v1||'{}');Object.keys(map).forEach(k=>{if(String(k).includes(b.uuid)||(map[k]&&(map[k].originalPath||'').includes('b')))delete map[k];});storage.sci_bitmap_recipes_v1=JSON.stringify(map);}catch(ignore){}
 doc.selection=[b];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);emit('resetBtn','click');
 element('format').value='TIFF';element('dpi').value=450;emit('magentaGreenBtn','click');element('channelView').value='blue';emit('channelView','change');
 await api.applyPipeline();assert(/\.tif$/.test(b.file.fsName));
 const out1=b.file.fsName;
 const sharp=require('sharp'),meta=await sharp(out1).metadata(),im=await sharp(out1).raw().toBuffer();assert.equal(meta.density,450);assert.deepEqual([...im.subarray(0,2)],[32,64]);assert.equal(im[3],255);assert(Math.abs(im[2]-240)<=1); // canvas encode path may quantize B by 1
 const record1=JSON.parse(fs.readFileSync(out1+'.json','utf8'));
 assert.equal(record1.status,'applied');assert.equal(record1.source,bPath);
 assert.equal(record1.recipe.channels.components[2].color,'#0000ff');
 assert.equal(JSON.parse(fs.readFileSync(out1+'.baseline.json','utf8')).schema,'paperfig-baseline-marker');
 const first=fs.readFileSync(out1);const recBytes=fs.readFileSync(out1+'.json');
 await api.applyPipeline();assert.deepEqual(fs.readFileSync(b.file.fsName),first);
 assert.deepEqual(fs.readFileSync(out1+'.json'),recBytes); // immutable
 const record2=JSON.parse(fs.readFileSync(b.file.fsName+'.json','utf8'));
 assert.equal(record2.source,out1);assert.equal(record2.parent.origin,bPath);
});
await test('Batch uses frozen recipe on reviewed objects, independent of current selection',async()=>{
 const d=placed('D',aPath),e=placed('E',aPath);doc.selection=[d,e];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase&&!api.state().applyRunning);emit('resetBtn','click');element('format').value='PNG';element('brightness').value=10;
 await api.prepareBatch();assert.equal(api.batch().rows.filter(r=>r.valid).length,2);element('brightness').value=70;doc.selection=[duplicate];
 await api.runBatch();assert.notEqual(d.file.fsName,aPath);assert.notEqual(e.file.fsName,aPath);assert.notEqual(d.file.fsName,e.file.fsName);assert.deepEqual(await pixel(d.file.fsName),await pixel(e.file.fsName));assert.equal(duplicate.file.fsName,aPath);
 assert.equal(JSON.parse(fs.readFileSync(d.file.fsName+'.json','utf8')).recipe.brightness,10);assert(/2\/2 applied/.test(element('footerStatus').textContent), element('footerStatus').textContent);
});
await test('Batch changed geometry fails only that target; next target still succeeds',async()=>{
 const d=placed('F',aPath),e=placed('G',aPath);doc.selection=[d,e];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);emit('resetBtn','click');await api.prepareBatch();d.matrix.mValueTX=9;
 await api.runBatch();assert.equal(d.file.fsName,aPath);assert.notEqual(e.file.fsName,aPath);assert(/1\/2 applied/.test(element('footerStatus').textContent), element('footerStatus').textContent);
});
await test('Batch cancel before commit leaves all source objects untouched',async()=>{
 const d=placed('H',aPath),e=placed('I',aPath);doc.selection=[d,e];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);await api.prepareBatch();writeDelay=100;const running=api.runBatch();await sleep(20);api.stopBatch();await running;writeDelay=0;
 assert.equal(d.file.fsName,aPath);assert.equal(e.file.fsName,aPath);assert(/0\/2 applied/.test(element('footerStatus').textContent), element('footerStatus').textContent);assert(!element('applyBtn').disabled);
});
await test('Batch excludes unsupported 16-bit TIFF with a visible reason',async()=>{
 const p=path.join(out,'raw16.tif');await require('sharp')({create:{width:20,height:20,channels:3,background:'#555555'}}).toColourspace('grey16').tiff({compression:'lzw'}).toFile(p);
 doc.selection=[placed('J',aPath),placed('K',p)];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);await api.prepareBatch();const rows=api.batch().rows;assert(rows[0].valid);assert(!rows[1].valid);assert(/high-bit-depth/.test(rows[1].status),rows[1].status);assert(rows[1].check.disabled);
});

await test('Compressed TIFF takes verified Fiji decode bridge, caches full resolution and applies same RGB math',async()=>{
 const sharp=require('sharp'),p=path.join(out,'merged-compressed.tif');await sharp({create:{width:32,height:24,channels:3,background:'#642850'}}).tiff({compression:'lzw'}).toFile(p);
 let decodes=0;ctx.window.SciBitmapFiji.runMacro=async function(exe,macro){const text=fs.readFileSync(macro,'utf8');assert(text.includes('c*z*t!=1'));assert(text.includes('bitDepth!=24'));assert(!text.includes('run("Size"'));const src=/open\("([^"\n]+)"\)/.exec(text)[1],dest=/saveAs\("PNG", "([^"\n]+)"\)/.exec(text)[1];await sharp(src).png().toFile(dest);decodes++;return {stdout:'SCI_RGB_DECODE_OK',stderr:''};};
 element('fijiPath').value='/mock/Fiji';emit('fijiPath','change');const target=placed('L',p);doc.selection=[target];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase&&api.state().previewBase.width===32);emit('resetBtn','click');emit('magentaGreenBtn','click');element('format').value='TIFF';await api.applyPipeline();
 assert.equal(decodes,1);const im=await sharp(target.file.fsName).raw().toBuffer();assert.deepEqual([...im.subarray(0,4)],[100,40,180,255]);const meta=await sharp(target.file.fsName).metadata();assert.equal(meta.width,32);assert.equal(meta.height,24);
});
await test('Baseline marker blocks sidecar remap; removing marker recovers recipe from write-once record',async()=>{
 const item=doc.selection[0],outPath=item.file.fsName;
 assert(fs.existsSync(outPath+'.json'));assert(fs.existsSync(outPath+'.baseline.json'));
 const rec=JSON.parse(fs.readFileSync(outPath+'.json','utf8'));
 assert.equal(rec.status,'applied');assert.equal(rec.role,'display-derivative');assert(rec.source&&rec.source!==outPath);
 // With marker: panel treats file as baseline — do not restore old recipe/crop
 delete storage.sci_bitmap_recipes_v1;doc.selection=[duplicate];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);
 doc.selection=[item];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase&&api.state().previewBase.width===32);
 assert(!element('channelsEnabled').checked);
 // Delete marker only: write-once record remains; recovery remaps to original source+recipe
 fs.unlinkSync(outPath+'.baseline.json');
 delete storage.sci_bitmap_recipes_v1;api.clearDrafts();
 doc.selection=[duplicate];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase);
 doc.selection=[item];await api.inspectSelection({quiet:true});await waitFor(()=>api.state().previewBase&&api.state().previewBase.width===32);
 assert(element('channelsEnabled').checked);
 const first=fs.readFileSync(outPath);await api.applyPipeline();assert.deepEqual(fs.readFileSync(item.file.fsName),first);
});

await test('Blob decoder revokes transient URLs; decode cache may keep ≤2',async()=>{await sleep(150);assert(blobs.size<=2,'leaked blobs='+blobs.size);});
assert.deepEqual(errors,[]);console.log('\n'+n+' integration simulations passed (real Canvas pixels; mocked Adobe host).');
api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(0);
})().catch(e=>{console.error(e);api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(1);});
async function pixel(p){const im=await loadImage(fs.readFileSync(p));const c=createCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);}
