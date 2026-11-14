// Reference-led, compressed Mawgan Porth landscape. x: north -> south;
// z: village -> Atlantic. Control points follow the user's aerial comparison.
// The full landscape and the playable bed share this profile: no box-wall skirt.
import { Noise2D } from './noise.js?v=112';
const noise = new Noise2D(5827);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const smooth = (a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function profile(points,z) {
  if(z<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(z<=points[i][0]){
    const a=points[i-1],b=points[i],t=(z-a[0])/(b[0]-a[0]);
    const prev=points[Math.max(0,i-2)][1],next=points[Math.min(points.length-1,i+1)][1];
    return clamp(a[1]+.5*t*(b[1]-prev+t*(2*prev-5*a[1]+4*b[1]-next+t*(3*(a[1]-b[1])+next-prev))),Math.min(a[1],b[1]),Math.max(a[1],b[1]));
  }
  return points.at(-1)[1];
}
// Distinct headlands flank sand which opens out toward the sea. The south
// side leaves a low river/road approach, rather than a tall cliff at the inlet.
const north = [[-100,28],[-20,34],[0,32],[18,28],[35,22],[52,15],[70,6],[85,0],[98,-14],[112,-65]];
const south = [[-100,119],[-20,111],[0,110],[20,113],[38,111],[55,114],[73,112],[86,114],[99,129],[112,175]];
export function bayEdges(z) {
  const r=noise.fbm(z*.14,12,2);
  return [profile(north,z)+r*1.9+noise.fbm(z*.045,83,2)*2.8,profile(south,z)+r*1.5+noise.fbm(z*.06,124,2)*2.3];
}
export function mawganStream(z) {
  return profile([[-100,102],[0,101],[14,101.5],[29,98.5],[44,100],[61,98],[77,94],[95,91],[140,89]],z);
}
export function mawganHeight(x,z) {
  const [left,right]=bayEdges(z);
  const margin=Math.max(left-x,x-right);
  const rock=smooth(-1,5,margin)*smooth(-12,35,z);
  const seaFade=1-smooth(93,122,z);
  const broad=noise.fbm(x*.024,z*.024,3);
  const crag=noise.fbm(x*.24,z*.18,2);
  const northSide=x<(left+right)*.5;
  const plateau=(northSide?10:9)+broad*1.8+Math.sin(z*.045)*.8;
  const coastHeight=(plateau+crag*.9*smooth(-1,4,margin))*seaFade;
  const beach=(83+4*Math.cos((x-57)/65*Math.PI*.5)-z)*.047 + noise.fbm(x*.13,z*.12,2)*.08;
  const duneZ=profile([[0,30],[25,26],[50,21],[75,17],[105,10],[150,0]],x);
  const inland=smooth(duneZ+9,duneZ-3,z);
  const valley=1-smooth(8,32,Math.abs(x-mawganStream(z)));
  const hinterland=3.8+(1-valley)*(8+broad*4)*smooth(20,-55,z);
  const dune=.9*Math.exp(-Math.pow((z-duneZ)/4,2))*(1-valley*.8);
  let h=beach*(1-inland)+hinterland*inland+dune;
  h=h*(1-rock)+coastHeight*rock;
  if(z>100)h=Math.min(h,-1-(z-100)*.1+coastHeight*rock);
  // A continuously descending bed; no row-wise corrective cliffs are needed.
  const d=Math.abs(x-mawganStream(z));
  const channel=1-smooth(1.1,3.2,d);
  const channelBed=2.35-z*.043;
  if(z<103)h=h*(1-channel)+Math.min(h,channelBed)*channel;
  return h;
}
export function mawganHardness(x,z) {
  const [a,b]=bayEdges(z);
  return .08+.9*smooth(-2,0,Math.max(a-x,x-b));
}
export function mawganColour(x,z,h,slope,wet=0,disturbed=0) {
  const [a,b]=bayEdges(z);
  const margin=Math.max(a-x,x-b);
  const inland=1-smooth(12,33,z);
  const top=smooth(5.5,8.5,h)*(1-smooth(.32,1.1,slope));
  const grass=Math.max(inland*(1-smooth(.4,1.4,slope)),top);
  const stone=Math.max(smooth(-2,1,margin),smooth(.6,1.2,slope)*smooth(4,8,h))*(1-grass);
  const n=noise.fbm(x*.12,z*.1,2)*.5+.5;
  const sand=[.69,.57,.37], turf=[.16+n*.09,.23+n*.09,.08+n*.035], slate=[.065+n*.045,.075+n*.045,.08+n*.045];
  return sand.map((v,i)=>((v*(1-grass)+turf[i]*grass)*(1-stone)+slate[i]*stone)*(1-clamp(wet,0,1)*.32)*(1-disturbed*.14));
}
