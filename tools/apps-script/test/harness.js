/* Minimal stand-ins for the Apps Script globals, backed by 2-D arrays, so the
   real ocp-events-feed.gs logic can be exercised in Node. */
const fs=require('fs'), vm=require('vm');

function colToIndex(s){let n=0;for(const ch of s)n=n*26+(ch.charCodeAt(0)-64);return n-1;}
function parseA1(a1){
  const [from,to]=a1.split(':');
  const m=/^([A-Z]+)(\d+)$/.exec(from), m2=/^([A-Z]+)(\d+)$/.exec(to||from);
  return {r:+m[2],c:colToIndex(m[1])+1,nr:+m2[2]-+m[2]+1,nc:colToIndex(m2[1])-colToIndex(m[1])+1};
}
const noop=new Proxy({},{get:()=>()=>noop});

class Sheet{
  constructor(name,grid){this.name=name;this.grid=grid.map(r=>r.slice());this.notes={};this.validation={};}
  getName(){return this.name;}
  getLastRow(){for(let r=this.grid.length-1;r>=0;r--)if(this.grid[r].some(v=>v!==''&&v!=null))return r+1;return 0;}
  getLastColumn(){let w=0;this.grid.forEach(r=>r.forEach((v,i)=>{if(v!==''&&v!=null)w=Math.max(w,i+1)}));return w;}
  _ensure(r,c){while(this.grid.length<r)this.grid.push([]);
    for(const row of this.grid)while(row.length<c)row.push('');}
  getRange(a,b,nr,nc){
    let r,c,rows,cols;
    if(typeof a==='string'){const p=parseA1(a);r=p.r;c=p.c;rows=p.nr;cols=p.nc;}
    else {r=a;c=b;rows=nr===undefined?1:nr;cols=nc===undefined?1:nc;}
    const sheet=this;
    const api={
      getValues(){sheet._ensure(r+rows-1,c+cols-1);
        return Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>{
          const v=sheet.grid[r-1+i]?.[c-1+j];return v===undefined?'':v;}));},
      getValue(){return api.getValues()[0][0];},
      setValues(v){sheet._ensure(r+rows-1,c+cols-1);
        v.forEach((row,i)=>row.forEach((val,j)=>{sheet.grid[r-1+i][c-1+j]=val;}));return api;},
      setValue(v){return api.setValues([[v]]);},
      setNote(t){sheet.notes[`${r},${c}`]=t;return api;},
      setDataValidation(v){sheet.validation[`${r},${c}`]=v;return api;},
      setNumberFormat:()=>api,setFontWeight:()=>api,setBackground:()=>api,setFontColor:()=>api,
      setVerticalAlignment:()=>api,setWrap:()=>api,merge:()=>api,
    };
    return api;
  }
  clear(){this.grid=[];return this;}
  setFrozenRows(){return this;} setFrozenColumns(){return this;} setColumnWidth(){return this;}
  insertRowAfter(r){this._ensure(r,1);this.grid.splice(r,0,new Array(this.grid[0]?.length||1).fill(''));return this;}
}

class Book{
  constructor(sheets){this.sheets=sheets;}
  getSheets(){return this.sheets;}
  getSheetByName(n){return this.sheets.find(s=>s.getName()===n)||null;}
  insertSheet(n){const s=new Sheet(n,[]);this.sheets.push(s);return s;}
  getSpreadsheetTimeZone(){return 'America/Chicago';}
  setActiveSheet(){return this;}
}

function makeContext(book){
  const alerts=[];
  const ctx={
    SpreadsheetApp:{
      getActive:()=>book,
      getUi:()=>({alert:m=>alerts.push(m),createMenu:()=>noop}),
      newDataValidation:()=>({requireValueInList:()=>({build:()=>'validation'})}),
    },
    Utilities:{formatDate:(d,z,f)=>{
      const p=n=>String(n).padStart(2,'0');
      if(f==='yyyy-MM-dd')return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
      if(f==='h:mm a'){let h=d.getHours();const ap=h<12?'AM':'PM';h=h%12||12;return `${h}:${p(d.getMinutes())} ${ap}`;}
      return d.toISOString();
    }},
    ContentService:{createTextOutput:t=>({setMimeType:()=>t}),MimeType:{JSON:'json'}},
    ScriptApp:{getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({everyHours:()=>({create:()=>{}})})}),deleteTrigger:()=>{}},
    console,
    // Share the host realm's Date: a vm context otherwise has its own, and
    // `value instanceof Date` would be false for fixture dates. Real Apps
    // Script has one realm, so this makes the harness match it.
    Date: Date, JSON: JSON, Math: Math, String: String, Number: Number, Array: Array, Object: Object,
  };
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  const script=process.argv[2]||require('path').join(__dirname,'..','ocp-events-feed.gs');
  vm.runInContext(fs.readFileSync(script,'utf8'),ctx);
  ctx.__alerts=alerts;
  return ctx;
}
module.exports={Sheet,Book,makeContext};
