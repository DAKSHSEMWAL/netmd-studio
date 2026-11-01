const fs=require('fs'),path=require('path'),crypto=require('crypto');
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function cached({source,mode,tools,root,encode,onStatus=()=>{}}){
  if(!['sp','lp2'].includes(mode))throw Error('Invalid encoding mode');
  const sourceHash=await hash(source),toolHashes=[];for(const tool of tools)toolHashes.push(await hash(tool));
  const key=crypto.createHash('sha256').update(JSON.stringify({version:1,sourceHash,mode,tools:toolHashes,rate:44100,channels:2,format:mode==='sp'?'s16be':'atrac3-132300'})).digest('hex');
  fs.mkdirSync(root,{recursive:true});const raw=path.join(root,key+'.bin'),meta=path.join(root,key+'.json');
  try{const m=JSON.parse(fs.readFileSync(meta,'utf8'));if(m.key===key&&m.bytes>0&&fs.statSync(raw).size===m.bytes&&await hash(raw)===m.sha256){onStatus(true);return {data:fs.readFileSync(raw),hit:true,key}}}catch(_){}
  // Windows cannot reliably rename over an existing file. Only invalid entries reach here.
  for(const file of [meta,raw])if(fs.existsSync(file))fs.unlinkSync(file);
  onStatus(false);const data=await encode();if(!Buffer.isBuffer(data)||!data.length)throw Error('Cannot cache empty audio');
  if(await hash(source)!==sourceHash)throw Error('Source audio changed during encoding. No cache entry was saved.');
  const suffix='.'+crypto.randomUUID()+'.tmp',rawTemp=raw+suffix,metaTemp=meta+suffix;
  try{fs.writeFileSync(rawTemp,data,{flush:true});fs.writeFileSync(metaTemp,JSON.stringify({key,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),mode,sourceHash}),{flush:true});fs.renameSync(rawTemp,raw);fs.renameSync(metaTemp,meta);}finally{for(const file of [rawTemp,metaTemp])if(fs.existsSync(file))fs.unlinkSync(file)}
  return {data,hit:false,key};
}
module.exports={cached,hash};
