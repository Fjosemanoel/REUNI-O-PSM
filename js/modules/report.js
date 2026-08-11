(function(){
  'use strict';

  const PAGE_WIDTH=297;
  const PAGE_HEIGHT=210;
  const MARGIN=8;
  const HEADER_HEIGHT=12;
  const FOOTER_HEIGHT=7;

  function waitFrame(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  function safeText(value){return String(value??'').trim();}
  function fileSafe(value){return safeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'');}
  function formatDate(value){
    if(!value)return'';
    const parts=String(value).split('-');
    return parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:String(value);
  }
  function selectedText(select){return[...select.selectedOptions].map(option=>option.textContent.trim()).join(', ');}

  function syncFormValues(source,clone){
    const originals=[...source.querySelectorAll('input,textarea,select')];
    const copies=[...clone.querySelectorAll('input,textarea,select')];
    originals.forEach((field,index)=>{
      const copy=copies[index];
      if(!copy)return;
      if(field.matches('input[type="checkbox"],input[type="radio"]')){
        copy.checked=field.checked;
        if(field.checked)copy.setAttribute('checked','');else copy.removeAttribute('checked');
        return;
      }
      if(field.tagName==='SELECT'){
        copy.value=field.value;
        [...copy.options].forEach(option=>option.selected=[...field.selectedOptions].some(item=>item.value===option.value));
        return;
      }
      copy.value=field.value;
      copy.setAttribute('value',field.value);
      if(field.tagName==='TEXTAREA')copy.textContent=field.value;
    });
  }

  function copyCanvasImages(source,clone){
    const originals=[...source.querySelectorAll('canvas')];
    const copies=[...clone.querySelectorAll('canvas')];
    originals.forEach((canvas,index)=>{
      const copy=copies[index];
      if(!copy)return;
      try{
        const image=document.createElement('img');
        image.src=canvas.toDataURL('image/png');
        image.alt=canvas.getAttribute('aria-label')||'Gráfico do dashboard';
        image.className='report-chart-image';
        copy.replaceWith(image);
      }catch(error){console.warn('Não foi possível copiar um gráfico para o relatório.',error);}
    });
  }

  function cloneForReport(source){
    const clone=source.cloneNode(true);
    syncFormValues(source,clone);
    copyCanvasImages(source,clone);
    clone.querySelectorAll('.meeting-title-input').forEach(field=>{
      const title=document.createElement('div');
      title.className='meeting-title-input report-meeting-title';
      title.textContent=field.value||field.textContent||'';
      field.replaceWith(title);
    });
    clone.querySelectorAll('.meeting-sheet input[type="date"]').forEach(field=>{
      const date=document.createElement('span');
      date.className='report-static-date';
      date.textContent=formatDate(field.value);
      field.replaceWith(date);
    });
    clone.classList.remove('view','active');
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
    clone.querySelectorAll('button,[hidden],.daily-checkin,.daily-tv-exit,.meeting-print,.qpp-hide-inline').forEach(element=>element.remove());
    clone.querySelectorAll('.daily-orders,.daily-order-list,.qpp-board-scroller,.meeting-page,.meeting-table-wrap').forEach(element=>{
      element.style.height='auto';
      element.style.maxHeight='none';
      element.style.overflow='visible';
    });
    return clone;
  }

  function reportSection(title,subtitle=''){
    const section=document.createElement('section');
    section.className='report-document-section';
    const header=document.createElement('header');
    header.className='report-document-heading';
    header.innerHTML=`<h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}`;
    section.appendChild(header);
    return section;
  }

  function buildDashboardSections(stage,period){
    const dashboard=document.querySelector('#dashboardView');
    if(!dashboard)return;
    const indicators=reportSection('DASHBOARD PSM - INDICADORES',period);
    const kpis=dashboard.querySelector('.kpi-grid');
    if(kpis)indicators.appendChild(cloneForReport(kpis));
    stage.appendChild(indicators);

    const cards=[...dashboard.querySelectorAll('.chart-grid > article')];
    for(let index=0;index<cards.length;index+=4){
      const page=reportSection(`DASHBOARD PSM - ANÁLISES ${Math.floor(index/4)+1}`,period);
      const grid=document.createElement('div');
      grid.className='report-dashboard-grid';
      cards.slice(index,index+4).forEach(card=>grid.appendChild(cloneForReport(card)));
      page.appendChild(grid);
      stage.appendChild(page);
    }
  }

  function buildDailySection(stage){
    const grid=document.querySelector('#dailyPlanGrid');
    if(!grid)return;
    const week=selectedText(document.querySelector('#dailyWeekFilter'));
    const day=selectedText(document.querySelector('#dailyDayFilter'))||'Todos os dias';
    const office=safeText(document.querySelector('#dailyOfficeFilterButton')?.textContent)||'Todas as oficinas';
    const section=reportSection('ATIVIDADES QPP E ROTINA',`${week} | ${day} | ${office}`);
    const content=cloneForReport(grid);
    content.classList.add('report-daily-grid');
    section.appendChild(content);
    stage.appendChild(section);
  }

  function buildQppSections(stage,weekNumbers){
    const weeks=weekNumbers.length?weekNumbers:[];
    weeks.forEach(number=>{
      const source=document.querySelector(`#qppBoardScroller .qpp-week[data-week="${number}"]`);
      if(!source)return;
      const section=reportSection(`QUADRO QPP - SEMANA ${String(number).padStart(2,'0')}`);
      section.appendChild(cloneForReport(source));
      stage.appendChild(section);
    });
  }

  function buildMeetingSections(stage){
    [['#ataFabContent .meeting-sheet','ATA 1'],['#ataBritContent .meeting-sheet','ATA 2']].forEach(([selector,title])=>{
      const source=document.querySelector(selector);
      if(!source)return;
      const section=reportSection(title);
      section.appendChild(cloneForReport(source));
      stage.appendChild(section);
    });
  }

  function makeStage(options){
    const stage=document.createElement('div');
    stage.className='report-export-stage';
    buildDashboardSections(stage,options.period||'');
    buildDailySection(stage);
    buildQppSections(stage,options.weekNumbers||[]);
    buildMeetingSections(stage);
    document.body.appendChild(stage);
    return stage;
  }

  const resolvedColorCache=new Map();
  function hasUnsupportedColor(value){return /(?:color-mix\(|color\(|oklch\(|lab\(|lch\()/i.test(String(value||''));}
  function resolveBrowserColor(value,fallback){
    const key=String(value||'');
    if(resolvedColorCache.has(key))return resolvedColorCache.get(key);
    let result=fallback;
    try{
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=1;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.clearRect(0,0,1,1);
      context.fillStyle='rgba(1,2,3,0.004)';
      context.fillStyle=key;
      context.fillRect(0,0,1,1);
      const [red,green,blue,alpha]=context.getImageData(0,0,1,1).data;
      result=alpha===255?`rgb(${red}, ${green}, ${blue})`:`rgba(${red}, ${green}, ${blue}, ${(alpha/255).toFixed(3)})`;
    }catch(error){console.warn('Cor moderna substituÃ­da no relatÃ³rio.',key,error);}
    resolvedColorCache.set(key,result);
    return result;
  }
  function sanitizeReportColors(root){
    const elements=[root,...root.querySelectorAll('*')];
    const borderProperties=['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor','columnRuleColor'];
    elements.forEach(element=>{
      const computed=getComputedStyle(element);
      if(hasUnsupportedColor(computed.color))element.style.color=resolveBrowserColor(computed.color,'#073566');
      if(hasUnsupportedColor(computed.backgroundColor))element.style.backgroundColor=resolveBrowserColor(computed.backgroundColor,'#ffffff');
      if(hasUnsupportedColor(computed.backgroundImage))element.style.backgroundImage='none';
      borderProperties.forEach(property=>{
        if(hasUnsupportedColor(computed[property]))element.style[property]=resolveBrowserColor(computed[property],'#b9d0e4');
      });
      if(hasUnsupportedColor(computed.boxShadow))element.style.boxShadow='none';
      if(hasUnsupportedColor(computed.textShadow))element.style.textShadow='none';
      if(hasUnsupportedColor(computed.fill))element.style.fill=resolveBrowserColor(computed.fill,'#073566');
      if(hasUnsupportedColor(computed.stroke))element.style.stroke=resolveBrowserColor(computed.stroke,'#073566');
    });
  }

  async function captureSection(section){
    await waitFrame();
    await Promise.all([...section.querySelectorAll('img')].map(image=>{
      if(image.complete)return image.decode?.().catch(()=>{})||Promise.resolve();
      return new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});});
    }));
    sanitizeReportColors(section);
    return window.html2canvas(section,{scale:1.25,backgroundColor:'#ffffff',logging:false,useCORS:true,allowTaint:false,windowWidth:1600});
  }

  function addCanvasPages(pdf,canvas,title,pageState){
    const usableWidth=PAGE_WIDTH-(MARGIN*2);
    const top=MARGIN+HEADER_HEIGHT;
    const usableHeight=PAGE_HEIGHT-top-MARGIN-FOOTER_HEIGHT;
    const pixelsPerPage=Math.max(1,Math.floor(canvas.width*(usableHeight/usableWidth)));
    for(let y=0;y<canvas.height;y+=pixelsPerPage){
      const sliceHeight=Math.min(pixelsPerPage,canvas.height-y);
      const slice=document.createElement('canvas');
      slice.width=canvas.width;
      slice.height=sliceHeight;
      const context=slice.getContext('2d');
      context.fillStyle='#ffffff';
      context.fillRect(0,0,slice.width,slice.height);
      context.drawImage(canvas,0,y,canvas.width,sliceHeight,0,0,canvas.width,sliceHeight);
      if(pageState.count>0)pdf.addPage([PAGE_WIDTH,PAGE_HEIGHT],'landscape');
      pageState.count+=1;
      pdf.setFillColor(0,78,162);
      pdf.rect(0,0,PAGE_WIDTH,HEADER_HEIGHT+3,'F');
      pdf.setDrawColor(152,202,61);
      pdf.setLineWidth(1.2);
      pdf.line(0,HEADER_HEIGHT+3,PAGE_WIDTH,HEADER_HEIGHT+3);
      pdf.setFont('helvetica','bold');
      pdf.setFontSize(11);
      pdf.setTextColor(255,255,255);
      pdf.text(String(title||'RELATÓRIO PSM').toUpperCase(),MARGIN,9.5);
      const imageHeight=Math.min(usableHeight,sliceHeight*(usableWidth/canvas.width));
      pdf.addImage(slice.toDataURL('image/jpeg',0.92),'JPEG',MARGIN,top,usableWidth,imageHeight,undefined,'FAST');
      pdf.setFont('helvetica','normal');
      pdf.setFontSize(8);
      pdf.setTextColor(75,97,120);
      pdf.text(`Página ${pageState.count}`,PAGE_WIDTH-MARGIN,PAGE_HEIGHT-4,{align:'right'});
    }
  }

  async function createPdf(options={}){
    if(!window.html2canvas||!window.jspdf?.jsPDF)throw new Error('Os recursos de PDF não foram carregados. Conecte-se à internet e abra o sistema novamente.');
    const stage=makeStage(options);
    const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
    const pageState={count:0};
    try{
      await document.fonts?.ready;
      const sections=[...stage.querySelectorAll(':scope > .report-document-section')];
      if(!sections.length)throw new Error('Nenhum conteúdo foi encontrado para gerar o relatório.');
      for(const section of sections){
        const canvas=await captureSection(section);
        addCanvasPages(pdf,canvas,section.querySelector('h1')?.textContent||'RELATÓRIO PSM',pageState);
      }
      const pages=pdf.getNumberOfPages();
      for(let page=1;page<=pages;page++){
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(75,97,120);
        pdf.text(`${page} / ${pages}`,PAGE_WIDTH/2,PAGE_HEIGHT-4,{align:'center'});
      }
      return pdf.output('blob');
    }finally{stage.remove();}
  }

  function downloadBlob(blob,fileName){
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=fileName;
    anchor.style.display='none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
  }

  async function blobBase64(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';
    for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
    return btoa(binary).replace(/.{1,76}/g,'$&\r\n');
  }

  async function downloadEmailDraft(pdfBlob,pdfName,subject){
    const boundary=`PSM_${Date.now()}`;
    const attachment=await blobBase64(pdfBlob);
    const message=[
      'X-Unsent: 1','MIME-Version: 1.0',`Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,'',
      `--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: 8bit','',
      'Segue em anexo o relatório completo do PSM, contendo Dashboard, Programação diária, Quadro QPP selecionado e ATAs.','',
      `--${boundary}`,`Content-Type: application/pdf; name="${pdfName}"`,'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${pdfName}"`,'',attachment,`--${boundary}--`,''
    ].join('\r\n');
    const emlName=`Enviar_${fileSafe(pdfName.replace(/\.pdf$/i,''))}.eml`;
    downloadBlob(new Blob([message],{type:'message/rfc822'}),emlName);
    return emlName;
  }

  async function shareByEmail(options={}){
    const week=String(options.primaryWeek||'').padStart(2,'0');
    const today=new Date();
    const stamp=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const pdfName=`Relatorio_PSM_Semana_${week}_${stamp}.pdf`;
    const subject=`Relatorio PSM - Semana ${week}`;
    const pdfBlob=await createPdf(options);
    const file=new File([pdfBlob],pdfName,{type:'application/pdf'});
    const nativeShareEnabled=false;// O rascunho .eml preserva o PDF anexado e abre direto no cliente de e-mail.
    if(nativeShareEnabled&&navigator.canShare?.({files:[file]})&&navigator.share){
      try{
      await navigator.share({title:subject,text:'Relatório completo do Planejamento Semanal de Manutenção.',files:[file]});
      return{method:'share',fileName:pdfName,pages:null};
      }catch(error){
        if(error?.name==='AbortError')throw error;
        console.warn('Compartilhamento nativo indisponivel; gerando rascunho de e-mail.',error);
      }
    }
    const draftName=await downloadEmailDraft(pdfBlob,pdfName,subject);
    return{method:'eml',fileName:pdfName,draftName};
  }

  window.PSMReport={createPdf,shareByEmail,downloadBlob};
})();
