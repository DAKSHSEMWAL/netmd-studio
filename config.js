const fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const configPath=path.join(__dirname,'config.json');
const user=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const root=path.resolve(process.env.MUSIC_ROOT||user.musicRoot||path.join(os.homedir(),'Music'));
function binary(envKey,setting,name,required=true){
  const specified=process.env[envKey]||user[setting];if(specified)return path.resolve(specified);
  const local=path.join(__dirname,'tools',process.platform==='win32'?name+'.exe':name);if(fs.existsSync(local))return local;
  const result=spawnSync(process.platform==='win32'?'where.exe':'which',[name],{encoding:'utf8',windowsHide:true});
  if(result.status===0)return result.stdout.trim().split(/\r?\n/)[0];
  if(required)throw Error(`Install ${name} and add it to PATH, or set ${envKey} in your environment/config.json.`);return null;
}
module.exports={root,ffmpeg:binary('FFMPEG_PATH','ffmpegPath','ffmpeg'),ffprobe:binary('FFPROBE_PATH','ffprobePath','ffprobe'),encoder:binary('ATRACDENC_PATH','atracdencPath','atracdenc',false)};
