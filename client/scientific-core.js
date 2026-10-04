/* PaperFig for Illustrator scientific display: immutable raw data, exact histograms and calibration. See LICENSE. */
(function(root,f){var api=f();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SciScientific=api;}(typeof window!=='undefined'?window:null,function(){
'use strict';
function finite(v,min,max,label){v=Number(v);if(!isFinite(v)||v<min||v>max)throw new Error(label+' outside '+min+'–'+max);return v;}
function clone(v){return JSON.parse(JSON.stringify(v));}
function signature(d){return JSON.stringify({bits:d.bits,names:d.names});}
function recipe(d,r){r=r||{};if(r.clahe===true)throw new Error('CLAHE is not supported in this version');var colors=['#ff00ff','#00ff00','#0080ff','#ffffff','#ffff00','#00ffff','#ff8000','#8080ff'];var max=Math.pow(2,d.bits)-1;
 if(r.signature&&r.signature!==signature(d))throw new Error('Channel names/order or bit depth differ from the locked group. Map channels explicitly before reuse.');
 var rows=r.channels||d.names.map(function(n,i){return {name:n,low:0,high:max,color:colors[i%colors.length],visible:true};});
 if(rows.length!==d.names.length)throw new Error('Channel count differs');
 return {version:1,signature:signature(d),channels:rows.map(function(c,i){var lo=finite(c.low,0,max,'Low'),hi=finite(c.high,0,max,'High');if(hi<=lo)throw new Error('High must exceed Low');if(!/^#[a-f0-9]{6}$/i.test(c.color))throw new Error('Invalid color');return {name:d.names[i],low:lo,high:hi,color:c.color.toLowerCase(),visible:c.visible!==false};}),gamma:finite(r.gamma==null?1:r.gamma,0.1,5,'Gamma'),clahe:false};
}
function prepare(d){if([8,16].indexOf(d.bits)<0||!d.width||!d.height||d.width*d.height>64000000||d.planes.length>8||d.width*d.height*d.planes.length>128000000)throw new Error('Supported: uint8/uint16, 1–8 channels, ≤64M pixels/plane and ≤128M samples');
 if(!d.planes.length||d.names.length!==d.planes.length)throw new Error('Channel metadata mismatch');
 d.histograms=d.planes.map(function(p){if(p.length!==d.width*d.height)throw new Error('Plane length mismatch');var h=new Uint32Array(Math.pow(2,d.bits));for(var i=0;i<p.length;i++)h[p[i]]++;return h;});return d;
}
function statistics(d,r){r=recipe(d,r);return d.histograms.map(function(h,c){var lo=r.channels[c].low,hi=r.channels[c].high,a=0,b=0,atLow=0,atHigh=0;for(var i=0;i<h.length;i++){if(i<lo)a+=h[i];else if(i===lo)atLow=h[i];if(i>hi)b+=h[i];else if(i===hi)atHigh=h[i];}return {name:d.names[c],below:a,above:b,atLow:atLow,atHigh:atHigh,total:d.width*d.height,belowPercent:100*a/(d.width*d.height),abovePercent:100*b/(d.width*d.height),sensorMaximum:h[h.length-1]};});}
function renderJob(d,r,options){r=recipe(d,r);options=options||{};var rect=options.crop||{left:0,top:0,width:d.width,height:d.height};var x0=Math.round(rect.left||0),y0=Math.round(rect.top||0),w=Math.round(rect.width||d.width),h=Math.round(rect.height||d.height);
 if(x0<0||y0<0||w<1||h<1||x0+w>d.width||y0+h>d.height)throw new Error('Crop outside raw plane');var scale=options.maxEdge?Math.min(1,options.maxEdge/Math.max(w,h)):1,ow=Math.max(1,Math.round(w*scale)),oh=Math.max(1,Math.round(h*scale)),out=new Uint8ClampedArray(ow*oh*4),compositeClipped=0,luts=r.channels.map(function(c){var lut=new Float32Array(Math.pow(2,d.bits));for(var i=0;i<lut.length;i++)lut[i]=Math.pow(Math.max(0,Math.min(1,(i-c.low)/(c.high-c.low))),1/r.gamma)*255;return lut;}),rgb=r.channels.map(function(c){return [parseInt(c.color.slice(1,3),16)/255,parseInt(c.color.slice(3,5),16)/255,parseInt(c.color.slice(5,7),16)/255];});
 function paint(yFrom,yTo){for(var y=yFrom;y<yTo;y++)for(var x=0;x<ow;x++){var p=(y*ow+x)*4,src=(y0+Math.min(h-1,Math.floor(y*h/oh)))*d.width+x0+Math.min(w-1,Math.floor(x*w/ow)),rr=0,gg=0,bb=0;
  for(var c=0;c<d.planes.length;c++){if(!r.channels[c].visible||(options.solo>=0&&options.solo!==c))continue;var v=luts[c][d.planes[c][src]];if(options.solo>=0){rr+=v;gg+=v;bb+=v;}else{rr+=v*rgb[c][0];gg+=v*rgb[c][1];bb+=v*rgb[c][2];}}
  if(rr>255||gg>255||bb>255)compositeClipped++;
  out[p]=rr;out[p+1]=gg;out[p+2]=bb;out[p+3]=255;
 }}
 return {height:oh,paint:paint,finish:function(){return {width:ow,height:oh,data:out,compositeClipped:compositeClipped,compositeClippedPercent:100*compositeClipped/(ow*oh)};}};
}
function render(d,r,options){var job=renderJob(d,r,options);job.paint(0,job.height);return job.finish();}
function renderAsync(d,r,options,onProgress){return new Promise(function(resolve,reject){var job,y=0,step=48;try{job=renderJob(d,r,options);}catch(e){reject(e);return;}
 function next(){try{var end=Math.min(job.height,y+step);job.paint(y,end);y=end;if(onProgress)onProgress({phase:'process',pct:job.height?Math.round(100*y/job.height):100});if(y<job.height)setTimeout(next,0);else resolve(job.finish());}catch(e){reject(e);}}
 next();});}

function um(v,unit){var m={nm:0.001,um:1,'µm':1,'μm':1,mm:1000,cm:10000,m:1000000};if(!m[unit])throw new Error('Unsupported length unit: '+unit);return finite(v,1e-12,1e12,'Length')*m[unit];}
function calibration(input){var x,y,method=input.method;
 if(method==='metadata'){x=finite(input.x,1e-12,1e12,'Pixel size X');y=input.y?finite(input.y,1e-12,1e12,'Pixel size Y'):null;}
 else if(method==='field'){x=um(input.width,input.unit)/finite(input.pixelsX,1,1e9,'Pixel width');y=input.height?um(input.height,input.unit)/finite(input.pixelsY,1,1e9,'Pixel height'):null;}
 else if(method==='two-point'){var a=input.points&&input.points[0],b=input.points&&input.points[1];if(!a||!b)throw new Error('Pick two endpoints');var dx=Number(a.x)-Number(b.x),dy=Number(a.y)-Number(b.y),dist=Math.sqrt(dx*dx+dy*dy);if(!(dist>=2))throw new Error('Reference line must cover at least 2 source pixels');x=um(input.length,input.unit)/dist;y=null;}
 else throw new Error('Unknown calibration method');return {version:1,method:method,umPerPixelX:x,umPerPixelY:y,coordSpace:'full-source',input:clone(input),createdAt:new Date().toISOString()};
}
function scaleFraction(cal,length,unit,displayPixelsX){var fraction=um(length,unit)/(cal.umPerPixelX*finite(displayPixelsX,1,1e9,'Displayed pixel width'));if(!(fraction>0&&fraction<0.9))throw new Error('Scale bar must be shorter than 90% of displayed field');return fraction;}
function attrs(text){var a={};text.replace(/([\w:]+)\s*=\s*(["'])(.*?)\2/g,function(_,k,q,v){a[k]=v.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');return _;});return a;}
function nativeTiff(b,request){request=request||{};if(b.length<8)throw new Error('Invalid TIFF');var le=b.toString('ascii',0,2)==='II';if(!le&&b.toString('ascii',0,2)!=='MM')throw new Error('Not TIFF');function u16(p){return le?b.readUInt16LE(p):b.readUInt16BE(p);}function u32(p){return le?b.readUInt32LE(p):b.readUInt32BE(p);}if(u16(2)!==42)throw new Error('BigTIFF requires Bio-Formats');var ifds=[],off=u32(4),seen={};
 while(off){if(seen[off]||ifds.length>=16384)throw new Error('Invalid/large directory chain');seen[off]=true;var n=u16(off),tags={};if(n>4096||off+2+n*12+4>b.length)throw new Error('Invalid TIFF directory');for(var i=0;i<n;i++){var e=off+2+i*12,id=u16(e),type=u16(e+2),cnt=u32(e+4),unit={1:1,2:1,3:2,4:4}[type];if(!unit||cnt>1048576)continue;var at=cnt*unit<=4?e+8:u32(e+8);if(at+cnt*unit>b.length)throw new Error('Invalid tag offset');if(type===2){tags[id]=b.toString('utf8',at,at+cnt).replace(/\0+$/,'');continue;}var vals=[];for(var j=0;j<cnt;j++)vals.push(type===3?u16(at+j*2):type===4?u32(at+j*4):b[at+j]);tags[id]=vals;}ifds.push(tags);off=u32(off+2+n*12);}
 if(!ifds.length)throw new Error('No TIFF planes');var xml=ifds[0][270]||'',pixels=/<(?:\w+:)?Pixels\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Pixels>/.exec(xml),cN=1,zN=1,tN=1,names=['C1'],mapping={},physical={},seriesCount=1;
 if(pixels){if((xml.match(/<(?:\w+:)?Pixels\b/g)||[]).length!==1||/<(?:\w+:)?UUID\b/.test(xml))throw new Error('Multi-series/file OME requires Bio-Formats');var a=attrs(pixels[1]),body=pixels[2];cN=+a.SizeC;zN=+a.SizeZ;tN=+a.SizeT;if(!cN||!zN||!tN)throw new Error('Invalid OME dimensions');names=[];var ch=/<(?:\w+:)?Channel\b([^>]*)\/?\s*>/g,m;while((m=ch.exec(body))){var ca=attrs(m[1]);if(+ca.SamplesPerPixel>1)throw new Error('Packed RGB OME requires Bio-Formats');names.push(ca.Name||ca.ID||'C'+(names.length+1));}if(names.length!==cN)throw new Error('Incomplete channel names');
 var order=String(a.DimensionOrder||'').slice(2).split('');if(order.length!==3||order.slice().sort().join('')!=='CTZ')throw new Error('Invalid OME order');var dims={C:cN,Z:zN,T:tN};var linear=function(pos){var idx=0,mul=1;order.forEach(function(k){idx+=pos[k]*mul;mul*=dims[k];});return idx;};var td=/<(?:\w+:)?TiffData\b([^>]*)\/?\s*>/g,found=false;while((m=td.exec(body))){found=true;var ta=attrs(m[1]),start=linear({C:+ta.FirstC||0,Z:+ta.FirstZ||0,T:+ta.FirstT||0}),first=+ta.IFD||0,count=ta.PlaneCount!=null?+ta.PlaneCount:(ta.IFD!=null?1:ifds.length);if(count<1||count>ifds.length)throw new Error('Invalid OME plane count');for(var q=0;q<count;q++){if(mapping[start+q]!=null)throw new Error('Overlapping OME mapping');mapping[start+q]=first+q;}}if(!found)throw new Error('OME TiffData absent');
 physical.x=a.PhysicalSizeX?um(a.PhysicalSizeX,a.PhysicalSizeXUnit||'µm'):null;physical.y=a.PhysicalSizeY?um(a.PhysicalSizeY,a.PhysicalSizeYUnit||'µm'):null;
 }else if(ifds.length>1){throw new Error('Unlabelled TIFF stack: use Bio-Formats and verify C/Z/T');}
 if((request.series||0)!==0)throw new Error('Series index unavailable');var z=Number(request.z||0),t=Number(request.t||0);if(z<0||z>=zN||t<0||t>=tN||z%1||t%1)throw new Error('Z/T outside dataset');var planes=[],w=0,h=0,bits=0;
 for(var c=0;c<cN;c++){var index=pixels?mapping[linear({C:c,Z:z,T:t})]:0,tag=ifds[index];if(!tag)throw new Error('Missing OME plane');function one(id,def){return tag[id]?tag[id][0]:def;}var cw=one(256,0),hh=one(257,0),bit=one(258,1);if([8,16].indexOf(bit)<0||one(259,1)!==1||one(262,1)!==1||one(277,1)!==1||one(274,1)!==1||one(317,1)!==1||one(339,1)!==1)throw new Error('TIFF layout requires Bio-Formats');if(!cw||!hh||cw*hh>64000000||cw*hh*cN>128000000||cN>8)throw new Error('Dataset exceeds memory limits');if(c&&(w!==cw||h!==hh||bits!==bit))throw new Error('Mixed plane layout');if(pixels&&(cw!==+a.SizeX||hh!==+a.SizeY))throw new Error('OME dimensions mismatch');w=cw;h=hh;bits=bit;var plane=bit===16?new Uint16Array(w*h):new Uint8Array(w*h),offsets=tag[273],sizes=tag[279],rows=one(278,h),row=0;if(!offsets||!sizes||rows<1)throw new Error('Missing strips');for(var st=0;st<offsets.length&&row<h;st++){var count=Math.min(rows,h-row)*w,at=offsets[st];if(sizes[st]<count*bit/8||at+count*bit/8>b.length)throw new Error('Truncated strip');for(var k=0;k<count;k++)plane[row*w+k]=bit===16?u16(at+k*2):b[at+k];row+=Math.min(rows,h-row);}if(row!==h)throw new Error('Incomplete strips');planes.push(plane);}
 return prepare({width:w,height:h,bits:bits,names:names,planes:planes,physical:physical,sizeZ:zN,sizeT:tN,seriesCount:seriesCount,series:0,z:z,t:t,reader:pixels?'native OME-TIFF':'native gray TIFF'});
}
function keepChannels(d,r,mask){
 r=recipe(d,r);if(!Array.isArray(mask))throw new Error('Keep mask required');
 if(mask.length!==d.names.length)throw new Error('Keep mask length must match channel count');
 var kept=0;r.channels=r.channels.map(function(c,i){var on=mask[i]===true;if(on)kept++;return {name:c.name,low:c.low,high:c.high,color:c.color,visible:on};});
 if(kept<1)throw new Error('Keep at least one channel');
 return r;
}
return {recipe:recipe,prepare:prepare,render:render,renderAsync:renderAsync,statistics:statistics,signature:signature,calibration:calibration,scaleFraction:scaleFraction,um:um,clone:clone,nativeTiff:nativeTiff,keepChannels:keepChannels};
}));
