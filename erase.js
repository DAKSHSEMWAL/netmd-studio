const crypto=require('crypto');
function fingerprint(d){return crypto.createHash('sha256').update(JSON.stringify({title:d.title,total:d.total,tracks:d.groups.flatMap(g=>g.tracks.map(t=>[t.title,t.duration,t.encoding]))})).digest('hex');}
function validate(d,expected,confirmation){if(confirmation!=='ERASE')throw Error('Type ERASE to confirm deleting every track.');if(!d||!d.writable||d.writeProtected)throw Error('Load a writable disc first.');if(typeof expected!=='string'||expected!==fingerprint(d))throw Error('Disc contents changed. Reload the disc and confirm again.');}
module.exports={fingerprint,validate};
