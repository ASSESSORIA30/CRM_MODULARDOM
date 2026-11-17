/* ============================================================
   ModularDom · Lògica del configurador  (v3)
   ============================================================ */
(function () {
  'use strict';
  const P = cargarPrecios();
  const euros = n => new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(Math.round(n||0));
  const fechaDescuentoDistribucion = () => {
    const d = new Date();
    d.setDate(d.getDate() + 12);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };

  /* ---------- Idioma ---------- */
  let lang = localStorage.getItem('modulardom_lang') || 'ca';
  const t = k => (I18N[lang] && I18N[lang][k]) || k;

  /* ---------- Estat ---------- */
  const state = {
    metros:null, habitaciones:null, banos:null, suite:null,
    cocina:null, vehiculos:0, lavadero:false,
    extrasM2:new Set(), extras:new Set(), lead:null
  };

  const AREAS = [100,120,150,180,200,250,300];
  const ROOMS = [1,2,3,4,5,6];
  const BATHS = [1,2,3,4];
  // imatge de superfície segons rang
  function surfaceImg(){
    const m = state.metros||0;
    if (m && m < 130) return 'assets/surface-100.jpg';
    if (m && m < 190) return 'assets/surface-150.jpg';
    return 'assets/surface-200.jpg';
  }

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ============================================================
     i18n · aplicar traduccions al DOM
     ============================================================ */
  function applyI18n(){
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    // botó de llengua
    $$('.lang-btn').forEach(b => b.classList.toggle('is-active', b.dataset.lang === lang));
    // reconstruir targetes amb textos i refrescar
    buildAll();
    if (wizard.classList.contains('is-open')){ goTo(current); }
    renderAside();
    if ($('#dossierScreen').classList.contains('is-open')) renderDossier();
  }
  function setLang(l){
    lang = l; localStorage.setItem('modulardom_lang', l); applyI18n();
  }

  /* ============================================================
     CONSTRUCCIÓ DE TARGETES
     ============================================================ */
  function buildAll(){
    buildRoomCards(); buildBathCards(); buildSuiteCards();
    buildCocinaCards(); buildGarage(); buildExtrasM2(); buildExtras();
    syncSelections();
  }
  function buildRoomCards(){
    $('#roomCards').innerHTML = ROOMS.map(n =>
      `<button class="card" data-room="${n}"><div class="card__big">${n}</div><div class="card__unit">${n===1?t('cap1'):t('capN')}</div></button>`).join('');
  }
  function buildBathCards(){
    $('#bathCards').innerHTML = BATHS.map(n =>
      `<button class="card" data-bath="${n}"><div class="card__big">${n}</div><div class="card__unit">${n===1?t('ban1'):t('banN')}</div></button>`).join('');
  }
  function buildSuiteCards(){
    const S = [
      { id:'sin',           titulo:t('suite_sin'),  desc:t('suite_sin_d'),  img:'assets/suite-none.jpg' },
      { id:'bano',          titulo:t('suite_bano'), desc:t('suite_bano_d'), img:'assets/suite-bano.jpg' },
      { id:'bano_vestidor', titulo:t('suite_vest'), desc:t('suite_vest_d'), img:'assets/suite-vestidor.jpg' }
    ];
    $('#suiteCards').innerHTML = S.map(s =>
      `<button class="suite-card" data-suite="${s.id}">
         <div class="suite-card__img"><img src="${s.img}" alt="${s.titulo}" loading="lazy"></div>
         <div class="suite-card__body"><h3>${s.titulo}</h3><p>${s.desc}</p></div>
       </button>`).join('');
  }
  function buildCocinaCards(){
    const C = [
      { id:'basica', titulo:t('coc_basica'), desc:t('coc_basica_d'), img:'assets/cocina-basica.jpg' },
      { id:'isla',   titulo:t('coc_isla'),   desc:t('coc_isla_d'),   img:'assets/cocina-isla.jpg' }
    ];
    $('#cocinaCards').innerHTML = C.map(c =>
      `<button class="suite-card" data-cocina="${c.id}">
         <div class="suite-card__img"><img src="${c.img}" alt="${c.titulo}" loading="lazy"></div>
         <div class="suite-card__body"><h3>${c.titulo}</h3><p>${c.desc}</p></div>
       </button>`).join('');
  }
  function buildExtrasM2(){
    const grid = $('#extrasM2Grid');
    if (!grid) return;
    grid.innerHTML = Object.entries(P.extras_m2).map(([k,v]) =>
      `<button class="extra extra--photo" data-extram2="${k}">
         <div class="extra__photo"><img src="${v.img}" alt="${v.nombre}" loading="lazy"></div>
         <div class="extra__label">${v.nombre}<span class="extra__check">✓</span></div>
       </button>`).join('');
  }
  function buildExtras(){
    const lavaderoCard = `<button class="extra extra--photo" data-lavadero="1">
         <div class="extra__photo"><img src="assets/extra-lavadero.png" alt="${t('lavadero')}" loading="lazy"></div>
         <div class="extra__label">${t('lavadero')}<span class="extra__check">✓</span></div>
       </button>`;
    const imgFix = {
      piscina:'assets/extra-piscina.jpg',
      porche:'assets/extra-porche.jpg',
      placasSolares:'assets/placas-solares.jpg'
    };
    const extrasBloqueados = ['garaje','garatge','garage','domotica','cocina premium','cuina premium','cocina premuim','cuina premuim','premium kitchen','aerotermia','aerotèrmia','aire conductes','aire acondicionado conductos'];
    const esExtraVisible = ([k,v]) => {
      const clave = String(k || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const nombre = String(v?.nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      return !extrasBloqueados.some(x => clave.includes(x) || nombre.includes(x));
    };
    const fixedExtras = Object.entries(P.extras).filter(esExtraVisible).map(([k,v]) =>
      `<button class="extra extra--photo" data-extra="${k}">
         <div class="extra__photo"><img src="${imgFix[k] || v.img}" alt="${v.nombre}" loading="lazy"></div>
         <div class="extra__label">${v.nombre}<span class="extra__check">✓</span></div>
       </button>`).join('');
    $('#extrasGrid').innerHTML = lavaderoCard + fixedExtras;
  }
  function buildGarage(){
    let html='';
    for(let i=0;i<=4;i++){
      const cotxes = i===0 ? `<span class="garage-none">${t('gar_none')}</span>`
        : Array.from({length:i}).map(()=>`<svg class="car" viewBox="0 0 24 24"><path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="16" r="1.3" fill="currentColor"/><circle cx="17" cy="16" r="1.3" fill="currentColor"/></svg>`).join('');
      const label = i===0 ? t('gar_cap') : (i===1 ? t('gar_1') : t('gar_n').replace('{n}',i));
      html += `<button class="garage-card" data-vehiculos="${i}"><div class="garage-cars">${cotxes}</div><div class="garage-label">${label}</div></button>`;
    }
    $('#garageCards').innerHTML = html;
  }
  // re-marca seleccions després de reconstruir
  function syncSelections(){
    if(state.habitaciones) markSel('#roomCards','room',state.habitaciones);
    if(state.banos) markSel('#bathCards','bath',state.banos);
    if(state.suite) markSel('#suiteCards','suite',state.suite);
    if(state.cocina) markSel('#cocinaCards','cocina',state.cocina);
    markSel('#garageCards','vehiculos',state.vehiculos);
    if(state.lavadero) $('#extrasGrid [data-lavadero]')?.classList.add('is-selected');
    state.extrasM2.forEach(k=> $(`#extrasM2Grid [data-extram2="${k}"]`)?.classList.add('is-selected'));
    state.extras.forEach(k=> $(`#extrasGrid [data-extra="${k}"]`)?.classList.add('is-selected'));
  }
  function markSel(container, attr, val){
    const el = $(`${container} [data-${attr}="${val}"]`);
    if(el) el.classList.add('is-selected');
  }

  /* ============================================================
     CÀLCUL
     ============================================================ */
  function distribucionInterior(){
    let total = 0;
    if (state.habitaciones) total += state.habitaciones * P.interno.habitacion;
    if (state.banos) total += state.banos * P.interno.bano;
    if (state.suite === 'bano') total += P.interno.suite_bano;
    if (state.suite === 'bano_vestidor') total += P.interno.suite_bano_vestidor;
    if (state.lavadero) total += P.interno.lavadero;
    return total;
  }
  function garajeCoste(){ return state.vehiculos ? P.garaje.primer_vehiculo + (state.vehiculos-1)*P.garaje.vehiculo_extra : 0; }
  function cocinaCoste(){ return state.cocina ? (state.cocina==='isla'?P.cocina.isla:P.cocina.basica) : 0; }
  function instalacionesCoste(){
    const m = state.metros || 0;
    let total = 0;
    state.extrasM2.forEach(k => { if(P.extras_m2[k]) total += m * (P.extras_m2[k].precio_m2 || 0); });
    return total;
  }

  function calcular(){
    const m = state.metros || 0;
    const construccion = m * P.construccion_m2;
    const cimentacion  = m * P.cimentacion_m2;
    // Arquitecte inclou el preu fix de 2.800 € + la part fixa d'arquitectura. IVA 21%.
    const arquitecto   = m > 0 ? (m * P.arquitecto_m2 + P.arquitecto_fijo + P.precio_fijo) : 0;
    const acometidas   = m > 0 ? P.acometidas_base : 0;
    const distribucionOriginal = distribucionInterior();
    const distribucion = distribucionOriginal * 0.5;
    const cocina       = cocinaCoste();
    const garaje       = garajeCoste();
    const instalaciones = instalacionesCoste();

    const lineas = [];
    if (m>0){
      lineas.push([t('li_construccio'), construccion]);
      lineas.push([t('li_arquitecte'), arquitecto, 'arq']);
      lineas.push([t('li_fonamentacio'), cimentacion]);
      lineas.push([t('li_acometides'), acometidas]);
    }
    if (distribucionOriginal>0) lineas.push([t('li_distribucio'), distribucion, '', distribucionOriginal, 'discount50']);
    if (cocina>0) lineas.push([t('li_cuina'), cocina]);
    if (instalaciones>0) lineas.push([t('li_installacions'), instalaciones]);
    if (garaje>0) lineas.push([state.vehiculos===1?t('li_garatge1'):t('li_garatgeN').replace('{n}',state.vehiculos), garaje]);
    state.extras.forEach(k => { if(P.extras[k]) lineas.push([P.extras[k].nombre, P.extras[k].precio]); });

    const baseArq = arquitecto;
    const baseObra = lineas.reduce((s,l)=> s + (l[2]==='arq'?0:l[1]), 0);
    const subtotal = baseObra + baseArq;
    const ivaArq = baseArq * (P.iva_arquitecto/100);
    const ivaObra = baseObra * (P.iva_obra/100);
    const iva = ivaArq + ivaObra;
    return { lineas, baseObra, baseArq, subtotal, ivaObra, ivaArq, iva, total:subtotal+iva };
  }

  /* ============================================================
     RESUM EN VIU
     ============================================================ */
  let lastTotal = 0;
  function renderAside(){
    const c = calcular();
    if (!state.metros){
      $('#asideLines').innerHTML = `<p class="aside-empty">${t('aside_empty')}</p>`;
      ['#asideSubtotal','#asideIvaObra','#asideIvaArq','#asideTotal','#barTotal'].forEach(s=>$(s).textContent='—');
      return;
    }
    $('#asideLines').innerHTML = c.lineas.map(l=>{
      if (l[4] === 'discount50') {
        return `<div class="bline"><span>${l[0]}<small class="discount-note">(Descuento del 50% hasta el día ${fechaDescuentoDistribucion()})</small></span><span class="discount-price"><s>${euros(l[3])}</s><strong>${euros(l[1])}</strong></span></div>`;
      }
      return `<div class="bline"><span>${l[0]}</span><span>${euros(l[1])}</span></div>`;
    }).join('');
    $('#asideSubtotal').textContent = euros(c.subtotal);
    $('#asideIvaObra').textContent = euros(c.ivaObra);
    $('#asideIvaArq').textContent = euros(c.ivaArq);
    const tt = $('#asideTotal'); tt.textContent = euros(c.total); $('#barTotal').textContent = euros(c.total);
    if (c.total !== lastTotal){ tt.classList.remove('flash'); void tt.offsetWidth; tt.classList.add('flash'); lastTotal=c.total; }
  }

  /* ============================================================
     WIZARD  (7 passos)
     ============================================================ */
  const wizard = $('#wizard');
  let current = 1;
  const TOTAL_STEPS = 7;

  function openWizard(){ wizard.classList.add('is-open'); wizard.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; goTo(1); renderAside(); }
  function closeWizard(){ wizard.classList.remove('is-open'); wizard.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
  function goTo(n){
    current = n;
    $$('.step').forEach(s=>s.classList.toggle('is-active', +s.dataset.step===n));
    $('#progressBar').style.width = ((n-1)/(TOTAL_STEPS-1))*100 + '%';
    $('#progressLabel').textContent = `${t('wiz_step')} ${n} ${t('wiz_of')} ${TOTAL_STEPS}`;
    $('#barStep').textContent = `${t('wiz_step')} ${n} ${t('wiz_of')} ${TOTAL_STEPS}`;
    $('.stage__main').scrollTop = 0;
    syncNextButtons();
  }
  function syncNextButtons(){
    const ready = { 1:!!state.metros, 2:!!state.habitaciones, 3:!!state.banos, 4:!!state.suite, 5:!!state.cocina, 6:true };
    const step = document.querySelector(`.step[data-step="${current}"]`); if(!step) return;
    const next = step.querySelector('[data-next]'); if(next) next.disabled = !ready[current];
  }
  function singleSelect(container, attr, onPick){
    $(container).addEventListener('click', e=>{
      const btn = e.target.closest('[data-'+attr+']'); if(!btn) return;
      $$(container+' .card, '+container+' .suite-card, '+container+' .garage-card').forEach(c=>c.classList.remove('is-selected'));
      btn.classList.add('is-selected'); onPick(btn.dataset[attr]); renderAside(); syncNextButtons();
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init(){
    buildAll();
    initAreaInput();

    singleSelect('#roomCards','room', v => state.habitaciones=+v);
    singleSelect('#bathCards','bath', v => state.banos=+v);
    singleSelect('#suiteCards','suite', v => state.suite=v);
    singleSelect('#cocinaCards','cocina', v => state.cocina=v);
    singleSelect('#garageCards','vehiculos', v => state.vehiculos=+v);

    const extrasM2Grid = $('#extrasM2Grid');
    if (extrasM2Grid) {
      extrasM2Grid.addEventListener('click', e=>{
        const b=e.target.closest('[data-extram2]'); if(!b) return;
        const k=b.dataset.extram2;
        if(state.extrasM2.has(k)){state.extrasM2.delete(k);b.classList.remove('is-selected');}
        else{state.extrasM2.add(k);b.classList.add('is-selected');} renderAside();
      });
    }
    const extrasGrid = $('#extrasGrid');
    if (extrasGrid) extrasGrid.addEventListener('click', e=>{
      const lav=e.target.closest('[data-lavadero]');
      if(lav){
        state.lavadero=!state.lavadero;
        lav.classList.toggle('is-selected',state.lavadero);
        renderAside();
        return;
      }
      const b=e.target.closest('[data-extra]'); if(!b) return;
      const k=b.dataset.extra;
      if(state.extras.has(k)){state.extras.delete(k);b.classList.remove('is-selected');}
      else{state.extras.add(k);b.classList.add('is-selected');} renderAside();
    });

    $('#startBtn').addEventListener('click', openWizard);
    $('#navStart').addEventListener('click', e=>{e.preventDefault();openWizard();});
    $('#closeWizard').addEventListener('click', closeWizard);
    $$('[data-next]').forEach(b=>b.addEventListener('click',()=>{ if(current<TOTAL_STEPS) goTo(current+1); }));
    $$('[data-back]').forEach(b=>b.addEventListener('click',()=>{ if(current>1) goTo(current-1); }));
    $('#finishBtn').addEventListener('click', openLeadModal);

    $('#modalClose').addEventListener('click', closeLeadModal);
    $('#leadSubmit').addEventListener('click', submitLead);
    $('#leadModal').addEventListener('click', e=>{ if(e.target.id==='leadModal') closeLeadModal(); });

    $('#editBtn').addEventListener('click', ()=>{ $('#dossierScreen').classList.remove('is-open'); document.body.style.overflow='hidden'; wizard.classList.add('is-open'); goTo(7); });
    $('#downloadBtn').addEventListener('click', generarPDF);

    $$('.lang-btn').forEach(b=> b.addEventListener('click', ()=> setLang(b.dataset.lang)));

    document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ if($('#leadModal').classList.contains('is-open')) closeLeadModal(); else if(wizard.classList.contains('is-open')) closeWizard(); }});

    applyI18n();
  }

  function initAreaInput(){
    const input=$('#areaInput'), feedback=$('#areaFeedback'), min=P.metros_minimos||100;
    const apply=()=>{
      const v=parseInt(input.value,10);
      if(!input.value){ state.metros=null; feedback.textContent=''; feedback.className='area-feedback'; }
      else if(isNaN(v)||v<min){ state.metros=null; feedback.textContent=t('s1_min'); feedback.className='area-feedback is-error'; }
      else { state.metros=v; feedback.textContent=`${v} ${t('s1_unit_feedback')}`; feedback.className='area-feedback is-ok'; }
      renderAside(); syncNextButtons();
    };
    input.addEventListener('input', apply);
    $$('#areaQuick .area-chip').forEach(b=> b.addEventListener('click', ()=>{ input.value=b.dataset.q; apply(); input.focus(); }));
    input.__apply = apply;
  }

  /* ============================================================
     LEAD MODAL
     ============================================================ */
  function openLeadModal(){ $('#leadModal').classList.add('is-open'); $('#leadModal').setAttribute('aria-hidden','false'); }
  function closeLeadModal(){ $('#leadModal').classList.remove('is-open'); $('#leadModal').setAttribute('aria-hidden','true'); }
  const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const validPhone=v=>v.replace(/\D/g,'').length>=9;

  function submitLead(){
    const name=$('#leadName'),phone=$('#leadPhone'),email=$('#leadEmail');
    let ok=true;
    [[name,name.value.trim().length>=2],[phone,validPhone(phone.value)],[email,validEmail(email.value.trim())]]
      .forEach(([el,v])=>{ el.classList.toggle('invalid',!v); if(!v) ok=false; });
    if(!ok) return;
    state.lead={ nombre:name.value.trim(), telefono:phone.value.trim(), email:email.value.trim() };
    const c=calcular();
    const reg={ ...state.lead, fecha:new Date().toISOString(), config:{
      metros:state.metros, habitaciones:state.habitaciones, banos:state.banos, suite:state.suite,
      cocina:state.cocina, vehiculos:state.vehiculos, lavadero:state.lavadero,
      extrasM2:[...state.extrasM2], extras:[...state.extras], total:c.total }};
    try{ localStorage.setItem('modulardom_lead_'+Date.now(), JSON.stringify(reg)); }catch(e){}
    envioLead(reg);
    closeLeadModal(); closeWizard(); renderDossier();
    $('#dossierScreen').classList.add('is-open'); document.body.style.overflow=''; window.scrollTo(0,0);
    toast(t('toast_gen')); setTimeout(generarPDF,700);
  }

  function envioLead(reg){
    const EMAIL=(window.MODULARDOM_EMAIL||'').trim();
    if(EMAIL){
      const b=new FormData();
      b.append('_subject','Nou lead ModularDom · '+reg.nombre); b.append('_template','table'); b.append('_captcha','false');
      b.append('Nom',reg.nombre); b.append('Telèfon',reg.telefono); b.append('Email',reg.email);
      b.append('Superfície',reg.config.metros+' m²'); b.append('Habitacions',reg.config.habitaciones);
      b.append('Banys',reg.config.banos); b.append('Suite',reg.config.suite||'—'); b.append('Cuina',reg.config.cocina||'—');
      b.append('Garatge',reg.config.vehiculos?reg.config.vehiculos+' vehicles':'No');
      b.append('Lavadero',reg.config.lavadero?'Sí':'No');
      b.append('Total',euros(reg.config.total)); b.append('Data',new Date(reg.fecha).toLocaleString('es-ES'));
      fetch('https://formsubmit.co/ajax/'+encodeURIComponent(EMAIL),{method:'POST',body:b}).catch(()=>{}); return;
    }
    const EP=(window.MODULARDOM_ENDPOINT||'').trim();
    if(EP) fetch(EP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reg)}).catch(()=>{});
  }

  /* ============================================================
     DOSSIER
     ============================================================ */
  function configResumen(){
    const sMap={sin:t('suite_sin'),bano:t('suite_bano'),bano_vestidor:t('suite_vest')};
    const cMap={basica:t('coc_basica'),isla:t('coc_isla')};
    const extras=[ ...[...state.extrasM2].map(k=>P.extras_m2[k]?.nombre), ...[...state.extras].map(k=>P.extras[k]?.nombre) ].filter(Boolean);
    const lineas=[
      `${state.metros} m² ${t('feat_m2')}`,
      `${state.habitaciones} ${state.habitaciones===1?t('cap1'):t('capN')}`,
      `${state.banos} ${state.banos===1?t('ban1'):t('banN')}`,
      sMap[state.suite]||t('suite_sin'),
      cMap[state.cocina]||'',
      state.lavadero ? t('lavadero') : null,
      state.vehiculos ? `${t('feat_garatge')} ${state.vehiculos} ${state.vehiculos===1?'vehicle':'vehicles'}` : t('feat_sense_garatge'),
      extras.length ? `${t('feat_extres')} ${extras.join(', ')}` : t('feat_sense_extres')
    ].filter(Boolean);
    return { lineas, extras };
  }
  function renderDossier(){
    const c=calcular(), r=configResumen();
    const fecha=new Date().toLocaleDateString(lang==='ca'?'ca-ES':'es-ES',{year:'numeric',month:'long',day:'numeric'});
    $('#coverSub').textContent=`${t('dos_cover_sub')} · ${state.metros} m²`;
    $('#coverClient').textContent=state.lead?state.lead.nombre:t('dos_client');
    $('#coverDate').textContent=fecha;
    $('#dossierIntro').textContent = state.lead
      ? (lang==='ca' ? `${state.lead.nombre}, aquesta és la teva vivenda ModularDom de ${state.metros} m², dissenyada a la teva mida.`
                     : `${state.lead.nombre}, esta es tu vivienda ModularDom de ${state.metros} m², diseñada a tu medida.`)
      : `${t('dos_cover_sub')} · ${state.metros} m².`;
    $('#dossierTable').innerHTML = c.lineas.map(l=>`<tr><td>${l[0]}</td><td>${euros(l[1])}</td></tr>`).join('')
      + `<tr class="d-sub"><td>${t('aside_base')}</td><td>${euros(c.subtotal)}</td></tr>`
      + `<tr class="d-sub"><td>${t('aside_ivaobra')} (${P.iva_obra}%)</td><td>${euros(c.ivaObra)}</td></tr>`
      + `<tr class="d-sub"><td>${t('aside_ivaarq')} (${P.iva_arquitecto}%)</td><td>${euros(c.ivaArq)}</td></tr>`;
    $('#dossierTotal').innerHTML=euros(c.total);
    $('#dossierFeatures').innerHTML=r.lineas.map(x=>`<li>${x}</li>`).join('');
    // imatge dossier segons suite
    const suiteImg = {sin:'assets/suite-none.jpg',bano:'assets/suite-bano.jpg',bano_vestidor:'assets/suite-vestidor.jpg'}[state.suite] || 'assets/suite-bano.jpg';
    $('#dossierImg').src = suiteImg;
  }

  /* ============================================================
     PDF
     ============================================================ */
  async function generarPDF(){
    if(!window.jspdf){ toast('PDF error'); return; }
    const { jsPDF }=window.jspdf;
    const doc=new jsPDF({unit:'mm',format:'a4'});
    const W=210,H=297;
    const NAVY=[11,22,53],GOLD=[212,175,55],MUTED=[107,115,133],INK=[29,35,48],LINE=[228,230,236];
    const c=calcular(), r=configResumen(), lead=state.lead||{};
    const fecha=new Date().toLocaleDateString(lang==='ca'?'ca-ES':'es-ES',{year:'numeric',month:'long',day:'numeric'});
    const L = I18N[lang];

    // Portada amb imatge de fons (precarregada de forma robusta)
    const coverImg = await preloadImg('assets/pdf-cover.jpg');
    if(coverImg){ try{ doc.addImage(coverImg,'JPEG',0,0,W,170); }catch(e){} }
    doc.setFillColor(...NAVY); doc.rect(0,150,W,H-150,'F');
    doc.setGState(new doc.GState({opacity:0.85})); doc.setFillColor(...NAVY); doc.rect(0,120,W,40,'F'); doc.setGState(new doc.GState({opacity:1}));
    drawLogo(doc,24,32,GOLD,true);
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(38);
    const cover = lang==='ca' ? ['La teva vivenda','ModularDom'] : ['Tu vivienda','ModularDom'];
    doc.text(cover[0],24,182); doc.text(cover[1],24,198);
    doc.setTextColor(...GOLD); doc.setFont('helvetica','normal'); doc.setFontSize(15);
    metrosLabel(doc,`${L.dos_cover_sub} · ${state.metros} m`,24,211,15);
    doc.setDrawColor(70,80,110); doc.setLineWidth(.3); doc.line(24,268,W-24,268);
    doc.setFontSize(10); doc.setTextColor(199,205,219);
    doc.text(lead.nombre||L.dos_client,24,278); doc.text(fecha,W-24,278,{align:'right'});

    // Pàgina 2
    doc.addPage(); let y=28;
    sectionTitle(doc,L.dos_resum.toUpperCase(),y,GOLD); y+=12;
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(...INK);
    const introA = lead.nombre
      ? (lang==='ca'?`${lead.nombre}, aquesta és la teva vivenda ModularDom de ${state.metros} m`:`${lead.nombre}, esta es tu vivienda ModularDom de ${state.metros} m`)
      : (lang==='ca'?`Vivenda ModularDom de ${state.metros} m`:`Vivienda ModularDom de ${state.metros} m`);
    const introB = lead.nombre ? (lang==='ca'?`, dissenyada a la teva mida.`:`, diseñada a tu medida.`) : (lang==='ca'?`, clau en mà.`:`, llave en mano.`);
    doc.text(introA,24,y); const wa=doc.getTextWidth(introA);
    doc.setFontSize(7); doc.text('2',24+wa+0.3,y-1.8); doc.setFontSize(11); doc.text(introB,24+wa+2.2,y); y+=14;
    doc.setFontSize(10);
    c.lineas.forEach(l=>{ doc.setDrawColor(...LINE); doc.line(24,y+2,W-24,y+2);
      doc.setTextColor(...INK); doc.setFont('helvetica','normal'); doc.text(l[0],24,y);
      doc.setFont('helvetica','bold'); doc.text(euros(l[1]),W-24,y,{align:'right'}); y+=10; });
    y+=2; doc.setTextColor(...MUTED); doc.setFont('helvetica','normal');
    doc.text(L.aside_base,24,y); doc.text(euros(c.subtotal),W-24,y,{align:'right'}); y+=7;
    doc.text(`${L.aside_ivaobra} (${P.iva_obra}%)`,24,y); doc.text(euros(c.ivaObra),W-24,y,{align:'right'}); y+=7;
    doc.text(`${L.aside_ivaarq} (${P.iva_arquitecto}%)`,24,y); doc.text(euros(c.ivaArq),W-24,y,{align:'right'}); y+=10;
    doc.setDrawColor(...NAVY); doc.setLineWidth(.6); doc.line(24,y,W-24,y); y+=12;
    doc.setTextColor(...MUTED); doc.setFontSize(9); doc.text(L.dos_total.toUpperCase(),24,y);
    doc.setTextColor(...NAVY); doc.setFont('helvetica','bold'); doc.setFontSize(24);
    doc.text(euros(c.total),W-24,y+2,{align:'right'}); y+=22;
    sectionTitle(doc,L.dos_config.toUpperCase(),y,GOLD); y+=11;
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    r.lineas.forEach(x=>{ doc.setFillColor(...GOLD); doc.circle(26,y-1.3,1,'F');
      const idx=x.indexOf('m²');
      if(idx!==-1){ const before=x.slice(0,idx)+'m',after=x.slice(idx+2);
        doc.setFontSize(10.5); doc.text(before,31,y); const w1=doc.getTextWidth(before);
        doc.setFontSize(6.5); doc.text('2',31+w1+0.3,y-1.6); doc.setFontSize(10.5); doc.text(after,31+w1+2.2,y);
      } else doc.text(x,31,y); y+=9; });

    // Pàgina 3
    doc.addPage(); y=28;
    sectionTitle(doc,L.dos_qualitats.toUpperCase(),y,GOLD); y+=12;
    const cal = lang==='ca' ? [
      ['Sistema constructiu','Formigó cel·lular i sistema d\'entramat lleuger d\'altes prestacions. Aïllament gairebé Passive House.'],
      ['Eficiència energètica','Qualificació energètica A garantida. Gran estalvi en climatització i confort tèrmic tot l\'any.'],
      ['Acabats','Terra porcelànic de gran format, fusteria d\'alumini amb trencament de pont tèrmic i doble envidrament.'],
      ['Instal·lacions','Aerotèrmia i aire per conductes opcionals, preinstal·lació domòtica i il·luminació LED.'],
      ['Cuina','Cuina segons configuració, amb opció d\'illa central i disseny premium.'],
      ['Lliurament','Procés transparent amb preu tancat. Tramitació de permisos i lliurament en temps rècord.']
    ] : [
      ['Sistema constructivo','Hormigón celular y sistema de entramado ligero de altas prestaciones. Aislamiento casi Passive House.'],
      ['Eficiencia energética','Calificación energética A garantizada. Gran ahorro en climatización y confort térmico todo el año.'],
      ['Acabados','Suelo porcelánico de gran formato, carpintería de aluminio con rotura de puente térmico y doble acristalamiento.'],
      ['Instalaciones','Iluminación LED e instalaciones preparadas para una vivienda eficiente.'],
      ['Cocina','Cocina según configuración seleccionada.'],
      ['Entrega','Proceso transparente con precio cerrado. Tramitación de permisos y entrega en tiempo récord.']
    ];
    cal.forEach(([ti,d])=>{ doc.setFillColor(...GOLD); doc.rect(24,y-4,1.5,12,'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text(ti,30,y);
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
      const lines=doc.splitTextToSize(d,W-54); doc.text(lines,30,y+6); y+=10+lines.length*5; });
    y+=4; sectionTitle(doc,L.dos_condicions.toUpperCase(),y,GOLD); y+=11;
    const cond = lang==='ca' ? [
      'Pressupost orientatiu subjecte a projecte tècnic, ubicació, accessibilitat i mediciones finals.',
      'Inclou projecte d\'arquitectura i direcció d\'obra. No inclou llicències ni taxes municipals tret d\'indicació expressa.',
      'IVA: 10% obra i extres; 21% honoraris d\'arquitecte.',
      'Qualificació energètica A. Validesa de la proposta: 30 dies.'
    ] : [
      'Presupuesto orientativo sujeto a proyecto técnico, ubicación, accesibilidad y mediciones finales.',
      'Incluye proyecto de arquitectura y dirección de obra. No incluye licencias ni tasas municipales salvo indicación expresa.',
      'IVA: 10% obra y extras; 21% honorarios de arquitecto.',
      'Calificación energética A. Validez de la propuesta: 30 días.'
    ];
    doc.setFontSize(9); doc.setTextColor(...MUTED); doc.setFont('helvetica','normal');
    cond.forEach(x=>{ doc.setTextColor(...GOLD); doc.text('—',24,y); doc.setTextColor(...MUTED);
      const lines=doc.splitTextToSize(x,W-54); doc.text(lines,30,y); y+=lines.length*5+3; });

    doc.setFillColor(...NAVY); doc.rect(0,H-46,W,46,'F');
    doc.setTextColor(...GOLD); doc.setFont('helvetica','bold'); doc.setFontSize(15);
    doc.text(L.dos_end_h,W/2,H-30,{align:'center'});
    doc.setTextColor(199,205,219); doc.setFont('helvetica','normal'); doc.setFontSize(9);
    doc.text('MODULARDOM OBRAS Y REFORMAS, S.L.',W/2,H-21,{align:'center'});
    doc.text('Tel. 684 784 887 · info@modulardom.com · www.modulardom.com',W/2,H-15,{align:'center'});
    doc.save('Proposta-ModularDom'+(lead.nombre?'-'+lead.nombre.split(' ')[0]:'')+'.pdf');
    toast(t('toast_down'));
  }

  // cache d'imatges en base64 per al PDF (via canvas, robust en http/https)
  const _imgCache={};
  function preloadImg(path){
    return new Promise(resolve=>{
      if(_imgCache[path]) return resolve(_imgCache[path]);
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        try{
          const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight;
          cv.getContext('2d').drawImage(img,0,0);
          const d=cv.toDataURL('image/jpeg',0.9); _imgCache[path]=d; resolve(d);
        }catch(e){ resolve(null); }
      };
      img.onerror=()=>resolve(null);
      img.src=path;
    });
  }

  function drawLogo(doc,x,y,gold,inv){
    doc.setDrawColor(...gold); doc.setLineWidth(1.1);
    doc.line(x,y+8,x+7,y-3); doc.line(x+7,y-3,x+14,y+8); doc.line(x,y+8,x+14,y+8);
    doc.setFillColor(...gold); doc.triangle(x+4.5,y+8,x+7,y+3.5,x+9.5,y+8,'F');
    doc.setTextColor(inv?255:11, inv?255:22, inv?255:53); doc.setFont('helvetica','bold'); doc.setFontSize(20);
    doc.text('MODULAR',x+20,y+6); const w=doc.getTextWidth('MODULAR');
    doc.setTextColor(...gold); doc.setFont('helvetica','normal'); doc.text('DOM',x+20+w,y+6);
  }
  function sectionTitle(doc,text,y,color){ doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(...color);
    doc.text(text,24,y); doc.setDrawColor(...color); doc.setLineWidth(.4); doc.line(24,y+3,24+doc.getTextWidth(text),y+3); }
  function metrosLabel(doc,text,x,y,size){ doc.setFontSize(size); doc.text(text,x,y);
    const w=doc.getTextWidth(text); doc.setFontSize(size*0.6); doc.text('2',x+w+0.4,y-size*0.22); doc.setFontSize(size); }

  let toastTimer;
  function toast(html){ const el=$('#toast'); el.innerHTML=html; el.classList.add('is-show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('is-show'),3200); }

  document.addEventListener('DOMContentLoaded', init);
})();
