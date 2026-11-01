const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {fork}=require('child_process');
const core=require('./core');
const recovery=require('./recovery');
const erase=require('./erase');
const PORT=Number(process.env.NETMD_PORT||17892),origin=`http://127.0.0.1:${PORT}`,token=crypto.randomBytes(24).toString('hex');
let child=null,job={state:'idle',message:'Ready. Load a disc to begin.',events:[]},disc=null;
const cache=new Map();
function library(dir=core.ROOT){let result=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.')||e.name==='NetMD Studio')continue;const p=path.join(dir,e.name);if(e.isDirectory())result.push(...library(p));else if(/\.(flac|wav|mp3|m4a|ogg|aac)$/i.test(p))result.push({file:path.relative(core.ROOT,p),name:e.name.replace(/\.[^.]+$/,''),folder:path.relative(core.ROOT,dir)||'Music'});}return result;}
function start(data){
  if(child)throw Error('A device operation is already running');
  if(data.action==='inspect')disc=null;
  job={state:'working',message:'Connecting…',events:[],completed:[]};
  child=fork(path.join(__dirname,'device-worker.js'),[],{silent:true,windowsHide:true});
  const current=child;
  current.on('message',m=>{job.events.push({...m,time:new Date().toISOString()});job.events=job.events.slice(-150);if(m.message)job.message=m.message;if(m.type==='progress')Object.assign(job,m,{state:'working'});if(m.type==='stalled')job.state='stalled';if(m.type==='track')job.completed.push(m.file);if(m.type==='result'){if(m.disc)disc=m;else if(disc)Object.assign(disc,{status:m.status});job.state='done';}if(m.type==='error'){disc=null;job.state='error';}});
  current.stderr.on('data',d=>{job.diagnostic=String(d).slice(-4000)});
  current.on('error',e=>{job.state='error';job.message=e.message});
  current.on('exit',()=>{if(child===current)child=null;if(['working','stalled'].includes(job.state)){job.state='error';job.message='Device client ended without confirmation. Check the Walkman.';}});
  current.send(data);
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==`127.0.0.1:${PORT}`){res.writeHead(403);return res.end('Invalid host')}
    if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replace('__TOKEN__',token).replace('__QUEUE_SYNC__',fs.readFileSync(path.join(__dirname,'queue-sync.js'),'utf8')));}
    if(req.method==='GET'&&req.url.startsWith('/api/audio?')){
      const url=new URL(req.url,origin);
      if(url.searchParams.get('token')!==token)return json(res,403,{error:'Invalid session'});
      const file=core.safeAudio(url.searchParams.get('file')),size=fs.statSync(file).size;
      const types={'.flac':'audio/flac','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg'};
      let start=0,end=size-1,status=200;
      if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end()}start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end()}status=206;}
      res.writeHead(status,{'Content-Type':types[path.extname(file).toLowerCase()],'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(status===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
      const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    if(req.headers['x-app-token']!==token)return json(res,403,{error:'Invalid session'});
    if(req.method==='GET'&&req.url==='/api/state')return json(res,200,{job,disc,busy:!!child,savedSession:!!recovery.load(),eraseFingerprint:disc?erase.fingerprint(disc.disc):null});
    if(req.method==='GET'&&req.url==='/api/library')return json(res,200,library());
    if(req.method!=='POST')return json(res,404,{error:'Not found'});
    if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Invalid origin'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000)throw Error('Request too large')}
    const data=JSON.parse(body||'{}');
    if(req.url==='/api/probe'){const result=[];if(!Array.isArray(data.files)||data.files.length>255)throw Error('Select up to 255 audio files');for(const f of data.files){const key=String(f),stat=fs.statSync(path.resolve(core.ROOT,key));let t=cache.get(key);if(!t||t.stamp!==stat.mtimeMs){t={...(await core.probe(key)),stamp:stat.mtimeMs};cache.set(key,t)}result.push(t)}return json(res,200,result)}
    if(req.url==='/api/disconnect'){
      if(child)return json(res,409,{error:'Wait for the active device operation to finish before disconnecting.'});
      // Each worker closes its USB handle before exiting; no device command is needed here.
      disc=null;
      job={state:'disconnected',message:'Studio disconnected. USB access is released. Wait for TOC Edit / Data Save to finish before unplugging the Walkman.',events:[],completed:[]};
      return json(res,200,{ok:true});
    }
    if(req.url==='/api/inspect')start({action:'inspect'});
    else if(req.url==='/api/diff'||req.url==='/api/prepare'){
      if(!Array.isArray(data.tracks)||!data.tracks.length||data.tracks.length>254)throw Error('Select 1–254 queued songs.');
      if(!['sp','lp2'].includes(data.mode))throw Error('Select SP or LP2');
      start({action:req.url==='/api/diff'?'diff':'prepare',tracks:data.tracks,mode:data.mode});
    }
    else if(req.url==='/api/forget-session'){
      if(child)throw Error('Wait for the active operation to finish.');
      if(fs.existsSync(recovery.FILE))fs.unlinkSync(recovery.FILE);
      return json(res,200,{ok:true});
    }
    else if(req.url==='/api/resume-check')start({action:'resume-check'});
    else if(req.url==='/api/resume')start({action:'resume',reviewed:data.reviewed===true});
    else if(req.url==='/api/playback'){
      if(!['play','pause','stop','previous','next'].includes(data.command))throw Error('Invalid playback command');
      if(data.track!==undefined&&(!Number.isInteger(data.track)||data.track<0||data.track>253))throw Error('Invalid track index');
      start({action:'playback',command:data.command,track:data.track});
    }
    else if(req.url==='/api/rename')start({action:'rename',title:data.title});
    else if(req.url==='/api/erase'){erase.validate(disc?.disc,data.expectedDisc,data.confirmation);start({action:'erase',expectedDisc:data.expectedDisc,confirmation:data.confirmation});}
    else if(req.url==='/api/burn'){
      const previous=recovery.load();
      if(previous&&previous.tracks.some(t=>t.state!=='acknowledged'))throw Error('An unfinished session is saved. Check and resume it, or discard its saved progress before starting a new queue.');
      if(!Array.isArray(data.tracks)||data.tracks.length>255)throw Error('Invalid queue');
      if(!['sp','lp2'].includes(data.mode))throw Error('Select SP or LP2');
      start({action:'burn',tracks:data.tracks,mode:data.mode});
    }else if(req.url==='/api/stop'){if(child)child.send({stop:true});job.message='Stopping after the current track. Keep power connected.'}
    else return json(res,404,{error:'Not found'});
    return json(res,202,{ok:true});
  }catch(e){json(res,400,{error:e.message})}
});
server.on('error',e=>{console.error(e.message);process.exit(1)});
server.listen(PORT,'127.0.0.1',()=>console.log(`NetMD Studio: ${origin}`));
