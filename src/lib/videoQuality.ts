/** Camera capture presets; actual hardware may provide a smaller resolution. */
export type CameraQuality = 'economy' | 'standard' | 'hd' | 'full-hd';
const presets: Record<CameraQuality,{width:number;height:number;fps:number}>={
  economy:{width:640,height:360,fps:15},standard:{width:960,height:540,fps:24},
  hd:{width:1280,height:720,fps:30},'full-hd':{width:1920,height:1080,fps:30},
};
export function cameraVideoConstraints(quality:CameraQuality,deviceId?:string):MediaTrackConstraints{
  const {width,height,fps}=presets[quality];
  return {...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'user'}}),
    width:{ideal:width},height:{ideal:height},frameRate:{ideal:fps,max:fps}};
}
export function videoEncodingFromTrack(track:MediaStreamTrack,isScreen=false){
  const settings=track.getSettings?.()||{};
  const pixels=Number(settings.width||1280)*Number(settings.height||720);
  const fps=Math.max(1,Math.min(30,Number(settings.frameRate||(isScreen?15:24))));
  const maxBitrate=isScreen?(pixels>=1920*1080?3_000_000:1_800_000)
    :pixels>=1920*1080?3_200_000:pixels>=1280*720?1_900_000:pixels>=960*540?1_100_000:550_000;
  return {maxBitrate,maxFramerate:fps};
}
export function cameraResolutionLabel(track:MediaStreamTrack|undefined):string{
  if(!track)return 'Caméra indisponible';
  const {width,height}=track.getSettings?.()||{};
  return width&&height?`${width} × ${height}`:'Résolution automatique';
}
