const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILE=process.env.NETMD_SESSION_FILE||path.join(__dirname,'recording-session.json');
const tracks=d=>d.groups.flatMap(g=>g.tracks).map(t=>({title:t.title||'',duration:t.duration,encoding:t.encoding}));
function save(s){s.updated=new Date().toISOString();fs.writeFileSync(FILE+'.tmp',JSON.stringify(s,null,2),{flush:true});fs.renameSync(FILE+'.tmp',FILE);}
function load(){if(!fs.existsSync(FILE))return null;return JSON.parse(fs.readFileSync(FILE,'utf8'));}
function begin(disc,queue,mode){const s={version:1,id:crypto.randomUUID(),baseline:{title:disc.title,total:disc.total,tracks:tracks(disc)},mode,tracks:queue.map(t=>({...t,state:'pending'}))};save(s);return s;}
function reconcile(s,disc){
  if(!s||s.version!==1)throw Error('No saved recording session is available.');
  const actual=tracks(disc),base=s.baseline;
  if(base.title!==disc.title||Math.abs(base.total-disc.total)>512||actual.length<base.tracks.length)throw Error('Disc does not match the saved session. Resume is blocked.');
  const same=(a,b)=>a.title===b.title&&a.encoding===b.encoding&&Math.abs(a.duration-b.duration)<=512;
  if(!base.tracks.every((t,i)=>same(t,actual[i])))throw Error('Existing disc tracks changed. Resume is blocked.');
  const extra=actual.slice(base.tracks.length);
  if(extra.length>s.tracks.length)throw Error('Unexpected tracks were added to the disc. Resume is blocked.');
  const review=[];
  extra.forEach((t,i)=>{const q=s.tracks[i];if(t.title!==q.title||t.encoding!==(s.mode==='lp2'?146:144)||Math.abs(t.duration/512-q.duration)>2)throw Error(`Track ${base.tracks.length+i+1} is incomplete or does not match. Inspect it before resuming; no tracks were erased.`);if(q.state!=='acknowledged')review.push(base.tracks.length+i+1)});
  return {completed:extra.length,remaining:s.tracks.slice(extra.length),review,mode:s.mode,total:s.tracks.length,message:review.length?'A track is present without a saved completion acknowledgment. Listen to it before confirming resume.':'Disc contents checked. Missing songs will restart from the beginning of the song.'};
}
module.exports={load,save,begin,reconcile,FILE};
