(function(root){
  function signature(queue){return JSON.stringify(queue.map(t=>[t.file,t.title,t.duration]));}
  function apply(queue,result,expected){
    if(signature(queue)!==expected||queue.length!==result.length)return null;
    if(!result.every((t,i)=>t.file===queue[i].file))return null;
    const keep=result.map(t=>!['present','queue-duplicate'].includes(t.status));
    return {queue:queue.filter((_,i)=>keep[i]),rows:result.filter((_,i)=>keep[i]),removed:keep.filter(v=>!v).length};
  }
  const api={signature,apply};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.queueSync=api;
})(globalThis);
