/* Scientific workflow controller, separated from legacy RGB panel. See LICENSE. */
(function(root){'use strict';
var batchPromise=null;root.SciScientificPanel={create:function(a){
 var S=root.SciScientific,fs=root.require('fs'),path=root.require('path'),$=a.byId,bridge=root.SciRawBridge.create(a.extensionPath,a.fiji,a.requireFiji),dataset=null,owner='',source='',stamp='',boundDisplay='',previewEdge=800,rows=[],locked=null,batch=null,stop=false,picking=false,points=[],framePending=false;
 function syncPickCursor(on){var st=$('previewStage');if(st){st.classList.toggle('endpoint-pick',!!on);st.classList.toggle('pick-mode',!!on);if(on)st.classList.remove('hand-pan');}if(a.syncHand)a.syncHand();}
 var KEY='sci_raw_bindings_v1',CAL='sci_calibrations_v1',LAST_CAL='sci_calibration_last_v1',GLOBAL_SCALE='sci_scale_global_v1',SCALE_PRESET_SCHEMA='sci-scale-preset',pickKey='',calUiKey='';
 function t(key,vars){try{if(root.PaperFigI18n&&typeof root.PaperFigI18n.t==='function')return root.PaperFigI18n.t(key,vars);}catch(ignore){}return key;}
 function map(key){try{return JSON.parse(localStorage.getItem(key)||'{}');}catch(e){return {};}}
 function store(key,v){localStorage.setItem(key,JSON.stringify(v));}
 function cloneCal(rec){try{return JSON.parse(JSON.stringify(rec));}catch(e){return rec;}}
 function lookupCalibration(item){
  var k=item&&item.objectKey?item.objectKey:key(),m=map(CAL),rec,p,side,i,keys;
  if(!k)return null;
  if(m[k]){if(clearedMark(m[k]))return null;return m[k];}
  try{p=item&&item.sourcePath;if(p&&fs.existsSync(p+'.json')&&fs.statSync(p+'.json').size<2097152){side=JSON.parse(fs.readFileSync(p+'.json','utf8'));if(side&&side.calibration&&side.calibration.umPerPixelX){rec=cloneCal(side.calibration);rec.objectKey=k;m[k]=rec;store(CAL,m);return rec;}}}catch(ignore){}
  return null;
 }
 function saveCalibrationRecord(rec,objectKey){
  var m=map(CAL),k=objectKey||key();if(!k)throw new Error(t('errSelectBeforeCal'));
  rec=cloneCal(rec);rec.objectKey=k;m[k]=rec;store(CAL,m);
  try{localStorage.setItem(LAST_CAL,JSON.stringify(rec));}catch(ignore){}
  return rec;
 }
 function migrateCalibration(oldKey,newKey){
  var m,rec;if(!oldKey||!newKey||oldKey===newKey)return null;m=map(CAL);if(m[newKey])return m[newKey];
  if(!m[oldKey])return null;rec=cloneCal(m[oldKey]);rec.objectKey=newKey;m[newKey]=rec;store(CAL,m);return rec;
 }
 function clearCalibrationUiFields(){
  /* Do not copy another image's endpoints/µm into an uncalibrated selection. Bar style stays sticky. */
  points=[];if(picking)return;
  $('scaleMethod').value='two-point';$('scaleReference').value=20;$('scaleUnit').value='um';
 }
 function restoreCalibrationUi(rec,objectKey){
  var input;if(picking)return;if(!objectKey){calUiKey='';return;}
  if(calUiKey===objectKey)return;calUiKey=objectKey;
  if(!rec){clearCalibrationUiFields();return;}
  input=rec.input||{};$('scaleMethod').value=(rec.method==='metadata'||rec.method==='two-point')?rec.method:'two-point';
  if(input.unit)$('scaleUnit').value=input.unit;
  if(input.length!=null&&input.length!=='')$('scaleReference').value=input.length;
  /* Endpoints stay in full-source file px (not crop-relative). Crop changes do not remap. */
  if(input.points&&input.points.length===2){points=[{x:Number(input.points[0].x),y:Number(input.points[0].y)},{x:Number(input.points[1].x),y:Number(input.points[1].y)}];}
  else{points=[];}
 }
 function key(){var i=a.info();return i?i.objectKey:'';}
 function rawFeatureEnabled(){try{return localStorage.getItem('paperfig_show_raw_v1')==='1';}catch(ignore){return false;}}
 function active(){return !!(rawFeatureEnabled()&&dataset&&owner===key());}
 function fileStamp(p,fresh){return root.PaperFigFileStamp.contentStamp(p,fresh);}
 function stampOk(p,stored){return root.PaperFigFileStamp.matches(p,stored);}
 function clearedMark(rec){return !!(rec&&rec.cleared===true);}
 function plane(){var p={series:Number($('rawSeries').value),z:Number($('rawZ').value),t:Number($('rawT').value)};Object.keys(p).forEach(function(k){if(!isFinite(p[k])||p[k]<0||p[k]%1)throw new Error(t('errSeriesZT'));});return p;}
 function infoBinding(item){if(!item)return null;var b=map(KEY)[item.objectKey];if(b&&b.disabled&&b.displayPath===item.sourcePath)return null;if(b&&b.displayPath===item.sourcePath)return b;
  try{var p=item.sourcePath+'.json';if(fs.existsSync(p)&&fs.statSync(p).size<2097152){var rec=JSON.parse(fs.readFileSync(p,'utf8'));if(rec.schema==='sci-raw-display'&&rec.status==='applied'&&rec.role!=='applied-baseline'&&!fs.existsSync(item.sourcePath+'.baseline.json')&&rec.output===item.sourcePath)return {source:rec.source,stamp:rec.sourceStamp,plane:rec.plane,recipe:rec.recipe,displayPath:item.sourcePath};}}catch(ignore){}return null;
 }
 function saveBinding(item,raw,st,p,r){var m=map(KEY);m[item.objectKey]={source:raw,stamp:st,plane:p,recipe:r,displayPath:item.sourcePath};store(KEY,m);}
 function current(){if(!active())throw new Error(t('errLoadRawFirst'));var r={channels:rows.map(function(row,i){return {name:dataset.names[i],low:Number(row.low.value),high:Number(row.high.value),visible:row.show.checked,color:row.color.value};}),gamma:Number($('rawGamma').value)};return S.recipe(dataset,r);}
 function readRange(){if($('rawSource').value.trim()!==source||Number($('rawSeries').value)!==dataset.series||Number($('rawZ').value)!==dataset.z||Number($('rawT').value)!==dataset.t)throw new Error(t('errSourcePlaneChanged'));var r=current();if(locked){S.recipe(dataset,locked.recipe);return S.clone(locked.recipe);}return r;}
 function status(text){$('rawStatus').textContent=text;}
 function error(e){a.notice(e.message||String(e),'error');}
 function setSelect(el,items){el.textContent='';items.forEach(function(it){var o=document.createElement('option');o.value=String(it[0]);o.textContent=it[1];el.appendChild(o);});el.value='-1';}
 function schedule(){if(framePending)return;framePending=true;root.requestAnimationFrame(function(){framePending=false;try{renderPanel();}catch(e){error(e);}});}
 function applyKeepMask(mask){if(!active()||locked)return;rows.forEach(function(row,i){row.show.checked=mask[i]===true;});schedule();}
 function rebuildKeepButtons(){var box=$('rawKeepButtons');if(!box||!dataset)return;box.textContent='';var n=dataset.names.length,labels=dataset.names;
  function add(label,mask,title){var b=document.createElement('button');b.type='button';b.textContent=label;if(title)b.title=title;b.addEventListener('click',function(){applyKeepMask(mask);});box.appendChild(b);}
  add(t('keepAllBtn'),labels.map(function(){return true;}),'Keep all channels');
  var lim=Math.min(3,n);
  if(lim>=1)add(t('keepOnly',{name:labels[0]}),[true].concat(labels.slice(1).map(function(){return false;})),'Keep '+labels[0]+' only');
  if(lim>=2){add(labels[0]+'+'+labels[1],labels.map(function(_,i){return i===0||i===1;}),'Keep '+labels[0]+'+'+labels[1]);
   if(lim>=3){add(labels[0]+'+'+labels[2],labels.map(function(_,i){return i===0||i===2;}),'Keep '+labels[0]+'+'+labels[2]);
    add(labels[1]+'+'+labels[2],labels.map(function(_,i){return i===1||i===2;}),'Keep '+labels[1]+'+'+labels[2]);
    add(t('keepOnly',{name:labels[1]}),labels.map(function(_,i){return i===1;}),'Keep '+labels[1]);
    add(t('keepOnly',{name:labels[2]}),labels.map(function(_,i){return i===2;}),'Keep '+labels[2]);}
   else add(t('keepOnly',{name:labels[1]}),labels.map(function(_,i){return i===1;}),'Keep '+labels[1]);}
  var hint=$('rawKeepHint');if(hint)hint.textContent=n<=3?t('rawKeepHintShort',{labels:labels.join(' / ')}):t('rawKeepHintMany',{n:n,labels:labels.slice(0,3).join('/')});
 }
 function renderRows(recipe){var list=$('rawChannels');list.textContent='';rows=[];var max=Math.pow(2,dataset.bits)-1;
  recipe.channels.forEach(function(c,i){var div=document.createElement('div');div.className='raw-row';var inputs=document.createElement('div');inputs.className='raw-inputs';var row={};function input(type,value){var e=document.createElement('input');e.type=type;if(type==='checkbox')e.checked=value;else e.value=value;inputs.appendChild(e);return e;}
   row.show=input('checkbox',c.visible);row.show.setAttribute('aria-label',t('keepAria',{name:c.name}));row.show.title=t('keepAria',{name:c.name});var name=document.createElement('span');name.textContent=c.name+(i<3?'':'');inputs.appendChild(name);row.color=input('color',c.color);row.low=input('number',c.low);row.high=input('number',c.high);[row.low,row.high].forEach(function(e){e.min=0;e.max=max;e.step=1;});div.appendChild(inputs);
   if(window.PaperFigColorPicker&&window.PaperFigColorPicker.sync){window.PaperFigColorPicker.sync(row.color);}
   row.lowSlider=document.createElement('input');row.lowSlider.type='range';row.lowSlider.min=0;row.lowSlider.max=max;row.lowSlider.value=c.low;row.lowSlider.setAttribute('aria-label',c.name+' low');div.appendChild(row.lowSlider);
   row.highSlider=document.createElement('input');row.highSlider.type='range';row.highSlider.min=0;row.highSlider.max=max;row.highSlider.value=c.high;row.highSlider.setAttribute('aria-label',c.name+' high');div.appendChild(row.highSlider);
   row.hist=document.createElement('canvas');row.hist.width=288;row.hist.height=66;div.appendChild(row.hist);row.stats=document.createElement('p');div.appendChild(row.stats);list.appendChild(div);rows.push(row);
   [row.show,row.color,row.low,row.high].forEach(function(e){e.addEventListener('change',function(){row.lowSlider.value=row.low.value;row.highSlider.value=row.high.value;schedule();});});
   [['low',row.lowSlider],['high',row.highSlider]].forEach(function(pair){pair[1].addEventListener('input',function(){row[pair[0]].value=this.value;previewEdge=400;schedule();});pair[1].addEventListener('change',function(){previewEdge=800;schedule();});});
  });$('rawGamma').value=recipe.gamma;setSelect($('rawSolo'),[[-1,t('merged')]].concat(dataset.names.map(function(n,i){return [i,t('mergedGray',{name:n})];})));rebuildKeepButtons();updateBusy();
 }
 function paint(d){var canvas=$('previewCanvas'),ctx=canvas.getContext('2d');canvas.width=d.width;canvas.height=d.height;var im=ctx.createImageData(d.width,d.height);im.data.set(d.data);ctx.putImageData(im,0,0);a.rawPreview(d,dataset);}
 function renderPanel(){if(!active())return false;var r=readRange(),stats=S.statistics(dataset,r);paint(S.render(dataset,r,{maxEdge:previewEdge,solo:Number($('rawSolo').value)}));stats.forEach(function(st,i){root.SciHistogram.draw(rows[i].hist,dataset.histograms[i],r.channels[i].low,r.channels[i].high);rows[i].stats.textContent=t('belowAboveStats',{below:st.belowPercent.toFixed(3),above:st.abovePercent.toFixed(3),atLow:st.atLow,atHigh:st.atHigh,max:st.sensorMaximum});});return true;}
 function load(item,raw,p,saved,expectedStamp){if(a.busy())return Promise.resolve(false);if(!item||!item.linked||item.typename!=='PlacedItem'){error(new Error(t('errSelectLinked')));return Promise.resolve(false);}if(a.isPreview(item)){error(new Error(t('errCancelPreviewRaw')));return Promise.resolve(false);}var target=item.objectKey;var sourceStamp;try{sourceStamp=fileStamp(raw);if(expectedStamp&&root.PaperFigFileStamp.classify(raw,expectedStamp)==='legacy'){if(!confirmCalReuse(t('confirmSourceStamp'))){error(new Error(t('sourceNeedsConfirm')));return Promise.resolve(false);}return root.PaperFigFileStamp.contentStampAsync(raw,function(info){status(t('progressRead',{pct:info.pct}));}).then(function(upgraded){return load(item,raw,p,saved,upgraded);});}if(expectedStamp&&!stampOk(raw,expectedStamp))throw new Error(t('errRawSourceChangedSaved'));}catch(e){error(e);return Promise.resolve(false);}a.setBusy(true);status(t('rawLoading'));
  return bridge.load(raw,p).then(function(d){if(fileStamp(raw,true)!==sourceStamp)throw new Error(t('errRawSourceChangedReading'));if(key()!==target)throw new Error(t('errSelectionChangedRaw'));dataset=d;owner=target;source=raw;stamp=sourceStamp;boundDisplay=item.sourcePath;var r=S.recipe(d,locked?locked.recipe:saved);renderRows(r);$('rawSource').value=raw;$('rawSeries').value=p.series;$('rawZ').value=p.z;$('rawT').value=p.t;saveBinding(item,source,stamp,p,r);status(d.reader+' · '+d.width+'×'+d.height+' · uint'+d.bits+' · C '+d.names.length+' / Z '+d.sizeZ+' / T '+d.sizeT+' / series '+d.seriesCount+' · one plane, no projection');setSourcePixelSize(d);renderPanel();updateCalibrationStatus();if(d.physical&&d.physical.x){a.notice(t('spatialMeta',{detail:d.physical.x+' µm/px'+(d.physical.y!=null?' · Y '+d.physical.y+' µm/px':'')}));}return true;
  }).catch(function(e){dataset=null;owner='';status(t('rawLoadFailed',{msg:e.message}));error(e);return false;}).then(function(ok){a.setBusy(false);updateBusy();return ok;});
 }
 function loadClick(){try{var item=a.info(),raw=$('rawSource').value.trim()||(item&&item.sourcePath);if(!raw)throw new Error(t('errChooseOriginal'));return load(item,raw,plane());}catch(e){error(e);}}
 function maybeLoad(item){if(!rawFeatureEnabled())return false;var b=infoBinding(item);if(!b)return false;if(active()&&b.source===source)return true;load(item,b.source,b.plane,b.recipe,b.stamp);return true;}
 function onSelection(item){
  setSourcePixelSize(null);
  if(dataset&&(!item||item.objectKey!==owner||item.sourcePath!==boundDisplay)){dataset=null;owner='';rows=[];$('rawChannels').textContent='';if($('rawKeepButtons'))$('rawKeepButtons').textContent='';$('rawSource').value='';status(t('rawNeedLoad'));if($('rawKeepHint'))$('rawKeepHint').textContent=t('rawKeepHint');}
  /* Endpoint picking is independent of raw load; only cancel when the object changes. */
  /* Only a real switch to another object cancels endpoint pick. A quiet poll with a missing key must not. */
  if(window.PaperFigInteraction.shouldCancelEndpointPick(picking,item,pickKey)){picking=false;points=[];pickKey='';syncPickCursor(false);}
  if(!item||item.objectKey!==calUiKey){calUiKey='';}
  updateCalibrationStatus();
 }
 function canvas(im){var c=document.createElement('canvas');c.width=im.width;c.height=im.height;var x=c.getContext('2d'),d=x.createImageData(im.width,im.height);d.data.set(im.data);x.putImageData(d,0,0);return c;}
 function record(d,r,raw,st,out,item,p,crop){return {schema:'sci-raw-display',version:1,software:'PaperFig for Illustrator '+((root.PaperFigI18n&&root.PaperFigI18n.getVersion&&root.PaperFigI18n.getVersion())||'1.2.3'),role:'display-derivative',createdAt:new Date().toISOString(),source:raw,sourceStamp:st,output:out,objectKey:item.objectKey,plane:p,width:d.width,height:d.height,bits:d.bits,channelNames:d.names,physicalMicrometers:d.physical,recipe:S.clone(r),crop:crop,compositeClipping:r.outputClipping||null,statistics:S.statistics(d,r),statisticsRegion:'entire selected source plane, before crop',calibration:lookupCalibration(item)||null,nonlinear:{gamma:r.gamma,formula:'pow(clip((I-low)/(high-low),0,1),1/gamma)',clahe:false,spatialFilters:false},status:'prepared'};}
 function writeRecord(out,rec){var dest=out+'.json';if(root.PaperFigOutput&&root.PaperFigOutput.writeJsonAtomic){root.PaperFigOutput.writeJsonAtomic(dest,rec);return;}var partial=dest+'.partial';fs.writeFileSync(partial,JSON.stringify(rec,null,2),'utf8');fs.renameSync(partial,dest);}
 var RECORD_RECOVERY='paperfig_raw_record_recovery_v1';
 function recoveryList(){try{var raw=localStorage.getItem(RECORD_RECOVERY);var list=raw?JSON.parse(raw):[];return Array.isArray(list)?list:[];}catch(e){return [];}}
 function storeRecovery(list){try{localStorage.setItem(RECORD_RECOVERY,JSON.stringify(list));}catch(ignore){}}
 function rememberRecordRecovery(output,rec,phase){var list=recoveryList().filter(function(item){return item.output!==output;});list.push({output:output,phase:phase,rec:rec,at:new Date().toISOString()});storeRecovery(list);}
 function clearRecordRecovery(output){storeRecovery(recoveryList().filter(function(item){return item.output!==output;}));}
 function recoverPendingRecords(){var left=[];recoveryList().forEach(function(item){if(!item||!item.output||!item.rec)return;try{writeRecord(item.output,item.rec);a.notice(t('recordRecovered',{path:item.output+'.json'}));}catch(e){left.push(item);}});storeRecovery(left);}
 function apply(){if(!active())return false;if(a.busy()){a.notice(t('busyWait'));return true;}var d=dataset,r,output,rec,item=a.info(),crop,p={series:d.series,z:d.z,t:d.t},raw=source,st=stamp;
  try{r=readRange();crop=a.crop(d.width,d.height);}catch(e){error(e);return true;}
  a.setBusy(true);a.notice(t('rawRendering'),'busy');
  return root.PaperFigFileStamp.contentStampAsync(raw,function(info){a.notice(t('progressRead',{pct:info.pct}),'busy');}).then(function(now){if(now!==st)throw new Error(t('errRawSourceChangedReload'));return a.capture();}).then(function(lock){if(a.count()>1)throw new Error(t('errUseBatch'));if(lock.objectKey!==item.objectKey)throw new Error(t('errTargetChanged'));output=a.output(raw);a.notice(t('progressProcess',{pct:0}),'busy');return S.renderAsync(d,r,{crop:crop},function(info){a.notice(t('progressProcess',{pct:info.pct}),'busy');});}).then(function(im){r.outputClipping={pixels:im.compositeClipped,percent:im.compositeClippedPercent};a.notice(t('progressWrite'),'busy');return a.write(canvas(im),output);}).then(function(){rec=record(d,r,raw,st,output,item,p,crop);rec.status='image-written';rec.imageWritten=true;try{writeRecord(output,rec);}catch(writeErr){rememberRecordRecovery(output,rec,'image-written');throw new Error(t('recordSaveFailed',{msg:writeErr.message}));}return a.replace(output);}).then(function(replaced){if(a.assertLink)a.assertLink(replaced,output);saveBinding(replaced.info,raw,st,p,r);migrateCalibration(item.objectKey,replaced.info.objectKey);owner=replaced.info.objectKey;boundDisplay=replaced.info.sourcePath;if(rec){rec.objectKey=replaced.info.objectKey;rec.calibration=map(CAL)[replaced.info.objectKey]||rec.calibration||null;rec.imageReplaced=true;}rec.status='applied';try{writeRecord(output,rec);clearRecordRecovery(output);}catch(writeErr){rememberRecordRecovery(output,rec,'image-replaced');a.notice(t('imageReplacedRecordFailed',{msg:writeErr.message}),'error');}(a.appliedStatus||a.notice)(t('appliedRawDisplay',{path:output}));return a.refresh();}).catch(function(e){if(rec&&rec.imageReplaced){rememberRecordRecovery(output,rec,'image-replaced');a.notice(t('imageReplacedRecordFailed',{msg:e.message}),'error');}else if(rec&&rec.status!=='applied'){rec.status='not-applied';try{writeRecord(output,rec);}catch(ignore){if(rec.imageWritten)rememberRecordRecovery(output,rec,'image-written');}error(e);}else error(e);}).then(function(){a.setBusy(false);updateBusy();});
 }
 function prepareBatch(){if(!active())return false;if(a.busy())return true;if(!locked){error(new Error(t('errLockBeforeBatch')));return true;}var r=readRange(),p={series:dataset.series,z:dataset.z,t:dataset.t};a.setBusy(true);stop=false;batch={raw:true,rows:[],recipe:S.clone(r),plane:p,format:a.format(),dpi:a.dpi()};$('batchList').textContent='';$('cancelBatchBtn').disabled=false;
  return a.host('captureBitmapBatch()').then(function(result){batch.token=result.token;var chain=Promise.resolve();result.items.forEach(function(item,index){var row={item:item,index:index,valid:false},div=document.createElement('div');div.className='batch-item';row.check=document.createElement('input');row.check.type='checkbox';row.check.disabled=true;row.thumb=document.createElement('canvas');row.label=document.createElement('span');div.appendChild(row.check);div.appendChild(row.thumb);div.appendChild(row.label);$('batchList').appendChild(div);batch.rows.push(row);row.label.textContent=(item.name||'Image')+' · '+t('rawBatchChecking');chain=chain.then(function(){if(stop){row.label.textContent+=' · '+t('rawBatchCancelled');return;}return Promise.resolve().then(function(){if(!item.linked)throw new Error(t('errRawBatchLinked'));if(a.isPreview(item))throw new Error(t('errCancelPreviewFirst'));var b=infoBinding(item);row.source=b?b.source:item.sourcePath;row.stamp=fileStamp(row.source);if(b&&b.stamp!==row.stamp)throw new Error(t('errOriginalRawChanged'));return bridge.load(row.source,p);}).then(function(d){S.recipe(d,r);row.valid=true;row.check.checked=true;var im=S.render(d,r,{maxEdge:48}),c=canvas(im);row.thumb.width=c.width;row.thumb.height=c.height;row.thumb.getContext('2d').drawImage(c,0,0);row.label.textContent=(item.name||path.basename(row.source))+' · '+t('rawBatchReadyRow',{bits:d.bits,n:d.names.length});}).catch(function(e){row.label.textContent=(item.name||'Image')+' · '+t('rawBatchSkipped',{msg:(root.PaperFigI18n&&root.PaperFigI18n.localizeError?root.PaperFigI18n.localizeError(e.message):e.message)});});});});return chain;}).then(function(){$('batchSummary').textContent=t('rawBatchSummary');a.notice(t('rawBatchReady'));}).catch(error).then(function(){a.setBusy(false);updateBusy();});
 }
 function runBatch(){
  if(!batch)return false;
  if(a.busy())return true;
  var review=batch,selected=review.rows.filter(function(row){return row.valid&&row.check.checked;}),report={schema:'sci-raw-batch',role:'display-derivative',recipe:review.recipe,plane:review.plane,results:[],skipped:review.rows.filter(function(r){return !r.valid||!r.check.checked;}).map(function(r){return {source:r.item.sourcePath,reason:r.label.textContent};})},reportPath;
  if(!selected.length){a.notice(t('errCheckOneRaw'));return true;}
  try{reportPath=a.output(selected[0].source)+'.batch.json';fs.writeFileSync(reportPath,JSON.stringify(report,null,2));}catch(e){error(e);return true;}
  a.setBusy(true);stop=false;$('cancelBatchBtn').disabled=false;
  var chain=Promise.resolve();
  selected.forEach(function(row){
   chain=chain.then(function(){
    var out,rec,replaced=false,warnings=[];
    if(stop){report.results.push({source:row.source,status:'cancelled'});return;}
    row.label.textContent=t('rawBatchProcessing',{name:path.basename(row.source)});
    return Promise.resolve().then(function(){
     if(fileStamp(row.source,true)!==row.stamp)throw new Error(t('errSourceChangedReview'));
     return bridge.load(row.source,review.plane);
    }).then(function(d){
     S.recipe(d,review.recipe);out=a.output(row.source,review.format);
     rec=record(d,review.recipe,row.source,row.stamp,out,row.item,review.plane,{left:0,top:0,width:d.width,height:d.height});
     var rendered=S.render(d,review.recipe);
     rec.compositeClipping={pixels:rendered.compositeClipped,percent:rendered.compositeClippedPercent};
     return a.write(canvas(rendered),out,review.dpi);
    }).then(function(){
     if(stop)throw new Error(t('errCancelledCommit'));
     if(fileStamp(row.source,true)!==row.stamp)throw new Error(t('errSourceChangedProcessing'));
     writeRecord(out,rec);
     return a.host('replaceBatchBitmap('+JSON.stringify(review.token)+','+row.index+','+JSON.stringify(out)+')');
    }).then(function(result){
     if(a.assertLink)a.assertLink(result,out);
     replaced=true;
     rec.objectKey=result.info.objectKey;
     rec.status='applied';
     try{writeRecord(out,rec);clearRecordRecovery(out);}catch(writeErr){rememberRecordRecovery(out,rec,'image-replaced');warnings.push(writeErr.message);}
     try{saveBinding(result.info,row.source,row.stamp,review.plane,review.recipe);}catch(bindingErr){warnings.push(bindingErr.message);}
     row.label.textContent=t('rawBatchDone',{name:path.basename(row.source)})+(warnings.length?' · '+warnings.join('; '):'');
     if(warnings.length)a.notice(t('imageReplacedRecordFailed',{msg:warnings.join('; ')}),'error');
     row.valid=false;
     report.results.push({source:row.source,output:out,status:'applied',warnings:warnings});
    }).catch(function(e){
     if(replaced){
      row.valid=false;
      report.results.push({source:row.source,output:out,status:'applied',warnings:[e.message]});
      a.notice(t('imageReplacedRecordFailed',{msg:e.message}),'error');
      return;
     }
     row.label.textContent=(stop?t('batchCancelledMsg',{msg:e.message}):t('batchFailed',{msg:e.message}));
     report.results.push({source:row.source,output:out,status:stop?'cancelled':'failed',error:e.message});
     if(rec){rec.status='not-applied';try{writeRecord(out,rec);}catch(ignore){}}
    });
   }).then(function(){fs.writeFileSync(reportPath,JSON.stringify(report,null,2));});
  });
  batchPromise=chain.then(function(){(a.appliedStatus||a.notice)(t('rawBatchFinished',{done:report.results.filter(function(r){return r.status==='applied';}).length,total:selected.length,path:reportPath}));}).catch(error).then(function(){return a.host('releaseBitmapBatch('+JSON.stringify(review.token)+')').catch(error).then(function(){batch=null;dataset=null;owner='';a.setBusy(false);updateBusy();return a.refresh();});});
  return batchPromise;
 }
 function lock(){try{locked={schema:'sci-raw-ranges',version:1,recipe:current(),lockedAt:new Date().toISOString()};store('sci_raw_group_lock',locked);$('rawLockStatus').textContent=t('lockedRanges');updateBusy();}catch(e){error(e);}}
 function updateBusy(){var busy=a.busy();rows.forEach(function(row){[row.low,row.high,row.lowSlider,row.highSlider,row.show,row.color].forEach(function(el){el.disabled=busy||!!locked;});});$('rawGamma').disabled=busy||!!locked;var rgb=$('rgbControls');rgb.classList.toggle('science-active',active());Array.prototype.forEach.call(rgb.querySelectorAll?rgb.querySelectorAll('input,select,button'):[],function(e){if(active())e.disabled=true;});['rawBrowse','rawLoad','rawExit','rawLock','rawUnlock','rawExport','rawImport','scalePick','scaleCalibrate','scaleCreate','scaleReuseLast','scaleClearCal','scalePresetSave','scalePresetLoad','scaleSaveGlobal','scaleUseGlobal','scaleClearGlobal','figureLabelCreate','figureLabelPresetSave','figureLabelPresetLoad','figureLabelPresetDelete'].forEach(function(id){if($(id))$(id).disabled=busy;});if(batch){$('runBatchBtn').disabled=busy||!batch.rows.some(function(r){return r.valid;});batch.rows.forEach(function(r){r.check.disabled=busy||!r.valid;});}$('cancelBatchBtn').disabled=!(batch&&busy);}
 function setSourcePixelSize(size){var el=$('scaleSourcePixels'),w=size&&Number(size.width),h=size&&Number(size.height);if(el)el.textContent=w>0&&h>0&&!size.estimated?Math.round(w)+' × '+Math.round(h)+' px':'—';}
 function updateCalibrationStatus(){
  var item=a.info(),k=item&&item.objectKey?item.objectKey:'',rec=lookupCalibration(item),phys=active()&&dataset&&dataset.physical&&dataset.physical.x,msg,x,y;
  if(picking){
    if(!$('scaleStatus').textContent){$('scaleStatus').textContent=t('pickEndsStatus');}
    return;
  }
  restoreCalibrationUi(rec,k);
  if(rec){if(rec.source&&root.PaperFigFileStamp.classify(rec.source,rec.sourceStamp)==='legacy'){msg=t('sourceNeedsConfirm');}else{msg=t('calibratedStatus',{method:rec.method,um:rec.umPerPixelX});}}
  else if(phys){
    x=dataset.physical.x;y=dataset.physical.y;
    msg=t('metaHasSpatial',{x:x,yPart:(y!=null&&y!==''?' · Y '+y+' µm/px':'')});
    if(!picking&&$('scaleMethod').value!=='two-point'){$('scaleMethod').value='metadata';}
  } else if(picking){msg=$('scaleStatus').textContent||'Click both ends of a horizontal bar on the preview (zoom in if needed); Escape cancels.';}
  else {msg=t('uncalibratedStatus');}
  $('scaleStatus').textContent=msg;
 }
 function fullSourceSize(){
  /* Always full raw/file pixels — never the active crop W×H. */
  if(active())return {width:dataset.width,height:dataset.height};
  return a.sourceSize();
 }
 function calibrate(){try{var size=fullSourceSize();if(!size||!(size.width>0)||!(size.height>0))throw new Error(t('errLoadSizedSource'));var method=$('scaleMethod').value,input={method:method,unit:$('scaleUnit').value,coordSpace:'full-source'},objectKey=key();if(!objectKey)throw new Error(t('errSelectBeforeCal'));if(method==='metadata'){if(!active()||!dataset.physical.x)throw new Error(t('errNoPhysical'));input.x=dataset.physical.x;input.y=dataset.physical.y;}else{if(!points||points.length!==2)throw new Error(t('errPickTwoEnds'));/* points from pointerToImagePx are full-source file px */input.points=points;input.length=$('scaleReference').value;}
   var rec=S.calibration(input);rec.source=active()?source:a.sourcePath();rec.sourceStamp=fileStamp(rec.source);rec.sourcePixels={width:size.width,height:size.height};rec.coordSpace='full-source';saveCalibrationRecord(rec,objectKey);calUiKey=objectKey;updateCalibrationStatus();a.notice(t('calSaved'));
  }catch(e){error(e);}}
 function pick(event){if(!picking)return false;if(a.busy())return true;var p=a.pointer(event.clientX,event.clientY),st=$('previewStage');if(!p){$('scaleStatus').textContent=t('clickInsidePreview');return true;}event.preventDefault();points.push({x:p.x,y:p.y});$('scaleStatus').textContent=t('refPointStatus',{n:points.length,x:p.x.toFixed(2),y:p.y.toFixed(2)});if(points.length===2){picking=false;pickKey='';syncPickCursor(false);$('scaleStatus').textContent+=t('refPointDone');}return true;}
 function readDisplayRecord(p){try{if(!p||!fs.existsSync(p+'.json'))return null;var rec=JSON.parse(fs.readFileSync(p+'.json','utf8'));if(rec&&rec.output===p)return rec;}catch(ignore){}return null;}
 function keepCalibrationAfterCrop(cal,item){
  var path=item&&item.sourcePath,kind,rec,size,cropKnown,ow,oh,cw,ch;
  if(!cal||!(Number(cal.umPerPixelX)>0))return null;
  kind=root.PaperFigFileStamp.classify(cal.source,cal.sourceStamp);
  if(kind==='match')return cal;
  if(kind==='legacy')return 'legacy';
  rec=readDisplayRecord(path);
  cropKnown=!!(rec&&rec.crop&&Number(rec.crop.width)>0&&Number(rec.crop.height)>0&&(rec.source===cal.source||(rec.parent&&(rec.parent.source===cal.source||rec.parent.origin===cal.source))||(item&&cal.objectKey&&item.objectKey===cal.objectKey)));
  if(!cropKnown){if(!confirmCalReuse(t('confirmSourceStamp')))return false;}
  size=fullSourceSize();
  cal=cloneCal(cal);
  if(path){cal.source=path;try{cal.sourceStamp=fileStamp(path);}catch(ignore){}}
  if(size&&size.width>0&&size.height>0){
    if(!cal.originSourcePixels&&cal.sourcePixels)cal.originSourcePixels={width:Number(cal.sourcePixels.width),height:Number(cal.sourcePixels.height)};
    cal.sourcePixels={width:Number(size.width),height:Number(size.height)};
    cal.appliedPixels={width:Number(size.width),height:Number(size.height)};
  }
  cal.umPerPixelX=Number(cal.umPerPixelX);
  saveCalibrationRecord(cal,item&&item.objectKey);
  return cal;
 }
 function scaleBar(){if(a.busy())return;var cal=lookupCalibration(a.info()),spec,expectedItem=a.info();try{if(!cal)throw new Error(t('errSaveCalFirst'));var kept=keepCalibrationAfterCrop(cal,expectedItem);if(kept==='legacy'){if(!confirmCalReuse(t('confirmSourceStamp'))){a.notice(t('sourceNeedsConfirm'));return;}a.setBusy(true);return root.PaperFigFileStamp.contentStampAsync(cal.source,function(info){$('scaleStatus').textContent=t('progressRead',{pct:info.pct});}).then(function(upgraded){cal.sourceStamp=upgraded;saveCalibrationRecord(cal,expectedItem.objectKey);a.setBusy(false);return scaleBar();}).catch(function(err){a.setBusy(false);error(err);});}if(kept===false){a.notice(t('calReuseCancelled'));return;}if(!kept)throw new Error(t('errCalSourceChanged'));cal=kept;var width=a.displayWidth(cal,infoBinding(expectedItem));if(!width)throw new Error(t('errDisplayWidth'));var len=Number($('scaleLength').value),unit=$('scaleBarUnit').value;spec={calibration:cal,displayPixelsX:width,length:len,unit:unit,fraction:S.scaleFraction(cal,len,unit,width),label:len+' '+(unit==='um'?'µm':unit),position:$('scalePosition').value,lineWidth:Number($('scaleLine').value),fontSize:Number($('scaleFont').value),margin:Number($('scaleMargin').value),color:$('scaleColor').value,includeText:(!$('scaleIncludeText')||$('scaleIncludeText').checked)};}catch(e){error(e);return;}a.setBusy(true);return a.capture().then(function(lock){if(a.count()!==1)throw new Error(t('errSelectOneScale'));if(lock.objectKey!==expectedItem.objectKey)throw new Error(t('errSelectionChanged'));return a.host('sciBitmapScaleBar('+JSON.stringify(JSON.stringify(lock))+','+JSON.stringify(JSON.stringify(spec))+')');}).then(function(){a.notice(t('scaleBarDone'));}).catch(error).then(function(){a.setBusy(false);});}
 var FIGURE_LABEL_PREFS = 'paperfig_figure_label_prefs_v1', FIGURE_LABEL_PRESETS = 'paperfig_figure_label_presets_v1';
 var figureFontsLoaded = false, figureFontsLoading = false, pendingFigureFont = '', pendingStainFont = '';
 function figureLabelUi(){
  var stains=[],i;
  for(i=1;i<=3;i++){stains.push({text:String($('figureStainText'+i).value||''),color:$('figureStainColor'+i).value});}
  return {text:String($('figureLabelText').value||''),font:String((figureFontsLoaded ? $('figureLabelFont').value : pendingFigureFont || $('figureLabelFont').value)||''),style:$('figureLabelStyle').value,size:Number($('figureLabelSize').value),margin:Number($('figureLabelMargin').value),verticalOffset:Number($('figureLabelVerticalOffset').value),position:$('figureLabelPosition').value,color:$('figureLabelColor').value,stains:stains,stainFont:String((figureFontsLoaded ? $('figureStainFont').value : pendingStainFont || $('figureStainFont').value)||''),stainStyle:$('figureStainStyle').value,stainSize:Number($('figureStainSize').value),stainPosition:$('figureStainPosition').value,stainMargin:Number($('figureStainMargin').value),stainVerticalOffset:Number($('figureStainVerticalOffset').value)};
 }
 function figureLabelStyleUi(){var s=figureLabelUi();delete s.text;return s;}
 function applyFigureLabelUi(s){
  if(!s||typeof s!=='object')return;
  if(s.text!=null)$('figureLabelText').value=String(s.text).slice(0,16);
  if(s.font!=null){pendingFigureFont=String(s.font);if(figureFontsLoaded)$('figureLabelFont').value=pendingFigureFont;}
  if(/^(regular|bold|italic|bold-italic)$/.test(s.style))$('figureLabelStyle').value=s.style;
  if(Number(s.size)>=4&&Number(s.size)<=72)$('figureLabelSize').value=Number(s.size);
  if(s.margin!=null&&Number(s.margin)>=-200&&Number(s.margin)<=200)$('figureLabelMargin').value=Number(s.margin);
  if(s.verticalOffset!=null&&Number(s.verticalOffset)>=-200&&Number(s.verticalOffset)<=200)$('figureLabelVerticalOffset').value=Number(s.verticalOffset);
  else if(s.margin!=null){var oldVertical=/^top-/.test(s.position)?8-Number(s.margin):Number(s.margin)-8;if(oldVertical>=-200&&oldVertical<=200)$('figureLabelVerticalOffset').value=oldVertical;}
  if(/^(top-left|top-right|bottom-left|bottom-right|outside-top-left|outside-top-right)$/.test(s.position))$('figureLabelPosition').value=s.position;
  if(/^#[0-9a-f]{6}$/i.test(s.color)){$('figureLabelColor').value=s.color;if(root.PaperFigColorPicker)root.PaperFigColorPicker.sync($('figureLabelColor'));}
  if(Array.isArray(s.stains)){s.stains.slice(0,3).forEach(function(entry,i){var n=i+1;if(!entry)return;if(entry.text!=null)$('figureStainText'+n).value=String(entry.text).slice(0,40);if(/^#[0-9a-f]{6}$/i.test(entry.color)){$('figureStainColor'+n).value=entry.color;if(root.PaperFigColorPicker)root.PaperFigColorPicker.sync($('figureStainColor'+n));}});}
  if(s.stainFont!=null){pendingStainFont=String(s.stainFont);if(figureFontsLoaded)$('figureStainFont').value=pendingStainFont;}
  if(/^(regular|bold|italic|bold-italic)$/.test(s.stainStyle))$('figureStainStyle').value=s.stainStyle;
  if(Number(s.stainSize)>=4&&Number(s.stainSize)<=72)$('figureStainSize').value=Number(s.stainSize);
  if(/^(outside-)?(top|bottom)-(left|right)$/.test(s.stainPosition))$('figureStainPosition').value=s.stainPosition;
  if(s.stainMargin!=null&&Number(s.stainMargin)>=-200&&Number(s.stainMargin)<=200)$('figureStainMargin').value=Number(s.stainMargin);
  if(s.stainVerticalOffset!=null&&Number(s.stainVerticalOffset)>=-200&&Number(s.stainVerticalOffset)<=200)$('figureStainVerticalOffset').value=Number(s.stainVerticalOffset);
 }
 function saveFigureLabelPrefs(){try{localStorage.setItem(FIGURE_LABEL_PREFS,JSON.stringify(figureLabelUi()));}catch(ignore){}}
 function readFigureLabelPresets(){try{var v=JSON.parse(localStorage.getItem(FIGURE_LABEL_PRESETS)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch(ignore){return {};}}
 function renderFigureLabelPresets(chosen){
  var select=$('figureLabelPresetSelect'),presets=readFigureLabelPresets(),names=Object.keys(presets).sort(),opt,i;
  while(select.options&&select.options.length>1)select.remove(1);
  for(i=0;i<names.length;i++){opt=document.createElement('option');opt.value=names[i];opt.textContent=names[i];select.appendChild(opt);}
  select.value=chosen&&presets[chosen]?chosen:'';
 }
 function saveFigureLabelPreset(){
  try{var name=String($('figureLabelPresetName').value||'').replace(/^\s+|\s+$/g,''),presets=readFigureLabelPresets();if(!name||/^(__proto__|constructor|prototype)$/i.test(name))throw new Error(t('errFigureLabelPresetName'));if(Object.keys(presets).length>=50&&!Object.prototype.hasOwnProperty.call(presets,name))throw new Error(t('errFigureLabelPresetLimit'));presets[name]=figureLabelStyleUi();localStorage.setItem(FIGURE_LABEL_PRESETS,JSON.stringify(presets));renderFigureLabelPresets(name);saveFigureLabelPrefs();a.notice(t('figureLabelPresetSaved',{name:name}));}catch(e){error(e);}
 }
 function loadFigureLabelPreset(){
  try{var name=$('figureLabelPresetSelect').value,preset=readFigureLabelPresets()[name];if(!preset)throw new Error(t('errFigureLabelPresetChoose'));applyFigureLabelUi(preset);saveFigureLabelPrefs();a.notice(t('figureLabelPresetLoaded',{name:name}));}catch(e){error(e);}
 }
 function deleteFigureLabelPreset(){
  try{var name=$('figureLabelPresetSelect').value,presets=readFigureLabelPresets();if(!name||!presets[name])throw new Error(t('errFigureLabelPresetChoose'));delete presets[name];localStorage.setItem(FIGURE_LABEL_PRESETS,JSON.stringify(presets));renderFigureLabelPresets();a.notice(t('figureLabelPresetDeleted',{name:name}));}catch(e){error(e);}
 }
 function loadFigureFonts(){
  if(figureFontsLoaded||figureFontsLoading)return;
  figureFontsLoading=true;
  a.host('sciBitmapFigureFontFamilies()').then(function(result){
   var names=result&&result.fonts||[];
   [['figureLabelFont',pendingFigureFont],['figureStainFont',pendingStainFont]].forEach(function(pair){
    var list=$(pair[0]),wanted=pair[1]||(list&&list.value),i,opt;
    if(!list)return;
    while(list.options.length>1)list.remove(1);
    for(i=0;i<names.length;i++){opt=document.createElement('option');opt.value=names[i];opt.textContent=names[i];list.appendChild(opt);}
    list.value=wanted||'';
    if(list.selectedIndex<0)list.value='';
   });
   figureFontsLoaded=true;figureFontsLoading=false;
  }).catch(function(){figureFontsLoading=false;});
 }
 function figureLabel(){
  if(a.busy())return;
  var item=a.info(),textValue=String($('figureLabelText').value||'').replace(/^\s+|\s+$/g,''),spec;
  try{
   if(!item||!item.objectKey)throw new Error(t('errSelectImageFirst'));
   if(!textValue||textValue.length>16||/[\r\n]/.test(textValue))throw new Error(t('errFigureLabelText'));
   spec=figureLabelUi();spec.text=textValue;spec.font=String(spec.font).replace(/^\s+|\s+$/g,'');spec.stainFont=String(spec.stainFont).replace(/^\s+|\s+$/g,'');
   if(!(spec.size>=4&&spec.size<=72)||!(spec.margin>=-200&&spec.margin<=200)||!(spec.verticalOffset>=-200&&spec.verticalOffset<=200))throw new Error(t('errFigureLabelSettings'));
   if(!(spec.stainSize>=4&&spec.stainSize<=72)||!/^(regular|bold|italic|bold-italic)$/.test(spec.stainStyle))throw new Error(t('errFigureLabelSettings'));
   if(!(spec.stainMargin>=-200&&spec.stainMargin<=200)||!(spec.stainVerticalOffset>=-200&&spec.stainVerticalOffset<=200)||!/^(outside-)?(top|bottom)-(left|right)$/.test(spec.stainPosition))throw new Error(t('errFigureLabelSettings'));
   spec.stains.forEach(function(entry){entry.text=String(entry.text||'').replace(/^\s+|\s+$/g,'');if(entry.text.length>40||/[\r\n]/.test(entry.text)||!/^#[0-9a-f]{6}$/i.test(entry.color))throw new Error(t('errFigureLabelSettings'));});
  }catch(e){error(e);return;}
  saveFigureLabelPrefs();a.setBusy(true);
  return a.capture().then(function(lock){
   if(a.count()!==1)throw new Error(t('errSelectOneScale'));
   if(lock.objectKey!==item.objectKey)throw new Error(t('errSelectionChanged'));
   return a.host('sciBitmapFigureLabel('+JSON.stringify(JSON.stringify(lock))+','+JSON.stringify(JSON.stringify(spec))+')');
  }).then(function(){a.notice(t('figureLabelDone',{text:textValue}));}).catch(error).then(function(){a.setBusy(false);});
 }
 function confirmCalReuse(msg){var fn=typeof root.confirm==='function'?root.confirm:(typeof confirm==='function'?confirm:null);if(typeof fn!=='function')return false;return !!fn(msg);}
 function adoptCalibration(cal,objectKey){var size=fullSourceSize(),origin=cal&&cal.sourcePixels,ow,oh,cw,ch;cal=cloneCal(cal);if(size&&origin&&Number(origin.width)>0&&Number(origin.height)>0&&(Number(origin.width)!==Number(size.width)||Number(origin.height)!==Number(size.height))){ow=Number(origin.width);oh=Number(origin.height);cw=Number(size.width);ch=Number(size.height);if(!confirmCalReuse(t('confirmReuseCalSize',{ow:ow,oh:oh,w:cw,h:ch}))){a.notice(t('calReuseCancelled'));return null;}cal.originSourcePixels={width:ow,height:oh};}if(size&&size.width>0&&size.height>0){if(!cal.originSourcePixels&&origin)cal.originSourcePixels={width:Number(origin.width),height:Number(origin.height)};cal.appliedPixels={width:Number(size.width),height:Number(size.height)};cal.sourcePixels={width:Number(size.width),height:Number(size.height)};}cal.source=active()?source:(a.sourcePath&&a.sourcePath())||cal.source;if(cal.source){try{cal.sourceStamp=fileStamp(cal.source);}catch(ignore){}}cal.coordSpace=cal.coordSpace||'full-source';saveCalibrationRecord(cal,objectKey);return cal;}
 function reuseLastCalibration(){try{var objectKey=key(),raw=localStorage.getItem(LAST_CAL),last,rec;if(!objectKey)throw new Error(t('errSelectImageFirst'));if(!raw)throw new Error(t('errNoPrevCal'));last=JSON.parse(raw);if(!last||!last.umPerPixelX)throw new Error(t('errPrevCalInvalid'));rec=adoptCalibration(last,objectKey);if(!rec)return;calUiKey='';restoreCalibrationUi(rec,objectKey);updateCalibrationStatus();a.notice(t('calReused'));}catch(e){error(e);}}
 function clearCalibration(){try{var objectKey=key(),m;if(!objectKey)throw new Error(t('errSelectImageFirst'));m=map(CAL);m[objectKey]={cleared:true,objectKey:objectKey,clearedAt:new Date().toISOString()};store(CAL,m);calUiKey='';points=[];clearCalibrationUiFields();updateCalibrationStatus();a.notice(t('calCleared'));}catch(e){error(e);}}
 function readBarStyleFromUi(){
  return {
   length:Number($('scaleLength').value),
   unit:$('scaleBarUnit').value,
   position:$('scalePosition').value,
   lineWidth:Number($('scaleLine').value),
   fontSize:Number($('scaleFont').value),
   margin:Number($('scaleMargin').value),
   color:$('scaleColor').value,
   includeText:(!$('scaleIncludeText')||$('scaleIncludeText').checked)
  };
 }
 function applyBarStyleToUi(style){
  if(!style)return;
  if(style.length!=null&&isFinite(Number(style.length)))$('scaleLength').value=Number(style.length);
  if(style.unit)$('scaleBarUnit').value=style.unit;
  if(style.position)$('scalePosition').value=style.position;
  if(style.lineWidth!=null&&isFinite(Number(style.lineWidth)))$('scaleLine').value=Number(style.lineWidth);
  if(style.fontSize!=null&&isFinite(Number(style.fontSize)))$('scaleFont').value=Number(style.fontSize);
  if(style.margin!=null&&isFinite(Number(style.margin)))$('scaleMargin').value=Number(style.margin);
  if(style.color)$('scaleColor').value=style.color;
  if($('scaleIncludeText')&&style.includeText!=null)$('scaleIncludeText').checked=!!style.includeText;
  try{if(typeof syncScaleTextUi==='function')syncScaleTextUi();}catch(ignore){}
 }

 function scalePresetsDir(){
  var os=root.require('os'),dir;
  dir=path.join(os.homedir(),'paperfig','scales');
  try{
   if(!fs.existsSync(dir)){
    var parent=path.dirname(dir);
    if(parent&&parent!==dir&&!fs.existsSync(parent)){try{fs.mkdirSync(parent);}catch(ignoreP){}}
    fs.mkdirSync(dir);
   }
  }catch(ignore){}
  return dir;
 }
 function sanitizeScalePresetName(name){
  var s=String(name||'').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\.+$/,'');
  if(s.length>80)s=s.slice(0,80);
  return s;
 }
 function scalePresetPath(name){
  return path.join(scalePresetsDir(),sanitizeScalePresetName(name)+'.json');
 }
 function parseScalePreset(raw,optName){
  var rec,cal,style;
  if(typeof raw==='string')rec=JSON.parse(raw);else rec=raw;
  if(!rec)return null;
  /* Accept legacy global slot shape (no schema) and named files. */
  if(rec.schema&&rec.schema!==SCALE_PRESET_SCHEMA)throw new Error(t('errScalePresetInvalid'));
  cal=rec.calibration;style=rec.style;
  if(!cal||!(Number(cal.umPerPixelX)>0)||!style)throw new Error(t('errScalePresetInvalid'));
  if(!rec.name&&optName)rec.name=optName;
  if(!rec.schema)rec.schema=SCALE_PRESET_SCHEMA;
  if(!rec.version)rec.version=1;
  return rec;
 }
 function listScalePresetFiles(){
  var dir=scalePresetsDir(),out=[],names,i,n,full,raw,rec;
  try{names=fs.readdirSync(dir);}catch(e){return [];}
  names.sort(function(a,b){return a.toLowerCase()<b.toLowerCase()?-1:1;});
  for(i=0;i<names.length;i++){
   n=names[i];if(!/\.json$/i.test(n))continue;
   full=path.join(dir,n);
   try{
    if(fs.statSync(full).size>1048576)continue;
    raw=fs.readFileSync(full,'utf8');
    rec=parseScalePreset(raw,path.basename(n,'.json'));
    if(rec)out.push({name:rec.name||path.basename(n,'.json'),path:full,rec:rec});
   }catch(ignore){}
  }
  return out;
 }
 function migrateLegacyGlobalScale(){
  var raw,rec,dest,name;
  try{
   raw=localStorage.getItem(GLOBAL_SCALE);if(!raw)return;
   if(listScalePresetFiles().length)return;
   rec=parseScalePreset(raw,'Saved scale');
   name=sanitizeScalePresetName(rec.name||'Saved scale')||'Saved scale';
   dest=scalePresetPath(name);
   if(!fs.existsSync(dest)){
    rec.schema=SCALE_PRESET_SCHEMA;rec.version=1;rec.name=name;
    fs.writeFileSync(dest,JSON.stringify(rec,null,2),'utf8');
   }
  }catch(ignore){}
 }
 function renderScalePresetSelect(){
  /* UI no longer lists presets; still migrate legacy global slot once. */
  migrateLegacyGlobalScale();
 }
 function updateScalePresetStatus(){ /* status line removed */ }
 function applyScaleRecord(rec,noticeKey,name){
  var objectKey=key(),cal,style;
  if(!objectKey)throw new Error(t('errSelectImageFirst'));
  if(!rec)throw new Error(t('errNoScalePreset'));
  cal=rec.calibration;style=rec.style;
  if(!cal||!(Number(cal.umPerPixelX)>0)||!style)throw new Error(t('errScalePresetInvalid'));
  cal=adoptCalibration(cal,objectKey);
  if(!cal)return;
  calUiKey='';
  restoreCalibrationUi(cal,objectKey);
  applyBarStyleToUi(style);
  updateCalibrationStatus();
  a.notice(t(noticeKey,{name:name||rec.name||''}));
 }
 function downloadsDir(){
  var os=root.require('os'),home='';
  try{home=String(os.homedir?os.homedir():'');}catch(ignore){}
  if(!home&&root.process&&root.process.env){home=String(root.process.env.USERPROFILE||root.process.env.HOME||'');}
  return path.join(home,'Downloads');
 }
 function normalizeScaleSavePath(dest){
  dest=String(dest||'').trim();
  if(!dest)return '';
  if(!/\.json$/i.test(dest))dest+='.json';
  return dest;
 }
 function dialogPath(result){
  var data=result&&result.data;
  if(Array.isArray(data))return data.length?String(data[0]||'').trim():'';
  return typeof data==='string'?data.trim():'';
 }
 function chooseScalePresetSavePath(){
  var dir=downloadsDir(),result;
  if(!(root.cep&&root.cep.fs&&typeof root.cep.fs.showSaveDialogEx==='function'))return null;
  result=root.cep.fs.showSaveDialogEx(t('scalePresetSave')||'Save scale preset',dir,['json'],'scale-preset.json','JSON (*.json)','','');
  return normalizeScaleSavePath(dialogPath(result));
 }
 function writeScalePresetFile(dest,cal,style){
  var name=sanitizeScalePresetName(path.basename(dest,'.json'))||'scale-preset',rec,parent,gp;
  if(!name)throw new Error(t('errEnterScalePresetName'));
  rec={schema:SCALE_PRESET_SCHEMA,version:1,name:name,savedAt:new Date().toISOString(),calibration:cloneCal(cal),style:style};
  try{delete rec.calibration.objectKey;}catch(ignore){}
  try{
   parent=path.dirname(dest);
   if(parent&&!fs.existsSync(parent)){
    gp=path.dirname(parent);
    if(gp&&gp!==parent&&!fs.existsSync(gp)){try{fs.mkdirSync(gp);}catch(ignoreP){}}
    try{fs.mkdirSync(parent);}catch(ignoreD){}
   }
  }catch(ignore){}
  fs.writeFileSync(dest,JSON.stringify(rec,null,2),'utf8');
  a.notice(t('scalePresetSaved',{name:name,path:dest}));
 }
 function saveNamedScalePreset(optName){try{
  var name,cal,style,dest,picked;
  cal=lookupCalibration(a.info());
  if(!cal||!(Number(cal.umPerPixelX)>0))throw new Error(t('errSaveCalFirst'));
  style=readBarStyleFromUi();
  if(!(style.length>0)||!style.unit)throw new Error(t('errInvalidScaleBarSettings'));
  /* UI click passes Event; only treat real string/number names as programmatic saves. */
  if(optName!=null&&(typeof optName==='string'||typeof optName==='number')&&String(optName).length){
   name=sanitizeScalePresetName(optName);
   if(!name)throw new Error(t('errEnterScalePresetName'));
   dest=scalePresetPath(name);
   /* Silent overwrite when same-named file already exists. */
   writeScalePresetFile(dest,cal,style);
   return;
  }
  picked=chooseScalePresetSavePath();
  if(picked===null){error(new Error(t('errFileDialogUnavailable')));return;}
  if(!picked)return; /* user canceled */
  writeScalePresetFile(picked,cal,style);
 }catch(e){error(e);}}
 function chooseScalePresetOpenPath(){
  var dir=downloadsDir(),result;
  if(!(root.cep&&root.cep.fs&&typeof root.cep.fs.showOpenDialogEx==='function'))return null;
  result=root.cep.fs.showOpenDialogEx(false,false,t('scalePresetLoad')||'Open',dir,['json'],'JSON (*.json)','');
  return dialogPath(result);
 }
 function loadNamedScalePreset(){
  var picked;
  try{picked=chooseScalePresetOpenPath();}catch(e){error(e);return;}
  if(picked===null){error(new Error(t('errFileDialogUnavailable')));return;}
  if(picked)loadScalePresetFile(picked);
 }
 function useNamedScalePreset(optName){try{
  /* Programmatic apply by preset name (tests / callers). UI uses Load file picker. */
  var sel=optName!=null?sanitizeScalePresetName(optName):'',list,i,hit=null;
  if(!sel)throw new Error(t('errNoScalePreset'));
  list=listScalePresetFiles();
  for(i=0;i<list.length;i++){if(list[i].name===sel){hit=list[i];break;}}
  if(!hit)throw new Error(t('errNoScalePreset'));
  applyScaleRecord(hit.rec,'scalePresetApplied',hit.name);
 }catch(e){error(e);}}
 function deleteNamedScalePreset(optName){try{
  var sel=optName!=null?sanitizeScalePresetName(optName):'';
  if(!sel)throw new Error(t('errNoScalePreset'));
  var dest=scalePresetPath(sel);
  if(fs.existsSync(dest))fs.unlinkSync(dest);
  a.notice(t('scalePresetDeleted',{name:sel}));
 }catch(e){error(e);}}
 function loadScalePresetFile(file){
  if(!file)return;
  if(typeof file==='string'){
   try{
    var raw=fs.readFileSync(file,'utf8');
    var base=sanitizeScalePresetName(path.basename(file,'.json'))||'Loaded';
    var rec=parseScalePreset(raw,base);
    applyScaleRecord(rec,'scalePresetApplied',rec.name||base);
   }catch(e){error(e);}
   return;
  }
  if(file.size>1048576){error(new Error(t('errRangeJsonBig')));return;}
  var reader=new FileReader();
  reader.onload=function(){try{
   var base=sanitizeScalePresetName((file.name||'').replace(/\.json$/i,''))||'Loaded',rec;
   rec=parseScalePreset(reader.result,base);
   applyScaleRecord(rec,'scalePresetApplied',rec.name||base);
  }catch(e){error(e);}};
  reader.onerror=function(){error(new Error(t('errCannotReadRanges')));};
  reader.readAsText(file);
 }
 function importScalePresetFile(file){loadScalePresetFile(file);}
 function revealScalePresetsFolder(){try{
  var dir=scalePresetsDir(),plat=root.require('os').platform();
  var command=plat==='win32'?'explorer.exe':(plat==='darwin'?'open':'xdg-open');
  var child=root.require('child_process').spawn(command,[dir],{windowsHide:true});
  child.on('error',error);
  a.notice(t('scalePresetStatusFolder',{dir:dir,n:listScalePresetFiles().length}));
 }catch(e){error(e);}}
 /* Back-compat aliases used by older tests / callers */
 function loadGlobalScale(){
  var list=listScalePresetFiles();return list.length?list[0].rec:null;
 }
 function saveGlobalScale(){saveNamedScalePreset();}
 function useGlobalScale(){useNamedScalePreset();}
 function clearGlobalScale(){deleteNamedScalePreset();}
 function updateScaleGlobalStatus(){updateScalePresetStatus();}

 var SCALE_INCLUDE_TEXT='sci_scale_include_text';function syncScaleTextUi(){var el=$('scaleIncludeText'),font=$('scaleFont'),on=true;if(el){on=!!el.checked;try{localStorage.setItem(SCALE_INCLUDE_TEXT,on?'1':'0');}catch(ignore){}}if(font){font.disabled=!on;if(font.parentElement)font.parentElement.classList.toggle('dimmed',!on);}}
 function init(){
  $('rawBrowse').addEventListener('click',function(){$('rawFile').click();});$('rawFile').addEventListener('change',function(){var f=this.files&&this.files[0];if(f)$('rawSource').value=f.path||f.name;this.value='';});$('rawLoad').addEventListener('click',loadClick);
  $('rawExit').addEventListener('click',function(){var m=map(KEY);m[key()]={disabled:true,displayPath:a.info().sourcePath};store(KEY,m);dataset=null;owner='';rows=[];$('rawChannels').textContent='';a.refresh();});$('rawSolo').addEventListener('change',schedule);$('rawGamma').addEventListener('change',schedule);
  $('rawLock').addEventListener('click',lock);$('rawUnlock').addEventListener('click',function(){locked=null;store('sci_raw_group_lock',null);$('rawLockStatus').textContent=t('rawUnlocked');updateBusy();});
  $('rawExport').addEventListener('click',function(){try{var value=locked||{schema:'sci-raw-ranges',version:1,recipe:current()},out=a.exportPath('raw-ranges');fs.writeFileSync(out,JSON.stringify(value,null,2));a.notice(t('rawRangesExported',{path:out}));}catch(e){error(e);}});
  $('rawImport').addEventListener('click',function(){$('rawRangesFile').click();});$('rawRangesFile').addEventListener('change',function(){var f=this.files&&this.files[0];this.value='';if(!f)return;if(f.size>1048576){error(new Error(t('errRangeJsonBig')));return;}var reader=new FileReader();reader.onload=function(){try{if(!active())throw new Error(t('errLoadBeforeImport'));var value=JSON.parse(reader.result);if(value.schema!=='sci-raw-ranges'||value.version!==1||!value.recipe||typeof value.recipe.signature!=='string')throw new Error(t('errInvalidRangeFile'));value.recipe=S.recipe(dataset,value.recipe);locked=value;renderRows(value.recipe);$('rawLockStatus').textContent=t('importedLocked');store('sci_raw_group_lock',locked);renderPanel();}catch(e){error(e);}};reader.onerror=function(){error(new Error(t('errCannotReadRanges')));};reader.readAsText(f);});
  $('scalePick').addEventListener('click',function(){if(!a.sourceSize()&&!active()){error(new Error(t('errLoadPreviewFirst')));return;}var item=a.info();points=[];picking=true;pickKey=item&&item.objectKey?item.objectKey:key();calUiKey=pickKey;$('scaleMethod').value='two-point';$('scaleStatus').textContent=t('pickEndsStatus');syncPickCursor(true);a.notice(t('pickEndsNotice'));});$('scaleCalibrate').addEventListener('click',calibrate);$('scaleCreate').addEventListener('click',scaleBar);try{var _sit=localStorage.getItem(SCALE_INCLUDE_TEXT);if(_sit!=null&&$('scaleIncludeText'))$('scaleIncludeText').checked=_sit!=='0';}catch(ignore){}if($('scaleIncludeText')){$('scaleIncludeText').addEventListener('change',syncScaleTextUi);syncScaleTextUi();}if($('scaleReuseLast'))$('scaleReuseLast').addEventListener('click',reuseLastCalibration);if($('scaleClearCal'))$('scaleClearCal').addEventListener('click',clearCalibration);if($('scalePresetSave'))$('scalePresetSave').addEventListener('click',function(){saveNamedScalePreset();});if($('scalePresetLoad'))$('scalePresetLoad').addEventListener('click',loadNamedScalePreset);renderScalePresetSelect();document.addEventListener('keydown',function(e){if(e.key==='Escape'&&picking){picking=false;points=[];pickKey='';syncPickCursor(false);updateCalibrationStatus();}});
  if($('figureLabelCreate'))$('figureLabelCreate').addEventListener('click',figureLabel);
  if($('figureLabelFont'))$('figureLabelFont').addEventListener('focus',loadFigureFonts);
  if($('figureStainFont'))$('figureStainFont').addEventListener('focus',loadFigureFonts);
  document.addEventListener('paperfig-tab',function(event){if(event&&event.detail&&event.detail.tab==='label')loadFigureFonts();});
  ['figureLabelText','figureLabelFont','figureLabelStyle','figureLabelSize','figureLabelMargin','figureLabelVerticalOffset','figureLabelPosition','figureLabelColor','figureStainText1','figureStainText2','figureStainText3','figureStainColor1','figureStainColor2','figureStainColor3','figureStainFont','figureStainStyle','figureStainSize','figureStainPosition','figureStainMargin','figureStainVerticalOffset'].forEach(function(id){if($(id))$(id).addEventListener('change',saveFigureLabelPrefs);});
  if($('figureLabelPresetSave'))$('figureLabelPresetSave').addEventListener('click',saveFigureLabelPreset);
  if($('figureLabelPresetLoad'))$('figureLabelPresetLoad').addEventListener('click',loadFigureLabelPreset);
  if($('figureLabelPresetDelete'))$('figureLabelPresetDelete').addEventListener('click',deleteFigureLabelPreset);
  try{applyFigureLabelUi(JSON.parse(localStorage.getItem(FIGURE_LABEL_PREFS)||'null'));}catch(ignoreLabelPrefs){}
  if($('figureLabelPresetSelect'))renderFigureLabelPresets();
  root.addEventListener('beforeunload',function(){bridge.stop();});
  try{var saved=JSON.parse(localStorage.getItem('sci_raw_group_lock')||'null');if(saved&&saved.schema==='sci-raw-ranges'&&saved.version===1){locked=saved;$('rawLockStatus').textContent=t('lockedRestored');}}catch(ignore){}
  try{if($('rawStatus'))$('rawStatus').textContent=t('rawStatusEmpty');if($('scaleStatus'))$('scaleStatus').textContent=t('scaleStatusDefault');if(!locked&&$('rawLockStatus'))$('rawLockStatus').textContent=t('rawLockUnlocked');}catch(ignore){}
  try{recoverPendingRecords();}catch(ignore){}
 if(root.PaperFigI18n&&root.PaperFigI18n.onChange){root.PaperFigI18n.onChange(function(){try{if(active()){rebuildKeepButtons();var r=current();setSelect($('rawSolo'),[[-1,t('merged')]].concat(dataset.names.map(function(n,i){return [i,t('mergedGray',{name:n})];})));$('rawSolo').value='-1';}updateCalibrationStatus();if(!locked&&$('rawLockStatus'))$('rawLockStatus').textContent=t('rawLockUnlocked');if(!dataset){if($('rawStatus'))$('rawStatus').textContent=t('rawStatusEmpty');if($('rawKeepHint'))$('rawKeepHint').textContent=t('rawKeepHint');}}catch(ignore){}});}
 }
 function onCropChanged(){
  /* Crop Use-full ↔ region must NOT clear per-image calibration or umPerPixel.
   * Endpoints remain full-source file px; only refresh status (no UI wipe). */
  updateCalibrationStatus();
 }
 init();return {active:active,renderPanel:renderPanel,reset:function(){if(!active())return false;if(locked){error(new Error(t('errUnlockBeforeReset')));return true;}renderRows(S.recipe(dataset));renderPanel();return true;},apply:apply,prepareBatch:prepareBatch,runBatch:runBatch,cancelBatch:function(){if(!batch)return false;stop=true;return true;},hasBatch:function(){return !!batch;},onSelection:onSelection,setSourcePixelSize:setSourcePixelSize,maybeLoad:maybeLoad,updateBusy:updateBusy,pick:pick,isPicking:function(){return !!picking;},load:load,lock:lock,calibrate:calibrate,scaleBar:scaleBar,migrateCalibration:migrateCalibration,reuseLastCalibration:reuseLastCalibration,clearCalibration:clearCalibration,saveGlobalScale:saveGlobalScale,useGlobalScale:useGlobalScale,clearGlobalScale:clearGlobalScale,loadGlobalScale:loadGlobalScale,saveNamedScalePreset:saveNamedScalePreset,loadNamedScalePreset:loadNamedScalePreset,useNamedScalePreset:useNamedScalePreset,deleteNamedScalePreset:deleteNamedScalePreset,listScalePresetFiles:listScalePresetFiles,scalePresetsDir:scalePresetsDir,importScalePresetFile:importScalePresetFile,loadScalePresetFile:loadScalePresetFile,lookupCalibration:lookupCalibration,onCropChanged:onCropChanged,updateCalibrationStatus:updateCalibrationStatus,state:function(){return {dataset:dataset,locked:locked,batch:batch,calUiKey:calUiKey};}};
}};}(window));
