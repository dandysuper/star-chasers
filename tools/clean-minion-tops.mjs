import sharp from 'sharp';
import fs from 'node:fs/promises';
const path='public/assets/v2/v2';
const atlas=JSON.parse(await fs.readFile(path+'.json','utf8'));
const {data,info}=await sharp(path+'.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
let removed=0, cropped=0;
for(const [name,item] of Object.entries(atlas.frames)) {
 if(!name.startsWith('minion_')) continue;
 const f=item.frame, seen=new Uint8Array(f.w*f.h), groups=[];
 const alpha=(i)=>data[((f.y+Math.floor(i/f.w))*info.width+f.x+i%f.w)*4+3];
 for(let i=0;i<seen.length;i++) if(!seen[i] && alpha(i)>8) {
  const cells=[i];seen[i]=1; let minY=f.h,maxY=0;
  for(let k=0;k<cells.length;k++) {const at=cells[k],x=at%f.w,y=Math.floor(at/f.w);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let yy=Math.max(0,y-1);yy<=Math.min(f.h-1,y+1);yy++) for(let xx=Math.max(0,x-1);xx<=Math.min(f.w-1,x+1);xx++){const j=yy*f.w+xx;if(!seen[j]&&alpha(j)>8){seen[j]=1;cells.push(j);}}
  }
  groups.push({cells,minY,maxY});
 }
 groups.sort((a,b)=>b.cells.length-a.cells.length);const main=groups[0]; if(!main) continue;
 for(const g of groups.slice(1)) if(g.maxY<main.minY && g.cells.length<main.cells.length*0.03) {
  for(const i of g.cells) data[((f.y+Math.floor(i/f.w))*info.width+f.x+i%f.w)*4+3]=0;
  removed+=g.cells.length;
 }
 let top=0;while(top<f.h && !Array.from({length:f.w},(_,x)=>alpha(top*f.w+x)).some(a=>a>8))top++;
 if(top>0&&top<f.h){f.y+=top;f.h-=top;item.sourceSize.h=f.h;item.spriteSourceSize.h=f.h;cropped++;}
}
await fs.writeFile(path+'.png',await sharp(data,{raw:info}).png().toBuffer());
await fs.writeFile(path+'.json',JSON.stringify(atlas,null,1)+'\n');
console.log({removed,cropped});
