/* Tests for ocp-events-feed.gs.
 *
 *     node tools/apps-script/test/feed.test.js
 *
 * Apps Script cannot run locally, so harness.js stands in for SpreadsheetApp
 * with plain 2-D arrays. The fixture below is shaped like the real workbook:
 * label in column A, value merged across B:G, an INSTRUCTORS block underneath.
 *
 * The case that matters most is "refresh again (the destructive case)" — a
 * rebuild must never wipe a Ticket Link somebody typed in. */
const {Sheet,Book,makeContext}=require('./harness.js');

/* An EVENT tab shaped exactly like the real workbook: label in column A, the
   value merged across B:G (Sheets puts the value in the top-left cell), then
   an INSTRUCTORS header, a column-header row, then one row per person. */
function eventTab(name,o){
  const row=(label,v)=>[label,v,'','','','','',''];
  return new Sheet(name,[
    ['OAK CLIFF PILATES · '+o.name,'','','','','','',''],
    ['EVENT INFORMATION','','','','','','',''],
    row('Event Name',o.name),
    row('Location',o.location),
    row('Event Date',o.date),
    row('Date Status',o.dateStatus||'Confirmed'),
    row('Start Time',o.start),
    row('End Time',o.end||''),
    row('Format',o.format),
    row('Event Type',o.type),
    row('Capacity (max)',o.capacity||''),
    row('Target Attendance','whoever'),
    row('Event Goals','new members'),
    row('Event Description',o.description),
    row('Price',o.price),
    row('Discounts',o.discounts||''),
    ['','','','','','','',''],
    ['INSTRUCTORS','','','','','','',''],
    ['Name','Role','Pay Rate','Expectations / Scope','','','',''],
    ...(o.instructors||[]).map(p=>[p[0],p[1],p[2],p[3]||'','','','','']),
    ['','','','','','','',''],
    ['EVENT CREATIVE','','','','','','',''],
  ]);
}

const book=new Book([
  new Sheet('SETUP',[['notes','']]),
  new Sheet('DASHBOARD',[['roll-up','']]),
  eventTab('EVENT 01',{name:'Athena Event',location:'Lower Greenville',
    date:new Date(2026,8,26),start:new Date(2026,0,1,14,30),end:new Date(2026,0,1,17,0),
    format:'Reformer Class',type:'OCP Event',capacity:40,price:25,
    description:'30 minute class, special speaker, wellness vendors.',
    discounts:'Free for members',
    instructors:[['Tina Darling','Lead Instructor',100,'Lead the class, stay after.'],
                 ['Pepe Mendoza','Support',50,'']]}),
  eventTab('EVENT 02',{name:'Cold Club with HG Sply Co.',location:'Off Site',
    date:new Date(2026,8,20),start:new Date(2026,0,1,10,0),end:new Date(2026,0,1,13,0),
    format:'Mat Class',type:'Partner Event',capacity:120,price:50,
    description:'Rooftop mat class, breath work, then the plunge.',
    instructors:[['Amanda Lauro','Lead Instructor',200,'']]}),
  new Sheet('SITE CONFIG',[
    ['# config',''],['active_members',922],['member_goal',1000],
    ['goal_label','By December 31'],['updated','Sep 14, 2026']]),
]);

const ctx=makeContext(book);
let pass=0,fail=0;
const check=(label,got,want)=>{
  const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+label);
  if(!ok){console.log('        got :',JSON.stringify(got));console.log('        want:',JSON.stringify(want));}
  ok?pass++:fail++;
};

console.log('\n── build the feed tab ──');
const n=ctx.buildFeedTab();
check('two events written',n,2);

const feed=book.getSheetByName('WEBSITE FEED');
const grid=feed.getRange(1,1,feed.getLastRow(),feed.getLastColumn()).getValues();
const head=grid[0];
const col=name=>head.indexOf(name);
check('header row',head.slice(0,6),['Tab','Event','Date','Start','End','Date Status']);
check('sorted by date, soonest first',[grid[1][col('Event')],grid[2][col('Event')]],
  ['Cold Club with HG Sply Co.','Athena Event']);
const rowFor=(g,name)=>g.find(r=>r[col('Event')]===name);
const a1=rowFor(grid,'Athena Event');
check('date formatted',a1[col('Date')],'2026-09-26');
check('time formatted',a1[col('Start')],'2:30 PM');
check('price as money',a1[col('Price')],'$25');
check('instructors serialised',a1[col('Instructors')],
  'Tina Darling | Lead Instructor | $100 | Lead the class, stay after.\nPepe Mendoza | Support | $50');
check('ticket link starts empty',a1[col('Ticket Link')],'');

console.log('\n── a human types into the manual columns ──');
const athenaRowNo=grid.findIndex(r=>r[col('Event')]==='Athena Event')+1;
const coldRowNo=grid.findIndex(r=>r[col('Event')]==='Cold Club with HG Sply Co.')+1;
feed.getRange(athenaRowNo,col('Ticket Link')+1).setValue('https://app.arketa.co/oakcliffpilates/checkout/abc');
feed.getRange(athenaRowNo,col('Call Time')+1).setValue('15 min early');
feed.getRange(coldRowNo,col('Show On Site')+1).setValue('No');

console.log('\n── refresh again (the destructive case) ──');
ctx.buildFeedTab();
const g2=feed.getRange(1,1,feed.getLastRow(),feed.getLastColumn()).getValues();
const athena=g2.find(r=>r[col('Event')]==='Athena Event');
const cold=g2.find(r=>r[col('Event')]==='Cold Club with HG Sply Co.');
check('ticket link survives',athena[col('Ticket Link')],'https://app.arketa.co/oakcliffpilates/checkout/abc');
check('call time survives',athena[col('Call Time')],'15 min early');
check('show-on-site survives',cold[col('Show On Site')],'No');
check('generated column still regenerated',athena[col('Location')],'Lower Greenville');

console.log('\n── an event is edited in its event tab ──');
book.getSheetByName('EVENT 01').getRange(4,2).setValue('Uptown');
ctx.buildFeedTab();
const g3=feed.getRange(1,1,feed.getLastRow(),feed.getLastColumn()).getValues();
const athena3=g3.find(r=>r[col('Event')]==='Athena Event');
check('edit picked up',athena3[col('Location')],'Uptown');
check('and the ticket link is still there',athena3[col('Ticket Link')],'https://app.arketa.co/oakcliffpilates/checkout/abc');

console.log('\n── serving the JSON ──');
ctx.TOKEN='test-token';
check('bad token refused',JSON.parse(ctx.doGet({parameter:{token:'wrong'}})).error,'Bad token.');
const out=JSON.parse(ctx.doGet({parameter:{token:'test-token'}}));
check('source is the feed tab',out.source,'WEBSITE FEED');
check('hidden event filtered out',out.events.map(e=>e.name),['Athena Event']);
check('config read',out.config.active_members,922);
const e=out.events[0];
check('date round-trips',e.date,'2026-09-26');
check('start round-trips',e.start,'2:30 PM');
check('call time round-trips',e.callTime,'15 min early');
check('ticket url round-trips',e.ticketUrl,'https://app.arketa.co/oakcliffpilates/checkout/abc');
check('instructors parsed back',e.instructors,[
  {name:'Tina Darling',role:'Lead Instructor',pay:'$100',scope:'Lead the class, stay after.'},
  {name:'Pepe Mendoza',role:'Support',pay:'$50',scope:''}]);

console.log('\n── no feed tab yet: falls back to the event tabs ──');
const book2=new Book(book.getSheets().filter(s=>s.getName()!=='WEBSITE FEED'));
const ctx2=makeContext(book2); ctx2.TOKEN='t';
const out2=JSON.parse(ctx2.doGet({parameter:{token:'t'}}));
check('fallback source',out2.source,'event tabs');
check('fallback still returns both',out2.events.length,2);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
