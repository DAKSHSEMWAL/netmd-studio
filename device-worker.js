const path=require('path');
const fs=require('fs');
const {Worker}=require('worker_threads');
const base=path.dirname(path.dirname(require.resolve('netmd-js/package.json')));
const {WebUSB}=require(path.join(base,'usb'));
const cmds=require(path.join(base,'netmd-js/dist/netmd-commands'));
const {DevicesIds,NetMD}=require(path.join(base,'netmd-js/dist/netmd'));
const {MDTrack,Wireformat,NetMDInterface}=require(path.join(base,'netmd-js/dist/netmd-interface'));
const {makeGetAsyncPacketIteratorOnWorkerThread}=require(path.join(base,'netmd-js/dist/node-encrypt-worker'));
const core=require('./core');
const recovery=require('./recovery');
const comparison=require('./compare');
const {timeToFrames}=require(path.join(base,'netmd-js/dist/utils'));
let md,stop=false,lastProgress=Date.now(),stalled=false;
const emit=(type,data={})=>{lastProgress=Date.now();stalled=false;process.send?.({type,...data})};
process.on('message',m=>{if(m.stop)stop=true});
async function timeout(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Device did not respond. Close other NetMD clients and check the Walkman display; no automatic retry was made.')),ms)})]);}finally{clearTimeout(timer)}}
async function snapshot(){
  emit('progress',{message:'Checking disc readiness…'});
  const status=await timeout(cmds.getDeviceStatus(md),15000);
  if(status.state==='readingTOC')throw Error('Walkman is reading or saving its TOC. Wait for its display to finish, then reload.');
  if(!status.discPresent)throw Error('No readable disc detected. Check the Walkman display.');
  if(status.state==='unknown')throw Error('Walkman reports an unknown disc state. Check for READ ERR or TOC Edit before reconnecting.');
  emit('progress',{message:'Reading disc contents…'});
  const count=await timeout(md.getTrackCount(),15000);let disc;
  if(count===0){
    // An actually blank disc has no title or group metadata to read.
    const flags=await timeout(md.getDiscFlags(),15000);
    const [used,total,left]=await timeout(md.getDiscCapacity(),15000);
    disc={title:'',fullWidthTitle:'',writable:!!(flags&0x10),writeProtected:!!(flags&0x40),used:timeToFrames(used),total:timeToFrames(total),left:timeToFrames(left),trackCount:0,groups:[]};
  }else{
    try{disc=await timeout(cmds.listContent(md),60000)}catch(e){if(e.message.includes('Rejected - 0a180602201801000030000a00'))throw Error('Walkman rejected the disc-title read. No recording started. Let its display settle, then disconnect and reload the disc.');throw e;}
  }
  if(disc.total<60*512)throw Error('Walkman returned invalid disc capacity. This is not a confirmed usable blank disc.');
  return {disc,status,device:md.netMd.getDeviceName(),message:'Disc loaded. Ready to prepare your queue.'};
}
async function main(job){
  if(job.action==='prepare'){
    if(!['sp','lp2'].includes(job.mode))throw Error('Select SP or LP2');
    let count=0;
    for(const t of job.tracks){if(stop)break;const dir=path.join(__dirname,'cache','prepare-'+Date.now());try{const p=await core.probe(t.file);await core.encoded(p,job.mode,dir,hit=>emit('progress',{message:(hit?'Using cached audio: ':'Encoding locally: ')+p.title,phase:'encoding'}));count++;}finally{fs.rmSync(dir,{recursive:true,force:true})}}
    emit('result',{message:`${count} song(s) prepared in the local encoding cache. No disc was accessed.`});return;
  }
  const usb=new WebUSB({allowedDevices:DevicesIds.map(x=>({vendorId:x.vendorId,productId:x.deviceId})),deviceTimeout:15000});
  emit('progress',{message:'Connecting to Walkman…'});
  let device;
  try{device=await timeout(usb.requestDevice({filters:DevicesIds.map(x=>({vendorId:x.vendorId,productId:x.deviceId}))}),15000)}catch(e){throw Error('Cannot access the Walkman. Close the Web MiniDisc website and other NetMD apps, then reconnect USB and reload the disc. '+e.message)}
  // Keep the handle before initialization so a timeout can release USB in finally.
  md=new NetMDInterface(new NetMD(device));
  emit('progress',{message:'Walkman found. Initializing USB connection…'});
  await timeout(md.netMd.init(),30000);
  if(job.action==='playback'){
    const actions={play:()=>md.play(),pause:()=>md.pause(),stop:()=>md.stop(),previous:()=>md.previousTrack(),next:()=>md.nextTrack()};
    if(!actions[job.command])throw Error('Unsupported playback command');
    if(job.track!==undefined){if(!Number.isInteger(job.track)||job.track<0||job.track>253)throw Error('Invalid track index');await timeout(md.gotoTrack(job.track),15000);}
    await timeout(actions[job.command](),15000);
    const status=await timeout(cmds.getDeviceStatus(md),15000);
    emit('result',{status,device:md.netMd.getDeviceName(),message:`Walkman playback: ${status.state}. Disc audio plays through the Walkman's headphone output.`});return;
  }
  if(job.action==='inspect'){emit('result',await snapshot());return;}
  const before=await snapshot();
  if(job.action==='diff'){
    const queue=[];for(const t of job.tracks){const p=await core.probe(t.file);p.title=core.cleanTitle(t.title||p.title);queue.push(p)}
    emit('result',{...before,comparison:comparison.diff(queue,before.disc),comparisonSignature:require('./queue-sync').signature(job.tracks),message:'Queue compared with the disc. Confirmed matches are removed from the queue; duration conflicts require review.'});return;
  }
  if(job.action==='resume-check'){emit('result',{...before,recovery:recovery.reconcile(recovery.load(),before.disc)});return;}
  if(!['ready','discBlank','readyForTransfer'].includes(before.status.state))throw Error(`Device is not ready: ${before.status.state}. Stop playback and check the Walkman display.`);
  if(!before.disc.writable||before.disc.writeProtected)throw Error('Disc is not writable');
  if(job.action==='erase'){
    require('./erase').validate(before.disc,job.expectedDisc,job.confirmation);
    emit('progress',{message:'Erasing disc. Keep power connected and leave the lid closed.',phase:'erase'});
    await md.eraseDisc();
    const after=await snapshot();
    if(after.disc.trackCount!==0)throw Error('Erase was not verified. Check the Walkman; no automatic retry was made.');
    emit('result',{...after,message:'Erase acknowledged; device reports zero tracks. Wait for TOC Edit / Data Save to finish, then reinsert and reload to confirm persistence.'});return;
  }
  if(job.action==='rename'){
    if(!job.title||job.title.length>120)throw Error('Disc title must contain 1–120 characters');
    await timeout(cmds.renameDisc(md,core.cleanTitle(job.title)),45000);
    emit('result',{...(await snapshot()),message:'Title acknowledged. Let TOC Edit finish before disconnecting.'});return;
  }
  if(!['burn','resume'].includes(job.action))throw Error('Unknown device action');
  let saved=null,offset=0;
  if(job.action==='resume'){
    saved=recovery.load();const plan=recovery.reconcile(saved,before.disc);
    if(plan.review.length&&!job.reviewed)throw Error('Listen to the unconfirmed last track, then explicitly confirm resume.');
    job.mode=saved.mode;job.tracks=plan.remaining;offset=plan.completed;
    if(!job.tracks.length){emit('result',{...before,message:'All saved-session tracks are already present. Nothing was recorded.'});return;}
  }
  const tracks=[];
  for(const t of job.tracks){const p=await core.probe(t.file);p.title=core.cleanTitle(t.title||p.title);tracks.push(p);}
  core.validateQueue(tracks,before.disc,job.mode);
  const titleBudget=cmds.getRemainingCharactersForTitles(before.disc).halfWidth;
  const titleUse=tracks.reduce((n,t)=>n+Math.ceil(t.title.length/7)*7,0);
  if(titleUse>titleBudget)throw Error('Not enough title space on this disc. Shorten the queued titles.');
  if(cmds.countTracksInDisc(before.disc)+tracks.length>254)throw Error('The queue exceeds the MiniDisc track limit');
  if(!saved)saved=recovery.begin(before.disc,tracks,job.mode);
  const expected=cmds.countTracksInDisc(before.disc);let completed=0;
  for(let i=0;i<tracks.length&&!stop;i++){
    const t=tracks[i],dir=path.join(__dirname,'cache',`${Date.now()}-${i}`);
    emit('progress',{message:`Encoding locally: ${t.title}`,index:i,total:tracks.length,percent:0,phase:'encoding'});
    let enc;
    try {
      const {data}=await core.encoded(t,job.mode,dir,hit=>emit('progress',{message:(hit?'Using cached audio: ':'Encoding locally: ')+t.title,index:i,total:tracks.length,phase:'encoding'}));
      if(stop)break;
      const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
      enc=new Worker(path.join(base,'netmd-js/dist/node-encrypt-worker.js'));
      const iterator=makeGetAsyncPacketIteratorOnWorkerThread(enc);
      const track=new MDTrack(t.title,job.mode==='lp2'?Wireformat.lp2:Wireformat.pcm,buffer,0x100000,'',iterator);
      emit('progress',{message:`Transferring: ${t.title}`,index:i,total:tracks.length,percent:0,phase:'transfer'});
      saved.tracks[offset+i].state='writing';recovery.save(saved);
      await cmds.download(md,track,p=>emit('progress',{message:`Transferring: ${t.title}`,index:i,total:tracks.length,percent:Math.floor(p.writtenBytes/p.totalBytes*100),phase:'transfer'}));
      emit('progress',{message:'Transfer acknowledged. Checking disc contents…',index:i,total:tracks.length,percent:100,phase:'checking'});
      const check=await timeout(cmds.listContent(md),30000);
      if(cmds.countTracksInDisc(check)!==expected+completed+1)throw Error('Track-count verification failed. Check the disc before retrying.');
      const added=cmds.getTracks(check).at(-1);
      if(added.title!==t.title||Math.abs(added.duration/512-t.duration)>2)throw Error('Recorded title or duration could not be verified. Check the disc before resuming.');
      saved.tracks[offset+i].state='acknowledged';recovery.save(saved);
      completed++;emit('track',{file:t.file,title:t.title,completed});
    }finally{if(enc)await enc.terminate();fs.rmSync(dir,{recursive:true,force:true});}
  }
  emit('result',{...(await snapshot()),completed,message:`${completed} track(s) acknowledged by the Walkman. Wait for TOC Edit/Data Save to finish, then reload the disc. Persistence after reinsertion has not been tested.`});
}
setInterval(()=>{if(!stalled&&Date.now()-lastProgress>90000){stalled=true;process.send?.({type:'stalled',message:'No progress for 90 seconds. Check the Walkman display. Keep power connected; the app will not retry or interrupt a possible TOC save.'})}},5000).unref();
process.once('message',async job=>{
  let failed=false;
  try{await main(job)}catch(e){failed=true;emit('error',{message:e.message})}
  finally{if(md)try{await timeout(md.netMd.device.close(),5000)}catch(_){};process.exit(failed?1:0)}
});
