/** Verificació sense dependències externes. Node >= 24. */
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) specifier = pathToFileURL(resolve(root, 'src', specifier.slice(2))).href;
    if ((specifier.startsWith('.') || specifier.startsWith('file:')) && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url) + '.ts')) specifier = url.href + '.ts';
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }) };
    return next(url, context);
  },
});
const lib = await import('../src/energy/lib/sips-consumption.ts');
const engine = await import('../src/energy/lib/sips-engine.ts');
const records = await import('../src/energy/lib/sips-record.ts');
const { sipsDiff } = await import('../src/core/sips-diff.ts');
const { costOffer } = await import('../src/energy/lib/market.ts');
// Registres reals verificats al portal: juliol 2025 – juny 2026. Febrer té dos trams.
const months = [
  [215,152,0,0,0,245], [0,0,196,118,0,285], [0,0,247,157,0,251],
  [0,0,0,349,337,334], [0,167.168,448.043,0,0,757.789], [346,520,0,0,0,758],
  [642,453,0,0,0,1072], [426,259,0,0,0,554], [0,407,277,0,0,573],
  [0,0,0,296,235,399], [0,0,0,248,178,370], [0,0,209,156,0,244],
];
const expected = [1629,1958.168,1377.043,1324,750,5842.789];
const summary = () => ({ Año1:2025, Mes1:7, Año12:2026, Mes12:6, EActiva:12881,
  EActivaMes: months.map(row=>row.reduce((a,b)=>a+b,0)),
  ...Object.fromEntries(expected.map((_,i)=>['EActivaMesP'+(i+1),months.map(row=>row[i])])) });
const read = (data=summary(), count=6) => lib.annualFromEasSummary(data,count,12881);
const cups = 'ES0031405844323001PD0F';
const cfg = { base:'https://portal.test', user:'test', pass:'test-only' };
function fakePortal({tariff='3.0TD', missingId=false, missingP6=false, expire=false, fail=false, otherSuffix=false}={}) {
  const calls=[]; let expired=false;
  const f=async(url,init)=> {
    calls.push({url,init});
    if(url.endsWith('/Account/Login/')) return new Response('<html/>',{headers:{'Set-Cookie':'CSRF-TOKEN=csrf-test; Path=/'}});
    if(url.endsWith('/Account/Login')) return new Response('{}',{headers:{'Set-Cookie':'.AspNetAuth=session-test; Path=/; HttpOnly'}});
    if(url.endsWith('/List')) return Response.json({Entities:[{...(!missingId?{Id:37986309}:{}),CUPS:otherSuffix?cups.slice(0,20)+'1P':cups,TipoEnergia:1,IdTarifaNombreTarifa:tariff,EActivaAnual:12881}],TotalCount:1});
    assert.equal(url, cfg.base+'/services/Core/PuntoSuministro/ResumenConsumosU12M');
    if(expire&&!expired){expired=true;return new Response('',{status:401});}
    if(fail) return new Response('',{status:503});
    const data=summary(); if(missingP6) delete data.EActivaMesP6;
    return Response.json(data);
  };
  return {calls,f};
}
test('3.0TD i 6.1TD tenen sis períodes; 2.0TD en té tres; gas no es tracta com a llum',()=>{
  for(const t of ['3.0TD','6.1TD','6.2TD','6.3TD','6.4TD']) assert.equal(lib.electricityPeriodCount(t),6);
  assert.equal(lib.electricityPeriodCount('2.0TD'),3); assert.equal(lib.electricityPeriodCount('RL.3'),null);
});
test('cas real 12.881 kWh: suma P1–P6, dates i traspàs al comparador',()=>{
  const r=read(); assert.equal(r.status,'complete'); assert.deepEqual(r.periods,expected); assert.equal(r.total,12881);
  assert.equal(r.from,'2025-07-01'); assert.equal(r.to,'2026-06-30');
  const c=lib.comparatorConsumption(r,'6.1TD'); assert.deepEqual(c.kwh,expected); assert.equal(c.days,365);
  assert.equal(c.kwhTotal,12881); assert.equal(r.lastAvailable,null);
});
test('un zero és vàlid; un camp absent no es converteix en zero',()=>{
  const data=summary(); data.EActivaMesP6=Array(12).fill(0); data.EActiva=7038.211;
  data.EActivaMes=months.map(row=>row.slice(0,5).reduce((a,b)=>a+b,0));
  assert.equal(read(data).periods[5],0); assert.equal(read(data).status,'complete');
  delete data.EActivaMesP6; const r=read(data); assert.equal(r.periods[5],null); assert.equal(r.status,'incomplete');
  assert.equal(lib.comparatorConsumption(r,'3.0TD'),null);
});
test('no confon decimals JSON amb milers',()=>{
  const data=summary(); data.EActivaMesP2=data.EActivaMesP2.map(String); assert.equal(read(data).periods[1],1958.168);
});
test('12 mesos obligatoris; null, negatius i valors no finits són incomplets',()=>{
  for(const value of [null,-1,Infinity,'abc']) {const d=summary(); d.EActivaMesP4[0]=value; assert.equal(read(d).status,'incomplete');}
  const d=summary(); d.EActivaMesP5.pop(); assert.equal(read(d).status,'incomplete');
});
test('finestres invàlides i totals discrepants impedeixen el traspàs silenciós',()=>{
  const d=summary(); d.Mes12=5; assert.equal(read(d).status,'incomplete');
  const e=summary(); e.EActiva=2258; assert.equal(read(e).status,'incomplete'); assert.match(read(e).warning,/EActiva/);
  const m=summary(); m.EActivaMes[0]+=100; assert.equal(read(m).status,'incomplete');
});
test('2.0TD: tres períodes, sense exigir P4–P6',()=>{
  const d=summary(); d.EActivaMes=months.map(row=>row.slice(0,3).reduce((a,b)=>a+b,0));d.EActiva=d.EActivaMes.reduce((a,b)=>a+b,0);
  for(let p=4;p<=6;p++)delete d['EActivaMesP'+p];
  const r=read(d,3);assert.equal(r.status,'complete');assert.equal(r.periods.length,3);
  assert.deepEqual(lib.comparatorConsumption(r,'2.0TD').kwh.slice(3),[null,null,null]);
  assert.equal(lib.comparatorConsumption(r,'6.1TD'),null);
});
test('finestra de 12 mesos amb any de traspàs: 366 dies',()=>{
  const d=summary(); d.Año1=2023;d.Mes1=3;d.Año12=2024;d.Mes12=2;
  assert.equal(lib.comparatorConsumption(read(d),'3.0TD').days,366);
});
test('petició real: URL, POST, ID dinàmic, CSRF, cookies i transmissió fins al comparador',async()=>{
  engine.__resetSession(); const p=fakePortal(); const r=await engine.sipsSearchRows({cups},cfg,p.f);
  const call=p.calls.find(c=>c.url.endsWith('/ResumenConsumosU12M'));
  assert.equal(call.init.method,'POST');assert.deepEqual(JSON.parse(call.init.body),{idPuntoSuministro:37986309});
  assert.equal(call.init.headers['X-CSRF-TOKEN'],'csrf-test');assert.match(call.init.headers.Cookie,/AspNetAuth/);
  assert.deepEqual(r.annualConsumptions[cups].periods,expected);
  const raw=records.recordFromRow(r.rows[0],r.rows[1]);
  const cache=records.withAnnualConsumption(records.cacheRowFromRecord(cups,raw,{source:'sips',sourceDetail:'Test'}));
  assert.deepEqual(cache.annual_consumption.periods,expected);
  assert.deepEqual(lib.comparatorConsumption(cache.annual_consumption,cache.tariff).kwh,expected);
  assert.equal(engine.FIELD_HEADERS.length,97);
});
test('6.1TD consulta també els sis períodes',async()=>{
  engine.__resetSession(); const p=fakePortal({tariff:'6.1TD'});const r=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.deepEqual(r.annualConsumptions[cups].periods,expected);
});
test('renova una sessió caducada durant la petició del resum',async()=>{
  engine.__resetSession();const p=fakePortal({expire:true});const r=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.equal(r.annualConsumptions[cups].status,'complete');assert.equal(p.calls.filter(c=>c.url.endsWith('/Account/Login')).length,2);
});
test('sense ID intern no es fa cap petició amb un ID inventat',async()=>{
  engine.__resetSession();const p=fakePortal({missingId:true});const r=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.equal(r.total,1);assert.equal(r.annualConsumptions[cups].status,'incomplete');
  assert.equal(p.calls.some(c=>c.url.endsWith('/ResumenConsumosU12M')),false);
});
test('error del resum conserva la cerca i avisa; no inventa períodes',async()=>{
  engine.__resetSession();const p=fakePortal({fail:true});const r=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.equal(r.total,1);assert.equal(r.annualConsumptions[cups].status,'incomplete');assert.equal(r.annualConsumptions[cups].total,null);
});
test('P6 absent impedeix declarar complet el resultat de 3.0TD',async()=>{
  engine.__resetSession();const p=fakePortal({missingP6:true});const r=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.equal(r.annualConsumptions[cups].periods[5],null);assert.equal(r.annualConsumptions[cups].status,'incomplete');
});
test('conserva el sufix 0F; no accepta un altre sufix amb la mateixa base',async()=>{
  engine.__resetSession();const p=fakePortal({otherSuffix:true});const r=await engine.sipsSearchRows({cups},cfg,p.f);assert.equal(r.total,0);
});
test('cerca per adreça no dispara una petició extra per a cadascun dels 50 CUPS',async()=>{
  engine.__resetSession();const p=fakePortal();await engine.sipsSearchRows({cp:'25001'},cfg,p.f);
  assert.equal(p.calls.some(c=>c.url.endsWith('/ResumenConsumosU12M')),false);
});
test('importador de comparatives protegeix consums manuals i de factura',()=>{
  const base={tariff:'3.0TD',powerKw:null,annualKwh:12881,retailer:null,address:null,cups};
  const incoming={...base,periodKwh:expected};
  for(const source of ['manual','factura']){
    const rows=sipsDiff({...base,periodKwh:[1,2,3,4,5,6],sources:{kwh:source}},incoming);
    const row=rows.find(r=>r.key==='periodKwh');assert.equal(row.defaultOn,false);assert.equal(row.protectedValue,true);
  }
  assert.equal(sipsDiff({...base,periodKwh:null,sources:{}},incoming).find(r=>r.key==='periodKwh').defaultOn,true);
});
test('històric real amb dos trams al febrer: deduplicació i cobertura',()=>{
  const history=months.map((v,i)=>({FechaInicio:new Date(Date.UTC(2025,6+i,1)).toISOString().slice(0,10),FechaFin:new Date(Date.UTC(2025,7+i,0)).toISOString().slice(0,10),...Object.fromEntries(v.map((k,p)=>['EActivaP'+(p+1),k]))}));
  const feb=history.splice(7,1)[0];
  history.push({...feb,FechaFin:'2026-02-11',EActivaP1:177,EActivaP2:119,EActivaP6:245}, {...feb,FechaInicio:'2026-02-12',EActivaP1:249,EActivaP2:140,EActivaP6:309});
  const r=lib.annualFromEasHistory([...history,history[0]],6,12881);assert.equal(r.status,'complete');assert.deepEqual(r.periods,expected);
});
test('comparador Energy Market: preus diferents P1–P6 i SAS sobre el consum real',()=>{
  const offer={id:'test',tarifa:'6.1TD',energia:[.2,.19,.18,.17,.16,.15],potencia:[0,0,0,0,0,0],sas:{applies:true,eurPerKWh:.01},servicios:[],alquilerEurMes:0,ieePct:0,ivaPct:0,validTo:'9999-12-31'};
  const supply={tarifa:'6.1TD',potContratada:[40,40,40,40,40,40]};
  const r=costOffer(offer,supply,{mode:'sips',annualKWh:12881,values:expected,label:'EAS'});
  assert.equal(r.quality,'exacto');assert.ok(Math.abs(r.energy-expected.reduce((s,v,i)=>s+v*offer.energia[i],0))<.0001);
  assert.ok(Math.abs(r.sas-128.81)<.0001);assert.equal(r.issues.length,0);
});
test('el raw conserva només el resultat numèric; mai cookies ni credencials',async()=>{
  engine.__resetSession();const p=fakePortal();const r=await engine.sipsSearchRows({cups},cfg,p.f);
  const text=JSON.stringify(r);assert.ok(!text.includes('csrf-test'));assert.ok(!text.includes('session-test'));assert.ok(!text.includes('test-only'));
});
test('emplenat automàtic: buits i dades SIPS es completen; manual i factura es conserven',()=>{
  assert.equal(lib.canAutofillConsumption([null,null,null],null),true);
  assert.equal(lib.canAutofillConsumption([0,5,10],'SIPS'),true);
  assert.equal(lib.canAutofillConsumption([10,20,30],'crm'),true);
  for(const source of ['manual','factura','factura (Supabase)']){
    assert.equal(lib.canAutofillConsumption([null,null,null],source),false);
    assert.equal(lib.canAutofillConsumption([10,20,30],source),false);
  }
  assert.equal(lib.canAutofillConsumption([10,20,30],null),false);
});
test('anàlisi i radiografia comparteixen el total del desglossament validat',async()=>{
  const { annualActive }=await import('../src/energy/lib/parse.ts');
  const raw={CUPS:cups,Tarifa:'3.0TD','E.A. Anual (kWh)':99999,[lib.ANNUAL_CONSUMPTION_KEY]:JSON.stringify(read())};
  const supply=records.supplyFromRecord(raw,{file:'SIPS'});
  assert.deepEqual(annualActive(supply),{value:12881,basis:'periodes'});
  assert.deepEqual(lib.savedAnnualConsumption(supply.raw).periods,expected);
});
test('consulta compartida dels formularis recupera períodes quan la memòria cau és antiga',async()=>{
  const { loadSipsConsumption }=await import('../src/energy/api.ts');
  const realFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init});
    if(String(url).startsWith('/api/sips/supply'))return Response.json({entry:{cups:cups.slice(0,20),status:'found',tariff:'6.1TD',energy_type:'luz'}});
    assert.equal(url,'/api/sips/refresh');assert.equal(JSON.parse(init.body).cups,cups);
    return Response.json({entry:{status:'found',tariff:'6.1TD',annual_consumption:read()}});
  };
  try{const entry=await loadSipsConsumption(cups);assert.deepEqual(lib.comparatorConsumption(entry.annual_consumption,entry.tariff).kwh,expected);assert.equal(calls.length,2);}
  finally{globalThis.fetch=realFetch;}
});
test('consulta compartida reutilitza el detall existent i no exigeix períodes elèctrics al gas',async()=>{
  const { loadSipsConsumption }=await import('../src/energy/api.ts');const realFetch=globalThis.fetch;
  try{
    for(const entry of [{status:'found',tariff:'3.0TD',annual_consumption:{...read(),revision:3}},{status:'found',energy_type:'gas',tariff:'RL.2'}]){
      let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({entry});};
      const loaded=await loadSipsConsumption(cups);assert.equal(calls,1);assert.equal(loaded.tariff,entry.tariff);
    }
  }finally{globalThis.fetch=realFetch;}
});
test('ordenació SIPS validada: consum, tarifa, adreça, comercialitzadora i lectura',()=>{
  for(const [field,remote] of Object.entries(engine.SIPS_SORT_FIELDS))for(const direction of ['asc','desc']){
    const r=engine.buildListRequest({cp:'25001',energia:'gas',sortBy:field,sortDirection:direction,skip:50});
    assert.equal(r.ok,true);assert.deepEqual(r.request.Sort,[`${remote} ${direction.toUpperCase()}`,'CUPS']);assert.equal(r.request.Skip,50);
  }
  assert.equal(engine.buildListRequest({cp:'25001',sortBy:'consum; DROP TABLE'}).ok,false);
  assert.equal(engine.buildListRequest({cp:'25001',sortDirection:'invalid'}).ok,false);
});
test('els filtres de gas inclouen text, variants RL i límits de consum',()=>{
  const r=engine.buildListRequest({cp:'25001',energia:'gas',tarifa:'RL.2',resultText:'Avinguda Nord',minKWh:1000,maxKWh:5000});
  assert.equal(r.ok,true);const text=JSON.stringify(r.request.Criteria);
  for(const term of ['RL.2','RL2','RL 2','Direccion','CUPS','IdLocalidadNombreLocalidad','IdComercializadoraNombreComercializadora','Avinguda Nord'])assert.ok(text.includes(term));
  assert.ok(text.includes('<=')&&text.includes('>=')&&text.includes('5000'));
});
test('validació dels límits: màxim zero vàlid; negatius, infinits i interval invertit no vàlids',()=>{
  assert.equal(engine.buildListRequest({cp:'25001',maxKWh:0}).ok,true);
  for(const extra of [{minKWh:-1},{maxKWh:-1},{maxKWh:Infinity},{minKWh:5000,maxKWh:1000}])assert.equal(engine.buildListRequest({cp:'25001',...extra}).ok,false);
});
// Portal simulat amb més d'una pàgina. Avalua els criteris i ordena abans de paginar.
function searchablePortal(){
  const data=Array.from({length:160},(_,i)=>({TipoEnergia:i%3===0?1:2,CUPS:`ES${String(i+1).padStart(16,'0')}AA0F`,CodigoPostal:'25001',Direccion:i%2?'Avinguda Nord 1':'Carrer Sud 2',IdLocalidadNombreLocalidad:'Bellvis',IdComercializadoraNombreComercializadora:'Energia Test',IdTarifaNombreTarifa:i%3===0?'3.0TD':i%2?'RL2':'RL.3',EActivaAnual:i*1000,FechaUltimaLectura:`2026-${String(i%12+1).padStart(2,'0')}-01`}));
  function match(entity,c){
    if(!c)return true;
    const [left,op,right]=c;
    if(op==='and')return match(entity,left)&&match(entity,right);
    if(op==='or')return match(entity,left)||match(entity,right);
    const value=entity[left[0]];
    if(op==='=')return value===right;
    if(op==='>=')return value!=null&&value>=right;
    if(op==='<=')return value!=null&&value<=right;
    if(op==='like'){
      const pattern=String(right).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('%','.*');
      return new RegExp('^'+pattern+'$').test(String(value??''));
    }
    throw new Error('Criteri inesperat');
  }
  const f=async(url,init)=>{
    if(url.endsWith('/Account/Login/'))return new Response('');
    if(url.endsWith('/Account/Login'))return Response.json({});
    assert.ok(url.endsWith('/PuntoSuministro/List'));
    const q=JSON.parse(init.body);let rows=data.filter(e=>(!q.EqualityFilter?.CodigoPostal||e.CodigoPostal===q.EqualityFilter.CodigoPostal)&&match(e,q.Criteria));
    rows.sort((a,b)=>{
      for(const rule of q.Sort){const [key,direction]=rule.split(' ');const x=a[key],y=b[key];const cmp=typeof x==='number'?x-y:String(x).localeCompare(String(y));if(cmp)return direction==='DESC'?-cmp:cmp;}
      return 0;
    });
    return Response.json({Entities:rows.slice(q.Skip,q.Skip+q.Take),TotalCount:rows.length});
  };
  return f;
}
test('consum ordenat abans de paginar: dos sentits, gas i llum, més de 50 resultats',async()=>{
  for(const energia of ['gas','luz','totes'])for(const sortDirection of ['asc','desc']){
    engine.__resetSession();const f=searchablePortal();const q={cp:'25001',energia,sortBy:'consum',sortDirection,take:20};
    const first=await engine.sipsQuery(q,cfg,f);const second=await engine.sipsQuery({...q,skip:20},cfg,f);
    assert.ok(first.total>40);const a=first.entities.at(-1).EActivaAnual,b=second.entities[0].EActivaAnual;
    assert.ok(sortDirection==='asc'?a<b:a>b);
    assert.ok(!first.entities.some(e=>second.entities.some(other=>other.CUPS===e.CUPS)));
  }
});
test('filtres globals de gas: CP + carrer + RL2 + consum',async()=>{
  engine.__resetSession();const r=await engine.sipsQuery({cp:'25001',energia:'gas',resultText:'Nord',tarifa:'RL.2',minKWh:40000,maxKWh:90000,sortBy:'consum',sortDirection:'asc',take:20},cfg,searchablePortal());
  assert.ok(r.total>0);for(const e of r.entities){assert.equal(e.TipoEnergia,2);assert.match(e.Direccion,/Nord/);assert.equal(e.IdTarifaNombreTarifa,'RL2');assert.ok(e.EActivaAnual>=40000&&e.EActivaAnual<=90000);}
});
test('una cerca de gas es pot afinar per fragment de CUPS o comercialitzadora',async()=>{
  for(const resultText of ['ES0000000000000002AA','Energia Test']){
    engine.__resetSession();const r=await engine.sipsQuery({cp:'25001',energia:'gas',resultText},cfg,searchablePortal());
    assert.ok(r.total>0);assert.ok(r.entities.every(e=>e.TipoEnergia===2));
  }
});
test('zero coincidències manté un resultat buit coherent per netejar els filtres',async()=>{
  engine.__resetSession();const r=await engine.sipsQuery({cp:'25001',energia:'gas',resultText:'carrer inexistent'},cfg,searchablePortal());
  assert.equal(r.total,0);assert.deepEqual(r.entities,[]);
});
const localResults = await import('../src/energy/lib/sips-results.ts');
const localRows = () => [
  records.supplyFromRecord({CUPS:'ES0000000000000001AA0F','Tipo Energía':'Gas',Tarifa:'RL2','Dirección':'Avinguda Nord 1','Localidad':'Bellvís','Comercializadora':'Energia Nord','E.A. Anual (kWh)':2000},{file:'Test'}),
  records.supplyFromRecord({CUPS:'ES0000000000000002AA0F','Tipo Energía':'Gas',Tarifa:'RL.10','Dirección':'Carrer Sud 2','Localidad':'Bellvís','Comercializadora':'Energia Sud','E.A. Anual (kWh)':10000},{file:'Test'}),
  records.supplyFromRecord({CUPS:'ES0000000000000003AA0F','Tipo Energía':'Electricidad',Tarifa:'3.0TD','Dirección':'Avinguda Nord 3','Localidad':'Golmés','Comercializadora':'Energia Nord','E.A. Anual (kWh)':0},{file:'Test'}),
  records.supplyFromRecord({CUPS:'ES0000000000000004AA0F','Tipo Energía':'Gas',Tarifa:'RL 2','Dirección':'Carrer Major 4','Localidad':'Bellvís'},{file:'Test'}),
];
const descending={sortBy:'consum',sortDirection:'desc'};
test('filtre local: gas, variants RL2, població sense accents i rang de consum',()=>{
  const rows=localRows();const f={...localResults.emptyResultFilters(),energia:'gas',tarifa:'RL.2',text:'bellvis nord',min:1000,max:3000};
  const result=localResults.filterSipsResults(rows,f,descending);assert.equal(result.length,1);assert.equal(result[0].cups,rows[0].cups);
});
test('ordenació local numèrica, zeros vàlids i dades absents al final en els dos sentits',()=>{
  const rows=localRows();
  const desc=localResults.filterSipsResults(rows,localResults.emptyResultFilters(),descending);
  assert.deepEqual(desc.map(s=>s.cups),[rows[1].cups,rows[0].cups,rows[2].cups,rows[3].cups]);
  const asc=localResults.filterSipsResults(rows,localResults.emptyResultFilters(),{sortBy:'consum',sortDirection:'asc'});
  assert.deepEqual(asc.map(s=>s.cups),[rows[2].cups,rows[0].cups,rows[1].cups,rows[3].cups]);
  const zero=localResults.filterSipsResults(rows,{...localResults.emptyResultFilters(),max:0},descending);assert.equal(zero.length,1);assert.equal(zero[0].cups,rows[2].cups);
});
test('netejar el filtre local recupera tots els resultats sense modificar la llista original',()=>{
  const rows=localRows();const before=JSON.stringify(rows);
  assert.equal(localResults.filterSipsResults(rows,{...localResults.emptyResultFilters(),text:'inexistent'},descending).length,0);
  assert.equal(localResults.filterSipsResults(rows,localResults.emptyResultFilters(),descending).length,4);
  assert.equal(JSON.stringify(rows),before);
});
test('ordre natural de les tarifes locals: RL2 abans de RL10',()=>{
  const result=localResults.filterSipsResults(localRows(),{...localResults.emptyResultFilters(),energia:'gas'},{sortBy:'tarifa',sortDirection:'asc'});
  assert.equal(result.at(-1).tarifaRaw,'RL.10');
  assert.equal(localResults.validateResultFilters({...localResults.emptyResultFilters(),min:10,max:5})!=null,true);
});
test('regressió: aplicar, netejar i ordenar els resultats trobats no torna a consultar SIPS',async()=>{
  const { energyApi }=await import('../src/energy/api.ts');const { parseRows }=await import('../src/energy/lib/parse.ts');
  const realFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({total:2,rows:engine.entitiesToRows([{CUPS:cups,TipoEnergia:1,IdTarifaNombreTarifa:'3.0TD',EActivaAnual:12881},{CUPS:'ES0000000000000001AA0F',TipoEnergia:2,IdTarifaNombreTarifa:'RL.2',EActivaAnual:2000}]),consultedAt:'2026-11-05T20:00:00Z',source:'Test'});};
  try{
    const found=await energyApi.search({cp:'25001'});const rows=parseRows(found.rows,{file:'SIPS',sheet:'Test'}).supplies;
    const filtered=localResults.filterSipsResults(rows,{...localResults.emptyResultFilters(),energia:'gas'},descending);assert.equal(filtered.length,1);
    const cleared=localResults.filterSipsResults(rows,localResults.emptyResultFilters(),descending);assert.equal(cleared.length,2);
    localResults.filterSipsResults(rows,localResults.emptyResultFilters(),{sortBy:'tarifa',sortDirection:'asc'});
    assert.equal(requests,1);
  }finally{globalThis.fetch=realFetch;}
});

// Totes les propostes entren a Comparatives IA amb les dades conegudes.
const proposal = await import('../src/energy/lib/proposal-autofill.ts');
const blankSupply = () => ({ energyType:'luz', accessTariff:'2.0TD', kwh:Array(6).fill(null), kwhTotal:null, kw:Array(6).fill(null), basis:'anual', days:365 });
const proposalEntry = () => ({status:'found', cups, returned_cups:cups, tariff:'6.1TD', energy_type:'luz', annual_kwh:12881, contracted_power_kw:[40,41,42,43,44,45], annual_consumption:read()});
test('proposta 6.1TD: traspassa sis consums, potències i dates sense inventar preus',()=>{
  const r=proposal.proposalAutofill(proposalEntry(),blankSupply(),{});
  assert.equal(r.supply.accessTariff,'6.1TD'); assert.deepEqual(r.supply.kwh,expected); assert.deepEqual(r.supply.kw,[40,41,42,43,44,45]);
  assert.equal(r.supply.kwhTotal,12881); assert.equal(r.supply.periodTo,'2026-06-30'); assert.equal(r.sources.kwh,'sips'); assert.equal('prices' in r.supply,false);
});
test('proposta 2.0TD: tres consums i dues potències',()=>{
  const data=summary(); for(let i=4;i<=6;i++) data['EActivaMesP'+i]=Array(12).fill(0);
  data.EActivaMes=months.map(row=>row.slice(0,3).reduce((a,b)=>a+b,0)); data.EActiva=data.EActivaMes.reduce((a,b)=>a+b,0);
  const r=proposal.proposalAutofill({...proposalEntry(),tariff:'2.0TD',annual_consumption:lib.annualFromEasSummary(data,3,data.EActiva)},blankSupply(),{});
  assert.deepEqual(r.supply.kwh,[...expected.slice(0,3),null,null,null]); assert.deepEqual(r.supply.kw,[40,41,null,null,null,null]);
});
test('proposta gas: normalitza RL3 i traspassa el consum anual',()=>{
  const r=proposal.proposalAutofill({...proposalEntry(),tariff:'RL3',energy_type:'gas',annual_consumption:null},blankSupply(),{});
  assert.equal(r.supply.energyType,'gas'); assert.equal(r.supply.accessTariff,'RL.3'); assert.deepEqual(r.supply.kwh,[12881,null,null,null,null,null]);
});
test('proposta: conserva els valors manuals i de factura',()=>{
  for(const source of ['manual','factura']) {
    const current={...blankSupply(),accessTariff:'3.0TD',kwh:[1,2,3,4,5,6],kwhTotal:21,kw:[1,2,3,4,5,6]};
    const r=proposal.proposalAutofill(proposalEntry(),current,{tariff:source,kwh:source,kw:source,kwhTotal:source});
    assert.deepEqual(r.supply,current); assert.equal(r.sources.kwhTotal,source);
  }
});
test('proposta: completa períodes compatibles sense substituir un total manual',()=>{
  const r=proposal.proposalAutofill(proposalEntry(),{...blankSupply(),kwhTotal:12881},{kwhTotal:'manual'});
  assert.deepEqual(r.supply.kwh,expected); assert.equal(r.sources.kwhTotal,'manual'); assert.equal(r.supply.kwhTotal,12881);
});
test('proposta: les dades absents no es converteixen en zeros ni períodes estimats',()=>{
  const r=proposal.proposalAutofill({...proposalEntry(),annual_consumption:null,contracted_power_kw:[],annual_kwh:12881},blankSupply(),{});
  assert.deepEqual(r.supply.kwh,Array(6).fill(null)); assert.deepEqual(r.supply.kw,Array(6).fill(null)); assert.equal(r.supply.kwhTotal,12881);
  const missing=proposal.proposalAutofill({...proposalEntry(),status:'not_found'},blankSupply(),{}); assert.deepEqual(missing.supply,blankSupply());
});
test('proposta: ruta comuna per contracte, client, SIPS i lectura de factura, preservant el sufix',()=>{
  for(const context of [{contractId:'c'}, {clientId:'cl',supplyId:'s'}, {cups:cups.toLowerCase()}, {captureId:'lead',readingId:'r'}]) {
    const r=proposal.proposalRoute(context,'click-1'); assert.equal(r.autofill,'1'); assert.equal(r.launch,'click-1');
    if(context.cups) assert.equal(r.cups,cups);
    assert.equal(proposal.proposalEntryKey(r),proposal.proposalEntryKey({...r}));
    assert.notEqual(proposal.proposalEntryKey(r),proposal.proposalEntryKey({...r,launch:'click-2'}));
  }
});

const gasTariffs = await import('../src/energy/lib/gas-tariff.ts');
test('filtres: les tarifes antigues 3.n i RL.n són equivalents sense confondre llum',()=>{
  for(let n=1;n<=11;n++) {
    for(const code of [`3.${n}`,`RL.${n}`,`RL${n}`,`RL ${n}`]) assert.equal(gasTariffs.gasTariffNumber(code),n);
    const row={...localRows()[0],tarifa:null,tarifaRaw:`3.${n}`};
    for(const code of [`RL${n}`,`3.${n}`]) assert.equal(localResults.filterSipsResults([row],{...localResults.emptyResultFilters(),energia:'gas',tarifa:code},descending).length,1);
    assert.equal(localResults.filterSipsResults([row],{...localResults.emptyResultFilters(),tarifa:`RL${n===1?2:1}`},descending).length,0);
  }
  for(const code of ['3.0TD','3.0','6.1TD','3.1A','RL0','RL12']) assert.equal(gasTariffs.gasTariffNumber(code),null);
});
test('ordre local: 3.2 i RL2 es classifiquen junts abans de RL10',()=>{
  const rows=[{...localRows()[0],tarifa:null,tarifaRaw:'3.2'},localRows()[1]];
  assert.equal(localResults.filterSipsResults(rows,localResults.emptyResultFilters(),{sortBy:'tarifa',sortDirection:'asc'})[0].tarifaRaw,'3.2');
});
test('la cerca explícita de gas inclou la denominació antiga i les variants RL',()=>{
  const serialized=JSON.stringify(engine.buildListRequest({cp:'25001',energia:'gas',tarifa:'RL.2'}));
  for(const code of ['3.2','RL.2','RL2','RL 2']) assert.ok(serialized.includes(code));
});

const historyRows = () => months.map((v, i) => ({
  IdConsumoPuntoSuministro: i + 1, IdPuntoSuministro: 37986309,
  FechaInicioConsumo: new Date(Date.UTC(2025, 6+i, 1)).toISOString().slice(0,10),
  FechaFinConsumo: new Date(Date.UTC(2025, 7+i, 0)).toISOString().slice(0,10),
  ...Object.fromEntries(v.map((k,p) => ['EActivaP'+(p+1), k])),
}));
function historyPortal({ tariff='6.1TD', expire=false, repeated=false, wrongSupply=false }={}) {
  const calls=[]; let expired=false;
  const f=async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/Account/Login/') || url.endsWith('/Account/Login')) return Response.json({});
    if(url.endsWith('/PuntoSuministro/List')) return Response.json({ Entities:[{Id:999,IdPuntoSuministro:37986309,CUPS:cups,TipoEnergia:1,IdTarifaNombreTarifa:tariff,EActivaAnual:90000}],TotalCount:1 });
    if(url.endsWith('/ConsumoPuntoSuministro/List')) {
      const q=JSON.parse(init.body); assert.equal(q.EqualityFilter.IdPuntoSuministro,37986309);
      assert.ok(q.IncludeColumns.includes('EActivaP6'));
      if(expire&&!expired){expired=true;return new Response('',{status:401});}
      const rows=historyRows().map(row=>wrongSupply?{...row,IdPuntoSuministro:123}:row);
      const start=repeated?0:q.Skip;
      return Response.json({Entities:rows.slice(start,start+5),TotalCount:12});
    }
    assert.ok(url.endsWith('/ResumenConsumosU12M'));
    return Response.json(summary());
  }; return {calls,f};
}
test('històric EAS paginat: ID explícit, 6 períodes, decimals i proposta des del client',async()=>{
  for(const tariff of ['3.0TD','6.1TD']) {
    engine.__resetSession(); const p=historyPortal({tariff});
    const result=await engine.sipsSearchRows({cups},cfg,p.f);
    assert.equal(p.calls.filter(c=>c.url.endsWith('/ConsumoPuntoSuministro/List')).length,3);
    assert.equal(p.calls.some(c=>c.url.endsWith('/ResumenConsumosU12M')),false);
    const entry=records.withAnnualConsumption(records.cacheRowFromRecord(cups.slice(0,20),engine.rowToRecord(result.rows[0],result.rows[1]),{source:'sips'}));
    assert.equal(entry.annual_consumption.basis,'history'); assert.equal(entry.annual_consumption.revision,3);
    assert.equal(entry.annual_consumption.status,'complete'); assert.deepEqual(entry.annual_consumption.periods,expected);
    const patch=proposal.proposalAutofill(entry,{...blankSupply(),kwhTotal:90000},{kwhTotal:'crm'});
    assert.deepEqual(patch.supply.kwh,expected);assert.equal(patch.supply.kwhTotal,12881);
  }
});
test('històric: renova la sessió una vegada si caduca entre pàgines',async()=>{
  engine.__resetSession();const p=historyPortal({expire:true});const result=await engine.sipsSearchRows({cups},cfg,p.f);
  assert.deepEqual(result.annualConsumptions[cups].periods,expected);
  assert.equal(p.calls.filter(c=>c.url.endsWith('/Account/Login')).length,2);
});
test('històric: pàgina repetida o CUPS aliè no es sumen ni es validen',async()=>{
  for(const option of [{repeated:true},{wrongSupply:true}]){
    engine.__resetSession();const p=historyPortal(option);const result=await engine.sipsSearchRows({cups},cfg,p.f);
    assert.equal(result.annualConsumptions[cups].basis,'provider_summary');
    assert.match(result.annualConsumptions[cups].warning,/Històric:/);
  }
});
test('lectures amb límit final exclusiu cobreixen un any exacte sense duplicar dies',()=>{
  const rows=historyRows().map((row,i)=>({...row,FechaFinConsumo:new Date(Date.UTC(2025,7+i,1)).toISOString().slice(0,10)}));
  const reading=lib.annualFromEasHistory(rows,6,12881);assert.equal(reading.status,'complete');assert.deepEqual(reading.periods,expected);
  assert.equal(reading.from,'2025-07-01');assert.equal(reading.to,'2026-06-30');
});
test('decimal JSON amb tres decimals no es confon amb separador de milers',()=>{
  const rows=historyRows().map(row=>({...row,EActivaP1:'1.234'}));
  assert.equal(lib.annualFromEasHistory(rows,6,null).periods[0],14.808);
});
test('un buit, solapament o P6 absent no es reparteix artificialment',()=>{
  for(const change of [rows=>rows.slice(1),rows=>[...rows,{...rows[0],EActivaP1:1}],rows=>rows.map(row=>({...row,EActivaP6:null}))]) {
    const r=lib.annualFromEasHistory(change(historyRows()),6,null);assert.equal(r.status,'incomplete');assert.equal(lib.comparatorConsumption(r,'6.1TD'),null);
  }
});
test('cau: migra els resums antics i reintenta els incomplets sense bucle de consultes',()=>{
  const at='2026-11-06T10:00:00Z', now=Date.parse(at);
  const entry={status:'found',energy_type:'luz',tariff:'3.0TD',consulted_at:at,annual_consumption:{...read(),revision:3}};
  assert.equal(lib.needsConsumptionRefresh(entry,now),false);
  assert.equal(lib.needsConsumptionRefresh({...entry,annual_consumption:read()},now),true);
  const incomplete={...entry,annual_consumption:{...entry.annual_consumption,status:'incomplete'}};
  assert.equal(lib.needsConsumptionRefresh(incomplete,now),false);
  assert.equal(lib.needsConsumptionRefresh(incomplete,now+15*60_000),true);
});
test('lectures a mig mes: any complet sense exigir que la factura comenci el dia 1',()=>{
  const rows=historyRows().map((row,i)=>({...row,FechaInicioConsumo:new Date(Date.UTC(2025,6+i,15)).toISOString().slice(0,10),FechaFinConsumo:new Date(Date.UTC(2025,7+i,14)).toISOString().slice(0,10)}));
  const r=lib.annualFromEasHistory(rows,6,12881);assert.equal(r.status,'complete');assert.deepEqual(r.periods,expected);
  assert.equal(r.from,'2025-07-15');assert.equal(r.to,'2026-07-14');
});
test('consulta sense entrada a la memòria cau retorna el resultat de refresh',async()=>{
  const { loadSipsConsumption }=await import('../src/energy/api.ts');
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(url);
    return String(url).startsWith('/api/sips/supply')?Response.json({entry:null}):Response.json({entry:{status:'found',tariff:'6.1TD',annual_consumption:{...read(),revision:3}}});
  };
  try {
    const entry=await loadSipsConsumption(cups);
    assert.equal(entry.status,'found');assert.equal(calls.length,2);assert.equal(calls[1],'/api/sips/refresh');
  } finally { globalThis.fetch=original; }
});
