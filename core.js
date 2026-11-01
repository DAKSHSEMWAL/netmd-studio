const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const comparison=require('./compare');
const encodingCache=require('./encoding-cache');
const config=require('./config');
const ROOT=config.root;
function find(dir, name) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir,e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) { const r = find(p,name); if(r) return r; }
  }
}
const {ffmpeg,ffprobe,encoder}=config;
function run(exe,args,timeout=600000) {
  return new Promise((resolve,reject)=>{
    const p=spawn(exe,args,{windowsHide:true});let out='',err='';
    const timer=setTimeout(()=>{p.kill();reject(Error('Audio conversion timed out'));},timeout);
    p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err=(err+d).slice(-12000));
    p.on('error',e=>{clearTimeout(timer);reject(e)});
    p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(err||`Process exited ${code}`))});
  });
}
function cleanTitle(s) {
  return s.replace(/^\s*\d{1,3}[\s._-]+/,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’‘]/g,"'").replace(/[—–]/g,'-').replace(/…/g,'...').replace(/[^\x20-\x7e]/g,'').trim();
}
function safeAudio(relative) {
  if(typeof relative!=='string') throw Error('Invalid audio path');
  const file=fs.realpathSync(path.resolve(ROOT,relative));
  if(!file.startsWith(ROOT+path.sep)||file.includes(path.sep+'.tools'+path.sep)||file.startsWith(__dirname+path.sep)||! /\.(flac|wav|mp3|m4a|ogg|aac)$/i.test(file)) throw Error('Select an audio file from the Music library');
  return file;
}
async function probe(relative) {
  const file=safeAudio(relative);
  const data=JSON.parse(await run(ffprobe,['-v','error','-show_entries','format=duration:format_tags=artist,title','-of','json',file],30000));
  const tags=data.format.tags||{};
  const artist=tags.artist||tags.ARTIST,title=tags.title||tags.TITLE;
  const label=artist&&title?`${title} - ${artist}`:path.basename(file,path.extname(file));
  const duration=Number(data.format.duration);
  if(!Number.isFinite(duration)||duration<=0)throw Error('Cannot determine audio duration');
  return {file:relative,title:cleanTitle(label),duration};
}
function requiredSP(tracks, mode) {
  // Round each song to NetMD audio frames, with a small allocation margin.
  return tracks.reduce((n,t)=>n+Math.ceil(t.duration*44100/1024)*1024/44100/(mode==='lp2'?2:1)+2,0);
}
function validateQueue(tracks,disc,mode) {
  if(!['sp','lp2'].includes(mode))throw Error('Unsupported recording mode');
  if(!tracks.length)throw Error('The queue is empty');
  if(!disc.writable||disc.writeProtected)throw Error('Disc is not writable or is write protected');
  if(requiredSP(tracks,mode)>disc.left/512)throw Error('The queue exceeds the remaining disc capacity');
  const used=new Set(disc.groups.flatMap(g=>g.tracks.map(t=>comparison.key(t.title))));
  for(const t of tracks){if(!t.title||t.title.length>120)throw Error('Each title must contain 1–120 printable characters');const key=comparison.key(t.title);if(used.has(key))throw Error(`Duplicate title: ${t.title}. Use Compare with disc before recording.`);used.add(key);}
}
async function encode(track,mode,directory) {
  fs.mkdirSync(directory,{recursive:true});
  const raw=path.join(directory,'audio.bin'),input=safeAudio(track.file);
  if(mode==='sp') {
    await run(ffmpeg,['-v','error','-xerror','-y','-i',input,'-vn','-ar','44100','-ac','2','-c:a','pcm_s16be','-f','s16be',raw]);
  } else {
    if(!encoder)throw Error('Configure ATRACDENC_PATH or atracdencPath for local LP2 encoding.');
    const wav=path.join(directory,'input.wav'),oma=path.join(directory,'audio.oma');
    await run(ffmpeg,['-v','error','-xerror','-y','-i',input,'-vn','-ar','44100','-ac','2','-c:a','pcm_s16le',wav]);
    await run(encoder,['-e','atrac3','-i',wav,'-o',oma]);
    const info=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-of','json',oma]));
    const stream=info.streams[0];
    if(stream.codec_name!=='atrac3'||Number(stream.sample_rate)!==44100||stream.channels!==2||Number(stream.bit_rate)!==132300)throw Error('Encoder did not produce standard LP2 ATRAC3');
    await run(ffmpeg,['-v','error','-y','-i',oma,'-map','0:a:0','-c:a','copy','-f','data',raw]);
    await run(ffmpeg,['-v','error','-xerror','-i',oma,'-f','null','-']);
  }
  const buffer=fs.readFileSync(raw);
  if(!buffer.length)throw Error('Encoder produced empty audio');
  return buffer;
}
async function encoded(track,mode,directory,onStatus){return encodingCache.cached({source:safeAudio(track.file),mode,tools:mode==='lp2'?[ffmpeg,encoder]:[ffmpeg],root:path.join(__dirname,'encoded-cache'),encode:()=>encode(track,mode,directory),onStatus});}
module.exports={ROOT,probe,encode,encoded,cleanTitle,validateQueue,requiredSP,run,safeAudio};
