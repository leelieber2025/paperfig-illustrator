'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert');
const {createCanvas,Image,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'paperfig-integration-'));
function makeImage(name,color,width=1600,height=800){const c=createCanvas(width,height),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,width,height);const p=path.join(out,name);fs.writeFileSync(p,c.toBuffer('image/png'));return p;}
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
const storage={paperfig_ui_lang:'en',paperfig_show_raw_v1:'1'};let failWrite=false,writeDelay=0;
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
const ctx={console,Image:BlobImage,Blob,FileReader:TestFileReader,Uint8ClampedArray,Float32Array,Buffer,Promise,Date,Math,Number,String,Object,Array,JSON,isFinite,parseFloat,parseInt,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:k=>storage[k]==null?null:storage[k],setItem:(k,v)=>{storage[k]=v;},removeItem:k=>{delete storage[k];}},SystemPath:{EXTENSION:'ext'},CSInterface:function(){this.getSystemPath=()=>root;this.evalScript=(s,cb)=>{setTimeout(()=>{try{cb(String(vm.runInContext(s,host)));}catch(e){errors.push(e.message);cb('EvalScript error.');}},0);}},document:{getElementById:element,querySelector(sel){if(String(sel).indexOf('[data-tab].active')>=0)return {getAttribute(){return 'adjust';}};return null;},createElement(t){return t==='canvas'?createCanvas(1,1):element('new-'+Math.random());},querySelectorAll(){return Object.values(els).filter(x=>x.type||x.id==='format'||x.id==='lut');},addEventListener(n,f){if(n==='DOMContentLoaded')init=f;}},window:{URL:{createObjectURL(blob){const id='blob:test-'+(++blobId);blobs.set(id,blob);return id;},revokeObjectURL(id){blobs.delete(id);}},require:nodeRequire,SciBitmapCore:Core,SciBitmapWorkflow:require(path.join(root,'client/bitmap-workflow.js')),SciBitmapFiji:{},requestAnimationFrame:f=>setTimeout(f,0),addEventListener(){},removeEventListener(){},confirm(){return true;}}};
vm.createContext(ctx);ctx.window.SciScientific=require(path.join(root,'client/scientific-core.js'));['file-stamp.js','i18n.js','raw-bridge.js','histogram-view.js','interaction-policy.js','scientific-panel.js','bitmap-output.js','bitmap-panel-marquee.js'].forEach(f=>vm.runInContext((f==='scientific-panel.js'?fs.readFileSync(path.join(root,'client',f),'utf8').replace('init();return {active:active','init();return {revealScalePresetsFolder:revealScalePresetsFolder,active:active'):fs.readFileSync(path.join(root,'client',f),'utf8')),ctx));ctx.PaperFigI18n=ctx.window.PaperFigI18n;if(ctx.PaperFigI18n){ctx.PaperFigI18n.setVersion(require(path.join(root,'package.json')).version);ctx.PaperFigI18n.setLang('en');}
let source=fs.readFileSync(path.join(root,'client/bitmap-panel.js'),'utf8');
source=source.replace("  document.addEventListener('DOMContentLoaded', init);",`  window.__test={science:function(){return science;},insetScaleSpec:function(w){return installMarquee().buildInsetScaleSpec(w);},writeCrop:writeCropRect,crop:readCropRect,prepareBatch:prepareBatch,runBatch:runBatch,stopBatch:function(){batchStop=true;},batch:function(){return batchReview;},currentRecipe:currentRecipe,loadWorkflowImage:loadWorkflowImage,inspectSelection:inspectSelection,applyPipeline:applyPipeline,runArtboardPreview:runArtboardPreview,cancelArtboardPreview:cancelArtboardPreview,renderPreviewCanvas:renderPreviewCanvas,samplePreviewNeighborhood:samplePreviewNeighborhood,stop:function(){clearInterval(pollTimer);},state:function(){return {previewBase:previewBase,previewBaseDrag:previewBaseDrag,lastObjectKey:lastObjectKey,applyRunning:applyRunning,artboardPreviewRunning:artboardPreviewRunning,artboardPreviewActive:artboardPreviewActive,original:artboardPreviewOriginalPath,file:artboardPreviewFile,cache:panelPreviewCacheBytes,sourceImageSize:sourceImageSize};}};\n  document.addEventListener('DOMContentLoaded', init);`);
vm.runInContext(source,ctx);const api=ctx.window.__test;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<300;i++){if(fn())return;await sleep(10);}throw new Error('Timed out; notice='+element('notice').textContent+'; preview='+element('previewStatus').textContent+'; message='+element('previewMessage').textContent+'; errors='+JSON.stringify(errors)+'; state='+JSON.stringify(api.state(),(k,v)=>k==='data'?'pixels':v));}
let n=0;async function test(name,f){await f();n++;console.log('PASS '+name);}
(async()=>{
init();element('format').value='PNG';await sleep(100);await api.inspectSelection({quiet:false});await waitFor(()=>api.state().previewBase);api.stop();
await test('Initial PNG load builds 800px and 400px buffers',async()=>{assert.equal(api.state().previewBase.width,800);assert.equal(api.state().previewBaseDrag.width,400);});
const fixture=require('./raw-fixture'),rawPath=path.join(out,'raw.ome.tif');fs.writeFileSync(rawPath,fixture());
await test('Raw channel load builds full precision histogram and source preview',async()=>{
 element('rawSource').value=rawPath;element('rawSeries').value=0;element('rawZ').value=0;element('rawT').value=0;
 await api.science().load(JSON.parse(host.inspectSelectedBitmaps()).items[0],rawPath,{series:0,z:0,t:0});
 assert(api.science().active());storage.paperfig_show_raw_v1='0';assert.equal(api.science().active(),false);storage.paperfig_show_raw_v1='1';assert.equal(api.science().active(),true);assert.equal(api.science().state().dataset.bits,16);assert.equal(api.science().state().dataset.histograms[0][65535],1);assert.equal(api.state().sourceImageSize.width,4);
});
await test('Raw Apply exports a display derivative with gamma/plane/statistics log; repeated Apply is stable',async()=>{
 element('format').value='TIFF';await api.applyPipeline();assert.notEqual(a.file.fsName,aPath);let rec=JSON.parse(fs.readFileSync(a.file.fsName+'.json','utf8'));assert.equal(rec.role,'display-derivative');assert.equal(rec.status,'applied');assert.equal(rec.source,rawPath);assert.equal(rec.bits,16);assert.equal(rec.nonlinear.gamma,1);assert.equal(rec.statistics[0].sensorMaximum,1);let bytes=fs.readFileSync(a.file.fsName);await api.applyPipeline();assert.deepEqual(fs.readFileSync(a.file.fsName),bytes);assert(api.science().active());
});
await test('Metadata calibration uses physical µm/px and records the source identity',async()=>{
 element('scaleMethod').value='metadata';api.science().calibrate();const cal=JSON.parse(storage.sci_calibrations_v1)[api.state().lastObjectKey];assert.equal(cal.umPerPixelX,0.25);assert.equal(cal.umPerPixelY,0.5);assert.equal(cal.source,rawPath);
});
await test('Raw group batch fixes recipe, processes distinct linked objects and retains original source',async()=>{
 api.science().lock();const d=placed('RAW-D',rawPath),e=placed('RAW-E',rawPath);doc.selection=[a,d,e];await api.inspectSelection({quiet:true});await api.prepareBatch();assert(api.science().hasBatch());assert.equal(api.science().state().batch.rows.filter(r=>r.valid).length,3);await api.runBatch();assert.notEqual(d.file.fsName,rawPath);assert.notEqual(e.file.fsName,rawPath);assert(fs.existsSync(rawPath));const r1=JSON.parse(fs.readFileSync(d.file.fsName+'.json','utf8')),r2=JSON.parse(fs.readFileSync(e.file.fsName+'.json','utf8'));assert.deepEqual(r1.recipe,r2.recipe);assert.equal(r1.status,'applied');assert(/3\/3 applied/.test(element('footerStatus').textContent), element('footerStatus').textContent);
});
await test('Changed raw source is rejected before replacement',async()=>{
 // Batch clears dataset; wait until raw is active again before mutating stamp.
 doc.selection=[a];await api.inspectSelection({quiet:true});
 await waitFor(()=>api.science().active()&&!api.state().applyRunning);
 const before=a.file.fsName;const original=fs.readFileSync(rawPath);
 fs.appendFileSync(rawPath,Buffer.from([0]));
 await api.applyPipeline();
 assert.equal(a.file.fsName,before);
 assert(/source changed/i.test(element('notice').textContent));
 fs.writeFileSync(rawPath,original);
});
await test('Per-image calibration persists, restores UI on re-select, and does not leak to another image',async()=>{
 element('scaleMethod').value='two-point';element('scaleReference').value='40';element('scaleUnit').value='um';
 // simulate saved two-point for object A
 const keyA=api.state().lastObjectKey;
 const cal={version:1,method:'two-point',umPerPixelX:0.2,umPerPixelY:null,input:{method:'two-point',unit:'um',length:40,points:[{x:10,y:5},{x:210,y:5}]},source:rawPath,sourceStamp:require('fs').statSync(rawPath).mtimeMs+'|'+require('fs').statSync(rawPath).size,sourcePixels:{width:4,height:2},objectKey:keyA,createdAt:new Date().toISOString()};
 const map=JSON.parse(storage.sci_calibrations_v1||'{}');map[keyA]=cal;storage.sci_calibrations_v1=JSON.stringify(map);storage.sci_calibration_last_v1=JSON.stringify(cal);
 api.science().onSelection(JSON.parse(host.inspectSelectedBitmaps()).items[0]);
 assert.equal(element('scaleMethod').value,'two-point');
 assert.equal(Number(element('scaleReference').value),40);
 assert(/Calibrated|已标定/.test(element('scaleStatus').textContent));
 // switch to another placed item without calibration
 doc.selection=[b];await api.inspectSelection({quiet:true});
 api.science().onSelection(JSON.parse(host.inspectSelectedBitmaps()).items[0]);
 assert(!/Calibrated · two-point|已标定 · two-point/.test(element('scaleStatus').textContent)||!storage.sci_calibrations_v1.includes('"'+api.state().lastObjectKey+'"'));
 assert.equal(element('scaleMethod').value,'two-point'); // default for uncalibrated image
 // migrate old→new key (Apply place-replace)
 const migrated=api.science().migrateCalibration(keyA,'doc|uuid:NEW');
 assert(migrated);assert.equal(JSON.parse(storage.sci_calibrations_v1)['doc|uuid:NEW'].umPerPixelX,0.2);
 // optional reuse last onto B (size mismatch vs 4×2 raw needs confirm; mock returns true)
 doc.selection=[b];await api.inspectSelection({quiet:true});
 api.science().reuseLastCalibration();
 const reused=JSON.parse(storage.sci_calibrations_v1)[api.state().lastObjectKey];
 assert(reused,'reuseLastCalibration must persist under current objectKey');
 assert.equal(reused.umPerPixelX,0.2);
 assert.equal(reused.originSourcePixels&&reused.originSourcePixels.width,4);
 assert.equal(reused.sourcePixels.width,1600);
});
await test('Crop change keeps per-image calibration (full-source umPerPixel)',async()=>{
 doc.selection=[a];await api.inspectSelection({quiet:true});
 const key=api.state().lastObjectKey;
 const seeded={version:1,method:'field',umPerPixelX:0.125,umPerPixelY:null,coordSpace:'full-source',input:{method:'field',unit:'um',width:200,pixelsX:1600,pixelsY:800,coordSpace:'full-source'},source:rawPath,sourceStamp:require('fs').statSync(rawPath).size+':'+require('fs').statSync(rawPath).mtimeMs,sourcePixels:{width:1600,height:800},objectKey:key,createdAt:new Date().toISOString()};
 const map=JSON.parse(storage.sci_calibrations_v1||'{}');map[key]=seeded;storage.sci_calibrations_v1=JSON.stringify(map);
 api.science().onSelection(JSON.parse(host.inspectSelectedBitmaps()).items[0]);
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[key].umPerPixelX,0.125);
 api.writeCrop(10,10,100,80);
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[key].umPerPixelX,0.125);
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[key].coordSpace,'full-source');
 api.writeCrop(0,0,0,0);
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[key].umPerPixelX,0.125);
 assert(/full-source|Calibrated|已标定|全图源/.test(element('scaleStatus').textContent));
});
await test('Named scale file preset saves calibration+style and applies to another image',async()=>{
 doc.selection=[a];await api.inspectSelection({quiet:true});
 const keyA=api.state().lastObjectKey;
 const cal={version:1,method:'field',umPerPixelX:0.5,umPerPixelY:null,coordSpace:'full-source',input:{method:'field',unit:'um',width:100,pixelsX:200,pixelsY:100,coordSpace:'full-source'},source:rawPath,sourceStamp:require('fs').statSync(rawPath).size+':'+require('fs').statSync(rawPath).mtimeMs,sourcePixels:{width:4,height:2},objectKey:keyA,createdAt:new Date().toISOString()};
 const map=JSON.parse(storage.sci_calibrations_v1||'{}');map[keyA]=cal;storage.sci_calibrations_v1=JSON.stringify(map);
 element('scaleLength').value='25';element('scaleUnit').value='um';element('scaleBarUnit').value='nm';element('scaleLine').value='2';element('scaleFont').value='11';element('scaleMargin').value='6';element('scalePosition').value='bottom-left';element('scaleColor').value='#00ff00';if(element('scaleIncludeText'))element('scaleIncludeText').checked=false;
 api.science().onSelection(JSON.parse(host.inspectSelectedBitmaps()).items[0]);
 api.science().saveNamedScalePreset('MicroscopeX-40x');
 const dir=api.science().scalePresetsDir();
 const presetPath=require('path').join(dir,'MicroscopeX-40x.json');
 assert(require('fs').existsSync(presetPath));
 const saved=JSON.parse(require('fs').readFileSync(presetPath,'utf8'));
 assert.equal(saved.schema,'sci-scale-preset');
 assert.equal(saved.name,'MicroscopeX-40x');
 assert.equal(saved.calibration.umPerPixelX,0.5);assert.equal(saved.style.length,25);assert.equal(saved.style.unit,'nm');assert.equal(saved.style.position,'bottom-left');assert.equal(saved.style.includeText,false);
 // other image: load saved file (programmatic path = same as file picker Load)
 doc.selection=[b];await api.inspectSelection({quiet:true});
 api.science().onSelection(JSON.parse(host.inspectSelectedBitmaps()).items[0]);
 element('scaleLength').value='99';element('scalePosition').value='bottom-right';
 api.science().loadScalePresetFile(presetPath);
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[api.state().lastObjectKey].umPerPixelX,0.5);
 assert.equal(Number(element('scaleLength').value),25);assert.equal(element('scaleBarUnit').value,'nm');
 assert.equal(element('scalePosition').value,'bottom-left');
 assert.equal(element('scaleColor').value,'#00ff00');
 if(element('scaleIncludeText'))assert.equal(element('scaleIncludeText').checked,false);
 assert.equal(element('scaleLoadedPreset').hidden,false);
 assert(/MicroscopeX-40x/.test(element('scaleLoadedPreset').textContent));
 assert.equal(JSON.parse(storage.sci_calibrations_v1)[api.state().lastObjectKey].presetName,'MicroscopeX-40x');
 api.science().clearCalibration();
 assert.equal(element('scaleLoadedPreset').hidden,true);
 api.science().deleteNamedScalePreset('MicroscopeX-40x');
 assert(!require('fs').existsSync(presetPath));
});
await test('Raw batch record failure after relink remains applied and is recoverable',async()=>{
 const target=placed('RAW-RECORD-FAIL',rawPath);doc.selection=[target];await api.inspectSelection({quiet:true});
 element('rawSource').value=rawPath;element('rawSeries').value=0;element('rawZ').value=0;element('rawT').value=0;
 await api.science().load(JSON.parse(host.inspectSelectedBitmaps()).items[0],rawPath,{series:0,z:0,t:0});
 api.science().lock();await api.prepareBatch();
 const writer=ctx.window.PaperFigOutput.writeJsonAtomic;
 ctx.window.PaperFigOutput.writeJsonAtomic=(p,rec)=>{if(rec.schema==='sci-raw-display'&&rec.status==='applied')throw new Error('raw final record failure');return writer(p,rec);};
 try{await api.runBatch();assert.notEqual(target.file.fsName,rawPath);assert(/1\/1 applied/.test(element('footerStatus').textContent));const pending=JSON.parse(storage.paperfig_raw_record_recovery_v1);assert(pending.some(x=>x.output===target.file.fsName&&x.rec.status==='applied'));}
 finally{ctx.window.PaperFigOutput.writeJsonAtomic=writer;}
});
await test('Scale shows each selected file’s detected pixel size',async()=>{
 const small=placed('SIZE-SMALL',makeImage('size-small.png','#112233',320,240));
 const large=placed('SIZE-LARGE',makeImage('size-large.png','#445566',640,360));
 element('scaleBarUnit').value='nm';doc.selection=[small];await api.inspectSelection({quiet:true});assert.equal(element('scaleSourcePixels').textContent,'320 × 240 px');assert.equal(element('scaleMethod').value,'two-point');assert.equal(element('scaleBarUnit').value,'nm');
 doc.selection=[large];await api.inspectSelection({quiet:true});assert.equal(element('scaleSourcePixels').textContent,'640 × 360 px');
 assert(!/id=\"scaleFieldWidth\"/.test(html));
});
await test('Inset scale uses its own line, margin, color, and text setting',async()=>{
 const item=doc.selection[0],key=api.state().lastObjectKey,map=JSON.parse(storage.sci_calibrations_v1||'{}');
 map[key]={umPerPixelX:0.1,objectKey:key};storage.sci_calibrations_v1=JSON.stringify(map);
 element('insetScaleOn').checked=true;element('insetScaleLength').value=10;element('insetScaleUnit').value='um';
 element('insetScaleLine').value=2.5;element('insetScaleMargin').value=7;element('insetScaleColor').value='#000000';element('insetScaleIncludeText').checked=false;
 const spec=api.insetScaleSpec(640);assert.equal(spec.lineWidth,2.5);assert.equal(spec.margin,7);assert.equal(spec.color,'#000000');assert.equal(spec.includeText,false);assert(Math.abs(spec.fraction-0.15625)<1e-8);
});
await test('Staining label fields persist and join label style presets',async()=>{
 element('figureStainText1').value='TUBB3';element('figureStainColor1').value='#ff0000';element('figureStainText2').value='TX';element('figureStainColor2').value='#00ff00';element('figureStainText3').value='RUNX2';element('figureStainColor3').value='#ffffff';
 element('figureStainFont').value='Arial';element('figureStainStyle').value='bold';element('figureStainSize').value=12;element('figureStainPosition').value='top-left';element('figureStainMargin').value=-4;element('figureStainVerticalOffset').value=6;emit('figureStainText1','change');
 const prefs=JSON.parse(storage.paperfig_figure_label_prefs_v1);assert.deepEqual(prefs.stains.map(x=>x.text),['TUBB3','TX','RUNX2']);assert.equal(prefs.stainStyle,'bold');assert.equal(prefs.stainSize,12);assert.equal(prefs.stainMargin,-4);
 element('figureLabelPresetName').value='Stains';emit('figureLabelPresetSave','click');const preset=JSON.parse(storage.paperfig_figure_label_presets_v1).Stains;assert.equal(preset.text,undefined);assert.equal(preset.stains[2].text,'RUNX2');assert.equal(preset.stainPosition,'top-left');
});
await test('Scale folder opener passes a special-character path as one argument',async()=>{
 const originalRequire=ctx.window.require,home=path.join(out,'home " ; $(touch ignored)');fs.mkdirSync(home,{recursive:true});let call;
 ctx.window.require=m=>m==='os'?{homedir:()=>home,platform:()=>'linux',tmpdir:()=>out}:m==='child_process'?{spawn:(cmd,args,opts)=>{call={cmd,args,opts};return {on(){}};}}:originalRequire(m);
 try{api.science().revealScalePresetsFolder();assert.equal(call.cmd,'xdg-open');assert.equal(call.args.length,1);assert.equal(call.args[0],path.join(home,'paperfig','scales'));assert.equal(fs.existsSync(path.join(out,'ignored')),false);}
 finally{ctx.window.require=originalRequire;}
});
assert.deepEqual(errors,[]);console.log('\n'+n+' integration simulations passed (real Canvas pixels; mocked Adobe host).');
api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(0);
})().catch(e=>{console.error(e);api.stop();fs.rmSync(out,{recursive:true,force:true});process.exit(1);});
async function pixel(p){const im=await loadImage(fs.readFileSync(p));const c=createCanvas(im.width,im.height);c.getContext('2d').drawImage(im,0,0);return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);}
